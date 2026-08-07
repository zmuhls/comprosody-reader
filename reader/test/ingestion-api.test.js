import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve('.');

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

async function startServer(t, { ollamaKey } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readings-ingestion-api-'));
  const port = await availablePort();
  const env = {
    ...process.env,
    PORT: String(port),
    READINGS_USERNAME: 'ingestion-tester',
    READINGS_PASSWORD: 'test-password',
    SESSION_SECRET: 'ingestion-api-test-secret-value-0001',
    DATA_PATH: path.join(tmp, 'state.json'),
  };
  delete env.DATABASE_URL;
  delete env.OLLAMA_API_KEY;
  delete env.RAILWAY_ENVIRONMENT_ID;
  delete env.NODE_ENV;
  if (ollamaKey) env.OLLAMA_API_KEY = ollamaKey;
  const child = spawn(process.execPath, ['server.js'], {
    cwd,
    env,
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
    if (child.exitCode !== null) throw new Error(`Server exited during startup: ${output.trim()}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return origin;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not start: ${output.trim()}`);
}

async function login(origin) {
  const response = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({
      username: 'ingestion-tester',
      password: 'test-password',
    }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

const textOnlyPayload = {
  pages: [{ pageNumber: 1, text: 'faithfully extracted page text for a test document.' }],
  metadata: { title: 'test reading', author: 'test author', language: 'en' },
};

test('ingestion routes require authentication, a same-origin mutation, and server configuration', async (t) => {
  const origin = await startServer(t);
  const body = JSON.stringify(textOnlyPayload);

  const unauthorizedCapability = await fetch(`${origin}/api/ingestion-capabilities`);
  assert.equal(unauthorizedCapability.status, 401);

  const unauthorized = await fetch(`${origin}/api/ingestions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body,
  });
  assert.equal(unauthorized.status, 401);

  const cookie = await login(origin);
  const capability = await fetch(`${origin}/api/ingestion-capabilities`, {
    headers: { cookie },
  });
  assert.equal(capability.status, 200);
  assert.deepEqual(await capability.json(), {
    schemaVersion: 1,
    available: false,
    provider: 'ollama-cloud',
    model: 'glm-5.2',
    cycles: ['structure', 'encoding_ocr', 'fidelity_review'],
    extraction: 'browser',
    pdfUploaded: false,
    maxSourceCharacters: 2_000_000,
  });

  const missingOrigin = await fetch(`${origin}/api/ingestions`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body,
  });
  assert.equal(missingOrigin.status, 403);
  assert.deepEqual(await missingOrigin.json(), {
    error: 'invalid_origin',
    message: 'request origin could not be verified.',
  });

  const foreignOrigin = await fetch(`${origin}/api/ingestions`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin: 'https://example.invalid' },
    body,
  });
  assert.equal(foreignOrigin.status, 403);

  const unavailable = await fetch(`${origin}/api/ingestions`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin },
    body,
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: 'ingestion_not_configured',
    message: 'ingestion is not configured yet.',
  });

  const malformedUnavailable = await fetch(`${origin}/api/ingestions`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', origin },
    body: '{',
  });
  assert.equal(malformedUnavailable.status, 503);
  assert.deepEqual(await malformedUnavailable.json(), {
    error: 'ingestion_not_configured',
    message: 'ingestion is not configured yet.',
  });

  const unknown = await fetch(`${origin}/api/ingestions/not-a-job`, { headers: { cookie } });
  assert.equal(unknown.status, 404);
  const cancelUnknown = await fetch(`${origin}/api/ingestions/not-a-job`, {
    method: 'DELETE',
    headers: { cookie, origin },
  });
  assert.equal(cancelUnknown.status, 404);
});

test('readiness reports the configured contract without invoking the model', async (t) => {
  const origin = await startServer(t, { ollamaKey: 'unit-test-key' });
  const cookie = await login(origin);
  const response = await fetch(`${origin}/api/ingestion-capabilities`, {
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    available: true,
    provider: 'ollama-cloud',
    model: 'glm-5.2',
    cycles: ['structure', 'encoding_ocr', 'fidelity_review'],
    extraction: 'browser',
    pdfUploaded: false,
    maxSourceCharacters: 2_000_000,
  });
});
