import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve('.');
const USERNAME = 'account-tester';
const INITIAL_PASSWORD = 'initial password for tests';
const RESET_PASSWORD = 'reset password for tests';
const REGISTERED_PASSWORD = 'registered password for tests';
const UNUSED_PASSWORD = 'unused password for tests';
const RECOVERY_KEY = 'recovery-key-with-enough-test-entropy';
const ACCESS_CODE = 'registration-code-with-test-entropy';

async function availablePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function startServer(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readings-account-recovery-'));
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      READINGS_USERNAME: USERNAME,
      READINGS_PASSWORD: INITIAL_PASSWORD,
      READINGS_RECOVERY_KEY: RECOVERY_KEY,
      READINGS_ACCESS_CODE: ACCESS_CODE,
      SESSION_SECRET: 'account-recovery-session-secret-value',
      DATA_PATH: path.join(tmp, 'state.json'),
      DATABASE_URL: '',
      RAILWAY_ENVIRONMENT_ID: '',
      NODE_ENV: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    await stop(child);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited: ${output.trim()}`);
    try {
      if ((await fetch(`${origin}/health`)).ok) return { origin, output: () => output };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${output.trim()}`);
}

async function login(origin, password, { requestOrigin = origin } = {}) {
  return fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: requestOrigin },
    body: JSON.stringify({ username: USERNAME, password }),
  });
}

function accountMutation(origin, pathname, body, { requestOrigin = origin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (requestOrigin !== null) headers.origin = requestOrigin;
  return fetch(`${origin}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('reset and one-time registration rotate credentials and invalidate sessions', async (t) => {
  const { origin, output } = await startServer(t);
  const capabilities = await fetch(`${origin}/api/auth-capabilities`).then((response) => response.json());
  assert.deepEqual(capabilities, {
    schemaVersion: 1,
    passwordReset: true,
    registration: true,
  });

  assert.equal((await login(origin, INITIAL_PASSWORD, { requestOrigin: null })).status, 403);
  assert.equal((await login(origin, INITIAL_PASSWORD, {
    requestOrigin: 'https://example.invalid',
  })).status, 403);

  const initialLogin = await login(origin, INITIAL_PASSWORD);
  assert.equal(initialLogin.status, 200);
  const initialCookie = initialLogin.headers.get('set-cookie').split(';')[0];
  const originalProfile = await fetch(`${origin}/api/profile`, {
    headers: { cookie: initialCookie },
  }).then((response) => response.json());
  const changedProfile = {
    ...originalProfile,
    preferences: {
      ...originalProfile.preferences,
      fontSize: 22,
    },
    layout: {
      ...originalProfile.layout,
      panels: {
        ...originalProfile.layout.panels,
        notes: 512,
      },
      rubi: {
        state: 'collapsed',
        edge: 'right',
        y: 0.42,
      },
    },
  };
  const save = await fetch(`${origin}/api/profile`, {
    method: 'PUT',
    headers: {
      cookie: initialCookie,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(changedProfile),
  });
  assert.equal(save.status, 200);
  const savedProfile = await save.json();

  const resetBody = {
    username: USERNAME,
    recoveryKey: RECOVERY_KEY,
    password: RESET_PASSWORD,
    passwordConfirmation: RESET_PASSWORD,
  };
  assert.equal((await accountMutation(origin, '/api/reset-password', resetBody, {
    requestOrigin: null,
  })).status, 403);
  assert.equal((await accountMutation(origin, '/api/reset-password', resetBody, {
    requestOrigin: 'https://example.invalid',
  })).status, 403);

  const genericBody = {
    ...resetBody,
    username: 'not-the-account',
    recoveryKey: 'not-the-recovery-key',
  };
  const generic = await accountMutation(origin, '/api/reset-password', genericBody);
  assert.equal(generic.status, 202);
  const genericPayload = await generic.json();
  assert.deepEqual(genericPayload, {
    ok: true,
    message: 'if the details matched, the password was updated. sign in.',
  });
  assert.equal((await login(origin, INITIAL_PASSWORD)).status, 200);

  const reset = await accountMutation(origin, '/api/reset-password', resetBody);
  assert.equal(reset.status, 202);
  assert.deepEqual(await reset.json(), genericPayload);
  assert.match(reset.headers.get('set-cookie'), /readings_session=;/);
  assert.equal((await fetch(`${origin}/api/catalog`, {
    headers: { cookie: initialCookie },
  })).status, 401);
  assert.equal((await login(origin, INITIAL_PASSWORD)).status, 401);

  const resetLogin = await login(origin, RESET_PASSWORD);
  assert.equal(resetLogin.status, 200);
  const resetCookie = resetLogin.headers.get('set-cookie').split(';')[0];
  const preserved = await fetch(`${origin}/api/profile`, {
    headers: { cookie: resetCookie },
  }).then((response) => response.json());
  assert.equal(preserved.preferences.fontSize, 22);
  assert.equal(preserved.layout.panels.notes, 512);
  assert.deepEqual(preserved.layout.rubi, changedProfile.layout.rubi);
  assert.equal(preserved.revision, savedProfile.revision);

  const registrationBody = {
    username: USERNAME,
    accessCode: ACCESS_CODE,
    password: REGISTERED_PASSWORD,
    passwordConfirmation: REGISTERED_PASSWORD,
  };
  const registration = await accountMutation(origin, '/api/register', registrationBody);
  assert.equal(registration.status, 202);
  assert.deepEqual(await registration.json(), genericPayload);
  assert.equal((await fetch(`${origin}/api/auth-capabilities`).then((response) => response.json())).registration, false);
  assert.equal((await fetch(`${origin}/api/catalog`, {
    headers: { cookie: resetCookie },
  })).status, 401);
  assert.equal((await login(origin, RESET_PASSWORD)).status, 401);
  assert.equal((await login(origin, REGISTERED_PASSWORD)).status, 200);

  const closedRegistration = await accountMutation(origin, '/api/register', {
    ...registrationBody,
    password: UNUSED_PASSWORD,
    passwordConfirmation: UNUSED_PASSWORD,
  });
  assert.equal(closedRegistration.status, 202);
  assert.equal((await login(origin, REGISTERED_PASSWORD)).status, 200);
  assert.equal((await login(origin, UNUSED_PASSWORD)).status, 401);

  assert.doesNotMatch(output(), new RegExp([
    INITIAL_PASSWORD,
    RESET_PASSWORD,
    REGISTERED_PASSWORD,
    RECOVERY_KEY,
    ACCESS_CODE,
  ].join('|'), 'u'));
});
