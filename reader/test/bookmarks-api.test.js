import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const cwd = path.resolve('.');
const SECRET = 'bookmark-api-test-secret-value-0001';

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
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

test('bookmark API applies account-scoped, idempotent item operations with delete-wins', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-bookmarks-api-'));
  const filename = path.join(tmp, 'state.json');
  const catalogPath = path.join(tmp, 'catalog.json');
  fs.writeFileSync(catalogPath, `${JSON.stringify([{
    book: 'alpha-reading',
    title: 'Alpha Reading',
    author: 'Example Author',
    words: 1200,
    sections: 2,
  }])}\n`);
  const port = await availablePort();
  const env = {
    ...process.env,
    PORT: String(port),
    READINGS_USERNAME: 'bookmark-tester',
    READINGS_PASSWORD: 'bookmark-password',
    SESSION_SECRET: SECRET,
    DATA_PATH: filename,
    CATALOG_PATH: catalogPath,
  };
  for (const name of [
    'DATABASE_URL',
    'RAILWAY_ENVIRONMENT_ID',
    'NODE_ENV',
    'READINGS_EMAIL',
  ]) delete env[name];
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
    if (child.exitCode !== null) throw new Error(`server exited during startup: ${output.trim()}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (attempt === 79) throw new Error(`server did not start: ${output.trim()}`);
  }

  assert.equal((await fetch(`${origin}/api/bookmarks/alpha-reading`)).status, 401);

  const login = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'bookmark-tester',
      password: 'bookmark-password',
    }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = {
    cookie,
    'content-type': 'application/json',
    origin,
  };
  const bookmarkBody = JSON.stringify({
    cfi: 'epubcfi(/6/4!/4/2/2:12)',
    label: ' first page ',
  });

  const noOrigin = await fetch(`${origin}/api/bookmarks/alpha-reading/bookmark-one`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: bookmarkBody,
  });
  assert.equal(noOrigin.status, 403);
  const foreignOrigin = await fetch(`${origin}/api/bookmarks/alpha-reading/bookmark-one`, {
    method: 'PUT',
    headers: { ...headers, origin: 'https://example.invalid' },
    body: bookmarkBody,
  });
  assert.equal(foreignOrigin.status, 403);

  const retired = await fetch(`${origin}/api/bookmarks/alpha-reading`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ bookmarks: [] }),
  });
  assert.equal(retired.status, 410);

  const createdResponse = await fetch(
    `${origin}/api/bookmarks/alpha-reading/bookmark-one`,
    {
      method: 'PUT',
      headers,
      body: bookmarkBody,
    },
  );
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.created, true);
  assert.equal(created.deleted, false);
  assert.equal(created.bookmark.id, 'bookmark-one');
  assert.equal(created.bookmark.label, 'first page');

  const replay = await fetch(`${origin}/api/bookmarks/alpha-reading/bookmark-one`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      cfi: 'epubcfi(/6/99!/4/2:0)',
      label: 'stale replay',
    }),
  });
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).bookmark, created.bookmark);

  const concurrent = await Promise.all(['two', 'three'].map(async (suffix, index) => {
    const response = await fetch(
      `${origin}/api/bookmarks/alpha-reading/bookmark-${suffix}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ cfi: `epubcfi(/6/${6 + index * 2}!/4/2:0)` }),
      },
    );
    assert.equal(response.status, 201);
    return response.json();
  }));
  assert.deepEqual(
    concurrent.map(({ bookmark }) => bookmark.id).sort(),
    ['bookmark-three', 'bookmark-two'],
  );

  const hydratedResponse = await fetch(`${origin}/api/bookmarks/alpha-reading`, {
    headers: { cookie },
  });
  assert.equal(hydratedResponse.status, 200);
  const hydrated = await hydratedResponse.json();
  assert.match(hydrated.accountScope, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(
    hydrated.bookmarks.map(({ id }) => id).sort(),
    ['bookmark-one', 'bookmark-three', 'bookmark-two'],
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const removed = await fetch(
      `${origin}/api/bookmarks/alpha-reading/bookmark-one`,
      { method: 'DELETE', headers },
    );
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { id: 'bookmark-one', deleted: true });
  }
  const staleAfterDelete = await fetch(
    `${origin}/api/bookmarks/alpha-reading/bookmark-one`,
    {
      method: 'PUT',
      headers,
      body: bookmarkBody,
    },
  );
  assert.equal(staleAfterDelete.status, 200);
  assert.deepEqual(await staleAfterDelete.json(), {
    bookmark: null,
    deleted: true,
    created: false,
  });

  const rejectedBodyId = await fetch(
    `${origin}/api/bookmarks/alpha-reading/authoritative-id`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: 'body-id',
        accountId: 'request-controlled-account',
        cfi: 'epubcfi(/6/4!/4/2:0)',
      }),
    },
  );
  assert.equal(rejectedBodyId.status, 400);
  assert.equal((await rejectedBodyId.json()).error, 'invalid_bookmarks');
  assert.equal((await fetch(`${origin}/api/bookmarks/not-in-catalog`, {
    headers: { cookie },
  })).status, 404);

  const afterDelete = await fetch(`${origin}/api/bookmarks/alpha-reading`, {
    headers: { cookie },
  }).then((response) => response.json());
  assert.deepEqual(
    afterDelete.bookmarks.map(({ id }) => id).sort(),
    ['bookmark-three', 'bookmark-two'],
  );

  const state = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.equal(Object.hasOwn(state.bookmarkItems, 'request-controlled-account'), false);
  assert.equal(Object.keys(state.bookmarkItems).length, 1);
  const storedAccountId = Object.keys(state.bookmarkItems)[0];
  assert.notEqual(
    storedAccountId,
    hydrated.accountScope,
    'the browser scope must not expose the storage owner key',
  );
  const accountItems = state.bookmarkItems[storedAccountId]['alpha-reading'];
  assert.ok(accountItems['bookmark-one'].deletedAt);
});
