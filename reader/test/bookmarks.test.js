import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BookmarkValidationError,
  MAX_BOOKMARK_RECORDS_PER_BOOK,
  MAX_BOOKMARKS_PER_BOOK,
  normalizeBookmarkItem,
  normalizeBookmarkList,
} from '../lib/bookmarks.js';
import { FileStore, PostgresStore } from '../lib/store.js';

const NOW = '2026-07-25T12:00:00.000Z';
const BOOKMARK = {
  id: 'bookmark_one',
  cfi: 'epubcfi(/6/4!/4/2/2:12)',
  label: ' opening image ',
  createdAt: '2026-07-24T11:30:00-04:00',
};

test('item input uses the URL id and rejects client-controlled ownership fields', () => {
  assert.deepEqual(
    normalizeBookmarkItem(BOOKMARK.id, {
      cfi: BOOKMARK.cfi,
      label: BOOKMARK.label,
      createdAt: BOOKMARK.createdAt,
    }, { now: NOW }),
    {
      id: BOOKMARK.id,
      cfi: BOOKMARK.cfi,
      label: 'opening image',
      createdAt: '2026-07-24T15:30:00.000Z',
      updatedAt: NOW,
    },
  );

  for (const payload of [
    { ...BOOKMARK, id: 'body-controlled' },
    { cfi: BOOKMARK.cfi, accountId: 'body-controlled' },
    { cfi: 'chapter-1.html#opening' },
    { cfi: BOOKMARK.cfi, label: 'x'.repeat(161) },
  ]) {
    assert.throws(
      () => normalizeBookmarkItem(BOOKMARK.id, payload, { now: NOW }),
      BookmarkValidationError,
    );
  }
});

test('legacy whole-list input remains readable for migration validation only', () => {
  assert.deepEqual(
    normalizeBookmarkList({
      bookmarks: [{ ...BOOKMARK, updatedAt: '2000-01-01T00:00:00.000Z' }],
    }, { now: NOW }),
    [{
      id: BOOKMARK.id,
      cfi: BOOKMARK.cfi,
      label: 'opening image',
      createdAt: '2026-07-24T15:30:00.000Z',
      updatedAt: NOW,
    }],
  );
  assert.throws(
    () => normalizeBookmarkList({
      bookmarks: Array.from({ length: MAX_BOOKMARKS_PER_BOOK + 1 }, (_, index) => ({
        ...BOOKMARK,
        id: `bookmark_${index}`,
      })),
    }),
    BookmarkValidationError,
  );
});

test('file storage migrates legacy JSON read-only and keeps delete-wins item state isolated', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-bookmarks-store-'));
  const filename = path.join(tmp, 'state.json');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const legacyBookmark = normalizeBookmarkList({ bookmarks: [BOOKMARK] }, { now: NOW })[0];
  const legacy = {
    annotations: {},
    progress: {},
    accountState: {},
    bookmarks: { 'account-a': { 'alpha-reading': [legacyBookmark] } },
  };
  fs.writeFileSync(filename, `${JSON.stringify(legacy)}\n`);

  const store = new FileStore(filename);
  await store.init();
  assert.deepEqual(await store.getBookmarks('account-a', 'alpha-reading'), [legacyBookmark]);

  const two = {
    id: 'bookmark_two',
    cfi: 'epubcfi(/6/6!/4/2:0)',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const three = {
    id: 'bookmark_three',
    cfi: 'epubcfi(/6/8!/4/2:0)',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const [createdTwo, createdThree] = await Promise.all([
    store.upsertBookmark('account-a', 'alpha-reading', two),
    store.upsertBookmark('account-a', 'alpha-reading', three),
  ]);
  assert.equal(createdTwo.created, true);
  assert.equal(createdThree.created, true);
  assert.equal((await store.getBookmarks('account-a', 'alpha-reading')).length, 3);

  assert.deepEqual(
    await store.upsertBookmark('account-a', 'alpha-reading', { ...two, cfi: three.cfi }),
    { bookmark: two, deleted: false, created: false },
  );
  assert.deepEqual(await store.deleteBookmark('account-a', 'alpha-reading', two.id), {
    id: two.id,
    deleted: true,
  });
  assert.deepEqual(
    await store.upsertBookmark('account-a', 'alpha-reading', two),
    { bookmark: null, deleted: true, created: false },
  );
  await store.deleteBookmark('account-a', 'alpha-reading', two.id);

  assert.deepEqual(
    (await store.getBookmarks('account-a', 'alpha-reading')).map(({ id }) => id),
    [BOOKMARK.id, three.id],
  );
  assert.deepEqual(await store.getBookmarks('account-b', 'alpha-reading'), []);
  assert.deepEqual(await store.getBookmarks('account-a', 'beta-reading'), []);

  const restarted = new FileStore(filename);
  await restarted.init();
  assert.equal((await restarted.getBookmarks('account-a', 'alpha-reading')).length, 2);
  const disk = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assert.deepEqual(disk.bookmarks, legacy.bookmarks, 'legacy JSON must remain unchanged');
  assert.ok(disk.bookmarkItems['account-a']['alpha-reading'][two.id].deletedAt);
});

test('file storage preserves object-prototype ids and bounds permanent history', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-bookmark-keys-'));
  const filename = path.join(tmp, 'state.json');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const store = new FileStore(filename);
  await store.init();

  for (const id of ['__proto__', 'constructor', 'toString']) {
    const bookmark = {
      id,
      cfi: 'epubcfi(/6/4!/4/2:0)',
      createdAt: NOW,
      updatedAt: NOW,
    };
    assert.equal(
      (await store.upsertBookmark('account-a', 'alpha-reading', bookmark)).created,
      true,
    );
  }
  assert.deepEqual(
    (await store.getBookmarks('account-a', 'alpha-reading')).map(({ id }) => id).sort(),
    ['__proto__', 'constructor', 'toString'].sort(),
  );

  const disk = JSON.parse(fs.readFileSync(filename, 'utf8'));
  disk.bookmarkItems['account-a']['beta-reading'] = Object.fromEntries(
    Array.from({ length: MAX_BOOKMARK_RECORDS_PER_BOOK }, (_, index) => [
      `old_${index}`,
      {
        id: `old_${index}`,
        cfi: null,
        createdAt: null,
        updatedAt: NOW,
        deletedAt: NOW,
      },
    ]),
  );
  fs.writeFileSync(filename, `${JSON.stringify(disk)}\n`);
  const bounded = new FileStore(filename);
  await bounded.init();
  await assert.rejects(
    bounded.deleteBookmark('account-a', 'beta-reading', 'another'),
    (error) => error?.code === 'bookmark_history_limit',
  );
});

class BookmarkPool {
  constructor() {
    this.items = new Map();
    this.legacy = new Map();
    this.queries = [];
  }

  key(account, book, id) {
    return `${account}\u001f${book}\u001f${id}`;
  }

  async connect() {
    return {
      query: (sql, parameters) => this.query(sql, parameters),
      release() {},
    };
  }

  async query(sql, parameters = []) {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.queries.push({ sql: normalized, parameters: structuredClone(parameters) });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
    if (normalized.includes('CREATE TABLE IF NOT EXISTS reader_state')) return { rows: [] };
    if (normalized.startsWith('INSERT INTO reader_profile')) return { rows: [] };
    if (normalized.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (normalized.startsWith('SELECT bookmarks FROM reader_bookmarks')) {
      const value = this.legacy.get(`${parameters[0]}:${parameters[1]}`);
      return { rows: value ? [{ bookmarks: structuredClone(value) }] : [] };
    }
    if (normalized.startsWith('SELECT COUNT(*) FILTER')
        && normalized.includes('AS active_count')) {
      const prefix = `${parameters[0]}\u001f${parameters[1]}\u001f`;
      const matches = [...this.items.entries()].filter(([key]) => key.startsWith(prefix));
      const activeCount = matches
        .filter(([, value]) => !value.deletedAt)
        .length;
      return { rows: [{ active_count: activeCount, record_count: matches.length }] };
    }
    if (normalized.startsWith(
      'SELECT COUNT(*)::integer AS record_count FROM reader_bookmark_items',
    )) {
      const prefix = `${parameters[0]}\u001f${parameters[1]}\u001f`;
      const recordCount = [...this.items.keys()]
        .filter((key) => key.startsWith(prefix))
        .length;
      return { rows: [{ record_count: recordCount }] };
    }
    if (normalized.startsWith('SELECT bookmark_id AS id')
        && normalized.includes('bookmark_id=$3')) {
      const value = this.items.get(this.key(parameters[0], parameters[1], parameters[2]));
      return { rows: value ? [structuredClone(value)] : [] };
    }
    if (normalized.startsWith('SELECT bookmark_id AS id')
        && normalized.includes('deleted_at IS NULL')) {
      const prefix = `${parameters[0]}\u001f${parameters[1]}\u001f`;
      const rows = [...this.items.entries()]
        .filter(([key, value]) => key.startsWith(prefix) && !value.deletedAt)
        .map(([, value]) => structuredClone(value))
        .sort(
          (left, right) => left.createdAt.localeCompare(right.createdAt)
            || left.id.localeCompare(right.id),
        );
      return { rows };
    }
    if (normalized.startsWith('INSERT INTO reader_bookmark_items')
        && parameters.length === 7) {
      const [account, book, id, cfi, label, createdAt, updatedAt] = parameters;
      const key = this.key(account, book, id);
      if (this.items.has(key)) return { rows: [] };
      this.items.set(key, {
        id,
        cfi,
        label,
        createdAt,
        updatedAt,
        deletedAt: null,
      });
      return { rows: normalized.includes('RETURNING bookmark_id')
        ? [{ bookmark_id: id }]
        : [] };
    }
    if (normalized.startsWith('INSERT INTO reader_bookmark_items')
        && parameters.length === 3) {
      const [account, book, id] = parameters;
      const key = this.key(account, book, id);
      const now = new Date().toISOString();
      const existing = this.items.get(key);
      if (!existing) {
        this.items.set(key, {
          id,
          cfi: null,
          label: null,
          createdAt: null,
          updatedAt: now,
          deletedAt: now,
        });
      } else if (!existing.deletedAt) {
        existing.deletedAt = now;
        existing.updatedAt = now;
      }
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${normalized}`);
  }

  async end() {}
}

test('postgres storage uses per-item rows, read-only migration, and tombstones', async () => {
  const pool = new BookmarkPool();
  const legacyBookmark = normalizeBookmarkList({ bookmarks: [BOOKMARK] }, { now: NOW })[0];
  pool.legacy.set('account-a:alpha-reading', [legacyBookmark]);
  const store = new PostgresStore(undefined, {}, pool);
  await store.init();

  const migration = pool.queries.find(({ sql }) => (
    sql.includes('CREATE TABLE IF NOT EXISTS reader_bookmark_items')
  ));
  assert.match(migration.sql, /PRIMARY KEY \(account_id, book_slug, bookmark_id\)/u);
  assert.deepEqual(await store.getBookmarks('account-a', 'alpha-reading'), [legacyBookmark]);

  const second = {
    id: 'bookmark_two',
    cfi: 'epubcfi(/6/6!/4/2:0)',
    createdAt: NOW,
    updatedAt: NOW,
  };
  const third = {
    id: 'bookmark_three',
    cfi: 'epubcfi(/6/8!/4/2:0)',
    createdAt: NOW,
    updatedAt: NOW,
  };
  await Promise.all([
    store.upsertBookmark('account-a', 'alpha-reading', second),
    store.upsertBookmark('account-a', 'alpha-reading', third),
  ]);
  assert.equal((await store.getBookmarks('account-a', 'alpha-reading')).length, 3);

  await store.deleteBookmark('account-a', 'alpha-reading', second.id);
  const staleReplay = await store.upsertBookmark('account-a', 'alpha-reading', second);
  assert.deepEqual(staleReplay, { bookmark: null, deleted: true, created: false });
  assert.equal((await store.getBookmarks('account-a', 'alpha-reading')).length, 2);
  assert.deepEqual(await store.getBookmarks('account-b', 'alpha-reading'), []);
  assert.deepEqual(pool.legacy.get('account-a:alpha-reading'), [legacyBookmark]);
  assert.ok(pool.queries.some(({ sql }) => (
    sql.includes('ON CONFLICT(account_id,book_slug,bookmark_id) DO NOTHING')
  )));
  assert.ok(pool.queries.some(({ sql }) => (
    sql.includes('deleted_at=COALESCE(reader_bookmark_items.deleted_at,EXCLUDED.deleted_at)')
  )));

  const reserved = {
    id: '__proto__',
    cfi: 'epubcfi(/6/10!/4/2:0)',
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.equal(
    (await store.upsertBookmark('account-a', 'beta-reading', reserved)).created,
    true,
  );
  assert.equal((await store.getBookmarks('account-a', 'beta-reading'))[0].id, reserved.id);

  for (let index = 0; index < MAX_BOOKMARK_RECORDS_PER_BOOK; index += 1) {
    const id = `old_${index}`;
    pool.items.set(pool.key('bounded', 'beta-reading', id), {
      id,
      cfi: null,
      label: null,
      createdAt: null,
      updatedAt: NOW,
      deletedAt: NOW,
    });
  }
  await assert.rejects(
    store.deleteBookmark('bounded', 'beta-reading', 'another'),
    (error) => error?.code === 'bookmark_history_limit',
  );
  await assert.rejects(
    store.upsertBookmark('bounded', 'beta-reading', {
      id: 'new_active',
      cfi: 'epubcfi(/6/12!/4/2:0)',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    (error) => error?.code === 'bookmark_history_limit',
  );
});
