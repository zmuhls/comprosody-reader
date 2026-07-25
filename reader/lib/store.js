import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import {
  MAX_BOOKMARK_RECORDS_PER_BOOK,
  MAX_BOOKMARKS_PER_BOOK,
} from './bookmarks.js';

function clone(value) {
  return structuredClone(value);
}

function requireBookScope(accountId, book) {
  if (typeof accountId !== 'string' || !accountId.trim()) {
    throw new TypeError('An authenticated account is required for reader state.');
  }
  if (typeof book !== 'string' || !book.trim()) {
    throw new TypeError('A book is required for reader state.');
  }
}

function copyBookState(annotations, progress) {
  return {
    annotations: Array.isArray(annotations) ? clone(annotations) : [],
    progress: typeof progress === 'string' ? progress : null,
  };
}

function requireBookmarkScope(accountId, book) {
  requireBookScope(accountId, book);
}

function isoTimestamp(value, fallback = null) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizeStoredBookmark(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const cfi = typeof value.cfi === 'string' ? value.cfi.trim() : '';
  if (!id || !cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) return null;
  const createdAt = isoTimestamp(value.createdAt, new Date().toISOString());
  const updatedAt = isoTimestamp(value.updatedAt, createdAt);
  const label = typeof value.label === 'string' && value.label.trim()
    ? value.label.trim()
    : undefined;
  return {
    id,
    cfi,
    ...(label ? { label } : {}),
    createdAt,
    updatedAt,
  };
}

function bookmarkFromRecord(record) {
  if (!record || record.deletedAt || record.deleted_at) return null;
  const id = record.id ?? record.bookmark_id;
  const cfi = record.cfi;
  const createdAt = isoTimestamp(record.createdAt ?? record.created_at);
  const updatedAt = isoTimestamp(record.updatedAt ?? record.updated_at, createdAt);
  if (!id || !cfi || !createdAt || !updatedAt) return null;
  const label = typeof record.label === 'string' && record.label
    ? record.label
    : undefined;
  return {
    id,
    cfi,
    ...(label ? { label } : {}),
    createdAt,
    updatedAt,
  };
}

function sortBookmarks(bookmarks) {
  return bookmarks.sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id),
  );
}

function newProfileRecord(initialProfile) {
  return { document: clone(initialProfile), revision: 0, updatedAt: null };
}

function validateStoredProfileRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || !record.document || typeof record.document !== 'object' || Array.isArray(record.document)
      || !Number.isSafeInteger(record.revision) || record.revision < 0
      || (record.updatedAt !== null && typeof record.updatedAt !== 'string')) {
    throw new Error('The stored profile record is invalid.');
  }
  return record;
}

function copyProfileRecord(record) {
  const valid = validateStoredProfileRecord(record);
  return {
    document: clone(valid.document),
    revision: valid.revision,
    updatedAt: valid.updatedAt,
  };
}

export class ProfileConflictError extends Error {
  constructor(current) {
    super('The profile changed after it was loaded.');
    this.name = 'ProfileConflictError';
    this.code = 'profile_conflict';
    this.current = copyProfileRecord(current);
  }
}

export class BookmarkLimitError extends Error {
  constructor(kind = 'active') {
    const history = kind === 'history';
    super(history
      ? 'This book has reached its bookmark history limit.'
      : `A book can contain at most ${MAX_BOOKMARKS_PER_BOOK} bookmarks.`);
    this.name = 'BookmarkLimitError';
    this.code = history ? 'bookmark_history_limit' : 'bookmark_limit';
  }
}

function bookmarkItemDictionary(data, accountId, book) {
  data.bookmarkItems ||= {};
  data.bookmarkItems[accountId] ||= {};
  const stored = Object.hasOwn(data.bookmarkItems[accountId], book)
    && data.bookmarkItems[accountId][book]
    && typeof data.bookmarkItems[accountId][book] === 'object'
    && !Array.isArray(data.bookmarkItems[accountId][book])
    ? data.bookmarkItems[accountId][book]
    : {};
  const items = Object.assign(Object.create(null), stored);
  data.bookmarkItems[accountId][book] = items;
  return items;
}

class FileStore {
  constructor(filename, initialProfile = {}) {
    this.filename = filename;
    this.initialProfile = clone(initialProfile);
  }

  emptyState() {
    return {
      accountState: {},
      bookmarks: {},
      bookmarkItems: {},
      profile: newProfileRecord(this.initialProfile),
    };
  }

  async init() {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    if (!fs.existsSync(this.filename)) this.write(this.emptyState());
    const data = this.read();
    if (!data.accountState || typeof data.accountState !== 'object' || Array.isArray(data.accountState)) {
      data.accountState = {};
    }
    if (!data.bookmarks || typeof data.bookmarks !== 'object' || Array.isArray(data.bookmarks)) {
      data.bookmarks = {};
    }
    if (!data.bookmarkItems
        || typeof data.bookmarkItems !== 'object'
        || Array.isArray(data.bookmarkItems)) {
      data.bookmarkItems = {};
    }
    if (!Object.hasOwn(data, 'profile')) {
      data.profile = newProfileRecord(this.initialProfile);
    }
    validateStoredProfileRecord(data.profile);
    this.write(data);
  }

  read() {
    return JSON.parse(fs.readFileSync(this.filename, 'utf8'));
  }

  write(data) {
    const temp = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.filename);
  }

  async getProfile() {
    return copyProfileRecord(this.read().profile);
  }

  async saveProfile(document, expectedRevision) {
    const data = this.read();
    const current = validateStoredProfileRecord(data.profile);
    if (current.revision !== expectedRevision) throw new ProfileConflictError(current);
    const next = {
      document: clone(document),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    data.profile = next;
    this.write(data);
    return copyProfileRecord(next);
  }

  async getBookState(accountId, book) {
    requireBookScope(accountId, book);
    const data = this.read();
    const existing = data.accountState?.[accountId]?.[book];
    if (existing) return copyBookState(existing.annotations, existing.progress);

    const hasLegacyAnnotations = Boolean(
      data.annotations && Object.hasOwn(data.annotations, book),
    );
    const hasLegacyProgress = Boolean(
      data.progress && Object.hasOwn(data.progress, book),
    );
    if (!hasLegacyAnnotations && !hasLegacyProgress) return copyBookState([], null);

    const migrated = copyBookState(data.annotations?.[book], data.progress?.[book]);
    data.accountState ||= {};
    data.accountState[accountId] ||= {};
    data.accountState[accountId][book] = migrated;
    this.write(data);
    return copyBookState(migrated.annotations, migrated.progress);
  }

  async saveBookState(accountId, book, annotations, progress) {
    requireBookScope(accountId, book);
    const data = this.read();
    data.accountState ||= {};
    data.accountState[accountId] ||= {};
    data.accountState[accountId][book] = copyBookState(annotations, progress);
    this.write(data);
  }

  async getBookmarks(accountId, book) {
    requireBookmarkScope(accountId, book);
    const data = this.read();
    const items = bookmarkItemDictionary(data, accountId, book);
    let migrated = false;
    for (const legacy of data.bookmarks?.[accountId]?.[book] || []) {
      const bookmark = normalizeStoredBookmark(legacy);
      if (!bookmark || Object.hasOwn(items, bookmark.id)) continue;
      items[bookmark.id] = { ...bookmark, deletedAt: null };
      migrated = true;
    }
    if (migrated) this.write(data);
    return sortBookmarks(
      Object.values(items).map(bookmarkFromRecord).filter(Boolean),
    ).map(clone);
  }

  async upsertBookmark(accountId, book, bookmark) {
    requireBookmarkScope(accountId, book);
    const data = this.read();
    const items = bookmarkItemDictionary(data, accountId, book);
    for (const legacy of data.bookmarks?.[accountId]?.[book] || []) {
      const candidate = normalizeStoredBookmark(legacy);
      if (candidate && !Object.hasOwn(items, candidate.id)) {
        items[candidate.id] = { ...candidate, deletedAt: null };
      }
    }
    const existing = Object.hasOwn(items, bookmark.id) ? items[bookmark.id] : undefined;
    if (existing) {
      const active = bookmarkFromRecord(existing);
      this.write(data);
      return { bookmark: active ? clone(active) : null, deleted: !active, created: false };
    }
    const activeCount = Object.values(items).filter((item) => bookmarkFromRecord(item)).length;
    if (activeCount >= MAX_BOOKMARKS_PER_BOOK) throw new BookmarkLimitError();
    if (Object.keys(items).length >= MAX_BOOKMARK_RECORDS_PER_BOOK) {
      throw new BookmarkLimitError('history');
    }
    items[bookmark.id] = { ...clone(bookmark), deletedAt: null };
    this.write(data);
    return { bookmark: clone(bookmark), deleted: false, created: true };
  }

  async deleteBookmark(accountId, book, id) {
    requireBookmarkScope(accountId, book);
    const data = this.read();
    const items = bookmarkItemDictionary(data, accountId, book);
    let changed = false;
    for (const legacy of data.bookmarks?.[accountId]?.[book] || []) {
      const candidate = normalizeStoredBookmark(legacy);
      if (candidate && !Object.hasOwn(items, candidate.id)) {
        items[candidate.id] = { ...candidate, deletedAt: null };
        changed = true;
      }
    }
    const existing = Object.hasOwn(items, id) ? items[id] : undefined;
    if (!existing && Object.keys(items).length >= MAX_BOOKMARK_RECORDS_PER_BOOK) {
      throw new BookmarkLimitError('history');
    }
    if (!existing?.deletedAt) {
      const deletedAt = new Date().toISOString();
      items[id] = existing
        ? { ...existing, updatedAt: deletedAt, deletedAt }
        : {
            id,
            cfi: null,
            createdAt: null,
            updatedAt: deletedAt,
            deletedAt,
          };
      changed = true;
    }
    if (changed) this.write(data);
    return { id, deleted: true };
  }

  async close() {}
}

class PostgresStore {
  constructor(connectionString, initialProfile = {}, pool) {
    this.pool = pool || new Pool({ connectionString });
    this.initialProfile = clone(initialProfile);
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS reader_state (
        book_slug TEXT PRIMARY KEY,
        annotations JSONB NOT NULL DEFAULT '[]',
        progress TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reader_account_state (
        account_id TEXT NOT NULL,
        book_slug TEXT NOT NULL,
        annotations JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(annotations) = 'array'),
        progress TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, book_slug)
      );
      CREATE TABLE IF NOT EXISTS reader_profile (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        updated_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS reader_bookmarks (
        account_id TEXT NOT NULL,
        book_slug TEXT NOT NULL,
        bookmarks JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(bookmarks) = 'array'),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, book_slug)
      );
      CREATE INDEX IF NOT EXISTS reader_bookmarks_account_idx
        ON reader_bookmarks(account_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS reader_bookmark_items (
        account_id TEXT NOT NULL,
        book_slug TEXT NOT NULL,
        bookmark_id TEXT NOT NULL,
        cfi TEXT,
        label TEXT,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CHECK (
          deleted_at IS NOT NULL
          OR (cfi IS NOT NULL AND created_at IS NOT NULL)
        ),
        PRIMARY KEY (account_id, book_slug, bookmark_id)
      );
      CREATE INDEX IF NOT EXISTS reader_bookmark_items_active_idx
        ON reader_bookmark_items(account_id, book_slug, created_at, bookmark_id)
        WHERE deleted_at IS NULL;
    `);
    await this.pool.query(
      `INSERT INTO reader_profile(id,document,revision,updated_at)
       VALUES(1,$1::jsonb,0,NULL)
       ON CONFLICT(id) DO NOTHING`,
      [JSON.stringify(this.initialProfile)],
    );
  }

  async getBookState(accountId, book) {
    requireBookScope(accountId, book);
    const migrated = await this.pool.query(`
      INSERT INTO reader_account_state(account_id,book_slug,annotations,progress,updated_at)
      SELECT $1,book_slug,annotations,progress,updated_at
      FROM reader_state
      WHERE book_slug=$2
      ON CONFLICT(account_id,book_slug) DO NOTHING
      RETURNING annotations,progress
    `, [accountId, book]);
    if (migrated.rows[0]) {
      return copyBookState(migrated.rows[0].annotations, migrated.rows[0].progress);
    }
    const { rows } = await this.pool.query(
      'SELECT annotations,progress FROM reader_account_state WHERE account_id=$1 AND book_slug=$2',
      [accountId, book],
    );
    return copyBookState(rows[0]?.annotations, rows[0]?.progress);
  }

  async saveBookState(accountId, book, annotations, progress) {
    requireBookScope(accountId, book);
    const state = copyBookState(annotations, progress);
    await this.pool.query(`
      INSERT INTO reader_account_state(account_id,book_slug,annotations,progress)
      VALUES($1,$2,$3::jsonb,$4)
      ON CONFLICT(account_id,book_slug) DO UPDATE
      SET annotations=EXCLUDED.annotations,progress=EXCLUDED.progress,updated_at=NOW()
    `, [accountId, book, JSON.stringify(state.annotations), state.progress]);
  }

  async getBookmarks(accountId, book) {
    requireBookmarkScope(accountId, book);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockBookmarks(client, accountId, book);
      await this.importLegacyBookmarks(client, accountId, book);
      const { rows } = await client.query(`
        SELECT
          bookmark_id AS id,
          cfi,
          label,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM reader_bookmark_items
        WHERE account_id=$1 AND book_slug=$2 AND deleted_at IS NULL
        ORDER BY created_at ASC, bookmark_id ASC
      `, [accountId, book]);
      await client.query('COMMIT');
      return rows.map(bookmarkFromRecord).filter(Boolean);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async lockBookmarks(client, accountId, book) {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))`,
      [accountId, book],
    );
  }

  async importLegacyBookmarks(client, accountId, book) {
    const { rows } = await client.query(
      'SELECT bookmarks FROM reader_bookmarks WHERE account_id=$1 AND book_slug=$2',
      [accountId, book],
    );
    for (const legacy of rows[0]?.bookmarks || []) {
      const bookmark = normalizeStoredBookmark(legacy);
      if (!bookmark) continue;
      await client.query(`
        INSERT INTO reader_bookmark_items(
          account_id,book_slug,bookmark_id,cfi,label,created_at,updated_at,deleted_at
        )
        VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,NULL)
        ON CONFLICT(account_id,book_slug,bookmark_id) DO NOTHING
      `, [
        accountId,
        book,
        bookmark.id,
        bookmark.cfi,
        bookmark.label || null,
        bookmark.createdAt,
        bookmark.updatedAt,
      ]);
    }
  }

  async upsertBookmark(accountId, book, bookmark) {
    requireBookmarkScope(accountId, book);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockBookmarks(client, accountId, book);
      await this.importLegacyBookmarks(client, accountId, book);
      const existing = await client.query(`
        SELECT
          bookmark_id AS id,
          cfi,
          label,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM reader_bookmark_items
        WHERE account_id=$1 AND book_slug=$2 AND bookmark_id=$3
      `, [accountId, book, bookmark.id]);
      let created = false;
      if (!existing.rows[0]) {
        const count = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE deleted_at IS NULL)::integer AS active_count,
            COUNT(*)::integer AS record_count
          FROM reader_bookmark_items
          WHERE account_id=$1 AND book_slug=$2
        `, [accountId, book]);
        if (Number(count.rows[0]?.active_count || 0) >= MAX_BOOKMARKS_PER_BOOK) {
          throw new BookmarkLimitError();
        }
        if (Number(count.rows[0]?.record_count || 0) >= MAX_BOOKMARK_RECORDS_PER_BOOK) {
          throw new BookmarkLimitError('history');
        }
        const inserted = await client.query(`
          INSERT INTO reader_bookmark_items(
            account_id,book_slug,bookmark_id,cfi,label,created_at,updated_at,deleted_at
          )
          VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,NULL)
          ON CONFLICT(account_id,book_slug,bookmark_id) DO NOTHING
          RETURNING bookmark_id
        `, [
          accountId,
          book,
          bookmark.id,
          bookmark.cfi,
          bookmark.label || null,
          bookmark.createdAt,
          bookmark.updatedAt,
        ]);
        created = Boolean(inserted.rows[0]);
      }
      const { rows } = await client.query(`
        SELECT
          bookmark_id AS id,
          cfi,
          label,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM reader_bookmark_items
        WHERE account_id=$1 AND book_slug=$2 AND bookmark_id=$3
      `, [accountId, book, bookmark.id]);
      await client.query('COMMIT');
      const active = bookmarkFromRecord(rows[0]);
      return { bookmark: active, deleted: !active, created: active ? created : false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteBookmark(accountId, book, id) {
    requireBookmarkScope(accountId, book);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockBookmarks(client, accountId, book);
      await this.importLegacyBookmarks(client, accountId, book);
      const existing = await client.query(`
        SELECT
          bookmark_id AS id,
          cfi,
          label,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM reader_bookmark_items
        WHERE account_id=$1 AND book_slug=$2 AND bookmark_id=$3
      `, [accountId, book, id]);
      if (!existing.rows[0]) {
        const count = await client.query(`
          SELECT COUNT(*)::integer AS record_count
          FROM reader_bookmark_items
          WHERE account_id=$1 AND book_slug=$2
        `, [accountId, book]);
        if (Number(count.rows[0]?.record_count || 0) >= MAX_BOOKMARK_RECORDS_PER_BOOK) {
          throw new BookmarkLimitError('history');
        }
      }
      await client.query(`
        INSERT INTO reader_bookmark_items(
          account_id,book_slug,bookmark_id,cfi,label,created_at,updated_at,deleted_at
        )
        VALUES($1,$2,$3,NULL,NULL,NULL,NOW(),NOW())
        ON CONFLICT(account_id,book_slug,bookmark_id) DO UPDATE
        SET
          deleted_at=COALESCE(reader_bookmark_items.deleted_at,EXCLUDED.deleted_at),
          updated_at=CASE
            WHEN reader_bookmark_items.deleted_at IS NULL THEN EXCLUDED.updated_at
            ELSE reader_bookmark_items.updated_at
          END
      `, [accountId, book, id]);
      await client.query('COMMIT');
      return { id, deleted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getProfile() {
    const { rows } = await this.pool.query(`
      SELECT document,revision,updated_at AS "updatedAt"
      FROM reader_profile
      WHERE id=1
    `);
    if (!rows[0]) throw new Error('The profile record is missing.');
    return {
      document: clone(rows[0].document),
      revision: Number(rows[0].revision),
      updatedAt: rows[0].updatedAt ? new Date(rows[0].updatedAt).toISOString() : null,
    };
  }

  async saveProfile(document, expectedRevision) {
    const updatedAt = new Date().toISOString();
    const { rows } = await this.pool.query(`
      UPDATE reader_profile
      SET document=$1::jsonb,revision=revision+1,updated_at=$3::timestamptz
      WHERE id=1 AND revision=$2
      RETURNING document,revision,updated_at AS "updatedAt"
    `, [JSON.stringify(document), expectedRevision, updatedAt]);
    if (!rows[0]) throw new ProfileConflictError(await this.getProfile());
    return {
      document: clone(rows[0].document),
      revision: Number(rows[0].revision),
      updatedAt: rows[0].updatedAt ? new Date(rows[0].updatedAt).toISOString() : null,
    };
  }

  async close() {
    await this.pool.end();
  }
}

export function createStore({ connectionString, filename, initialProfile = {}, pool }) {
  return connectionString || pool
    ? new PostgresStore(connectionString, initialProfile, pool)
    : new FileStore(filename, initialProfile);
}

export { FileStore, PostgresStore };
