import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresStore } from '../lib/store.js';

class ReaderPool {
  constructor() {
    this.queries = [];
    this.state = new Map();
  }

  async query(sql, parameters = []) {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.queries.push({ sql: normalized, parameters });
    if (normalized.includes('CREATE TABLE IF NOT EXISTS reader_state')) return { rows: [] };
    if (normalized.startsWith('INSERT INTO reader_profile')) return { rows: [] };
    if (normalized.startsWith('INSERT INTO reader_account_state')
        && normalized.includes('SELECT $1,book_slug')) return { rows: [] };
    if (normalized.startsWith('SELECT annotations,progress FROM reader_account_state')) {
      const state = this.state.get(`${parameters[0]}:${parameters[1]}`);
      return { rows: state ? [structuredClone(state)] : [] };
    }
    if (normalized.startsWith('INSERT INTO reader_account_state')) {
      this.state.set(`${parameters[0]}:${parameters[1]}`, {
        annotations: JSON.parse(parameters[2]),
        progress: parameters[3],
      });
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${normalized}`);
  }

  async end() {}
}

test('postgres schema and writes keep reader progress account scoped', async () => {
  const pool = new ReaderPool();
  const store = new PostgresStore(undefined, {}, pool);
  await store.init();
  const schema = pool.queries[0].sql;
  assert.match(
    schema,
    /pg_advisory_xact_lock\(\s*hashtextextended\('readings:postgres-schema:v1'/,
  );
  assert.match(schema, /reader_account_state/);
  assert.match(schema, /PRIMARY KEY \(account_id, book_slug\)/);
  assert.match(schema, /reader_bookmarks/);
  assert.match(schema, /reader_bookmark_items/);

  await store.saveBookState(
    'account-a',
    'alpha-reading',
    [{ id: 'note-1' }],
    'epubcfi(/6/2!/4/2:0)',
  );
  assert.equal(
    (await store.getBookState('account-a', 'alpha-reading')).progress,
    'epubcfi(/6/2!/4/2:0)',
  );
  assert.deepEqual(await store.getBookState('account-b', 'alpha-reading'), {
    annotations: [],
    progress: null,
  });
});
