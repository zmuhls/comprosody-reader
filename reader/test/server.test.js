import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function startServer(t, catalog = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-server-'));
  const catalogPath = path.join(tmp, 'catalog.json');
  const booksPath = path.join(tmp, 'books');
  const dataPath = path.join(tmp, 'state.json');
  fs.mkdirSync(booksPath);
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`);
  for (const entry of catalog) {
    fs.writeFileSync(path.join(booksPath, `${entry.book}.epub`), 'synthetic epub');
  }
  const port = await availablePort();
  const env = {
    ...process.env,
    PORT: String(port),
    READINGS_USERNAME: 'reader-tester',
    READINGS_PASSWORD: 'test-password',
    SESSION_SECRET: 'reader-server-test-secret-value-0001',
    DATA_PATH: dataPath,
    CATALOG_PATH: catalogPath,
    BOOKS_PATH: booksPath,
  };
  for (const name of [
    'DATABASE_URL',
    'OLLAMA_API_KEY',
    'RAILWAY_ENVIRONMENT_ID',
    'NODE_ENV',
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
    if (child.exitCode !== null) throw new Error(`server exited: ${output.trim()}`);
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        return { origin, dataPath };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${output.trim()}`);
}

async function login(origin) {
  const response = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'reader-tester',
      password: 'test-password',
    }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('empty public catalog is valid and exposes no arbitrary book state', async (t) => {
  const { origin } = await startServer(t);
  assert.equal((await fetch(`${origin}/grid-motion.js`)).status, 200);
  assert.equal((await fetch(`${origin}/login.js`)).status, 200);
  const cookie = await login(origin);
  assert.deepEqual(
    await fetch(`${origin}/api/catalog`, { headers: { cookie } }).then((response) => response.json()),
    [],
  );
  const profile = await fetch(`${origin}/api/profile`, { headers: { cookie } })
    .then((response) => response.json());
  assert.deepEqual(profile.books, []);
  for (const pathname of [
    '/books/unknown-reading.epub',
    '/api/annotations/unknown-reading',
    '/api/bookmarks/unknown-reading',
  ]) {
    assert.equal(
      (await fetch(`${origin}${pathname}`, { headers: { cookie } })).status,
      404,
      pathname,
    );
  }
});

test('authenticated PDF-looking routes fail closed before the reader fallback', async (t) => {
  const { origin } = await startServer(t);
  const cookie = await login(origin);
  for (const pathname of [
    '/source/example.pdf',
    '/books/example.pdf',
    '/example.pdf',
    '/nested/EXAMPLE.PDF?download=1',
  ]) {
    const response = await fetch(`${origin}${pathname}`, {
      headers: { cookie },
      redirect: 'manual',
    });
    assert.equal(response.status, 404, pathname);
    assert.doesNotMatch(
      response.headers.get('content-type') || '',
      /(?:text\/html|application\/pdf)/iu,
      pathname,
    );
  }
});

test('resume state and bookmarks persist under the verified account identity', async (t) => {
  const catalog = [{
    book: 'example-reading',
    title: 'Example Reading',
    author: 'Example Author',
    words: 1200,
    sections: 2,
  }];
  const { origin, dataPath } = await startServer(t, catalog);
  const cookie = await login(origin);
  const download = await fetch(`${origin}/books/example-reading.epub`, {
    headers: { cookie },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-type'), /application\/epub\+zip/u);

  const progress = 'epubcfi(/6/2!/4/2:0)';
  const annotation = {
    id: 'note-1',
    cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
    text: 'test',
    note: 'note',
    createdAt: '2026-07-25T12:00:00.000Z',
  };
  const stateResponse = await fetch(`${origin}/api/annotations/example-reading`, {
    method: 'PUT',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      accountId: 'request-controlled-account',
      annotations: [annotation],
      progress,
    }),
  });
  assert.equal(stateResponse.status, 200);
  const bookmarkResponse = await fetch(
    `${origin}/api/bookmarks/example-reading/bookmark-1`,
    {
    method: 'PUT',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      cfi: progress,
      label: 'page 1',
      createdAt: '2026-07-25T12:00:00.000Z',
    }),
  },
  );
  assert.equal(bookmarkResponse.status, 201);

  const savedState = await fetch(`${origin}/api/annotations/example-reading`, {
    headers: { cookie },
  }).then((response) => response.json());
  const savedBookmarks = await fetch(`${origin}/api/bookmarks/example-reading`, {
    headers: { cookie },
  }).then((response) => response.json());
  assert.equal(savedState.progress, progress);
  assert.equal(savedBookmarks.bookmarks[0].id, 'bookmark-1');
  assert.match(savedBookmarks.accountScope, /^[A-Za-z0-9_-]{43}$/u);

  const disk = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const accountId = crypto
    .createHash('sha256')
    .update('readings:reader-tester')
    .digest('hex');
  assert.deepEqual(Object.keys(disk.accountState), [accountId]);
  assert.deepEqual(Object.keys(disk.bookmarkItems), [accountId]);
  assert.equal(Object.hasOwn(disk.accountState, 'request-controlled-account'), false);
  assert.notEqual(savedBookmarks.accountScope, accountId);
});
