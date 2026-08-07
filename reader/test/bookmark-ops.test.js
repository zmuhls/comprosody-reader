import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookmarkMatchesPage,
  bookmarkOutboxKey,
  createBookmarkOperationQueue,
  overlayBookmarkOperations,
  readBookmarkOperations,
} from '../public/bookmark-ops.js';

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('outbox keys and restored operations are isolated by account and book', () => {
  const local = storage();
  const accountA = bookmarkOutboxKey('account-a', 'alpha-reading');
  const accountB = bookmarkOutboxKey('account-b', 'alpha-reading');
  const otherBook = bookmarkOutboxKey('account-a', 'beta-reading');
  assert.notEqual(accountA, accountB);
  assert.notEqual(accountA, otherBook);

  local.setItem(accountA, JSON.stringify({
    version: 1,
    jobs: [{
      slug: 'bookmark-one',
      revision: 1,
      body: {
        type: 'put',
        cfi: 'epubcfi(/6/4!/4/2:0)',
        createdAt: '2026-07-25T12:00:00.000Z',
      },
    }],
  }));
  assert.equal(readBookmarkOperations(local, accountA).length, 1);
  assert.deepEqual(readBookmarkOperations(local, accountB), []);
  assert.deepEqual(readBookmarkOperations(local, otherBook), []);
});

test('pending item operations overlay remote state without whole-list deletion inference', () => {
  const remote = [{
    id: 'remote',
    cfi: 'epubcfi(/6/2!/4/2:0)',
    createdAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
  }, {
    id: 'removed',
    cfi: 'epubcfi(/6/3!/4/2:0)',
    createdAt: '2026-07-25T10:30:00.000Z',
    updatedAt: '2026-07-25T10:30:00.000Z',
  }];
  const effective = overlayBookmarkOperations(remote, [{
    id: 'local',
    type: 'put',
    cfi: 'epubcfi(/6/4!/4/2:0)',
    createdAt: '2026-07-25T11:00:00.000Z',
  }, {
    id: 'removed',
    type: 'delete',
  }]);
  assert.deepEqual(effective.map(({ id }) => id), ['remote', 'local']);
});

test('offline operations survive reload and wait for hydrated queue flush', async () => {
  const local = storage();
  const firstRequests = [];
  const first = createBookmarkOperationQueue({
    accountScope: 'account-a',
    book: 'alpha-reading',
    storage: local,
    isOnline: () => false,
    request: (operation) => { firstRequests.push(operation); },
  });
  const queued = first.enqueue('bookmark-one', {
    type: 'put',
    cfi: 'epubcfi(/6/4!/4/2:0)',
    createdAt: '2026-07-25T12:00:00.000Z',
  });
  void queued.acknowledged.catch(() => {});
  assert.equal(firstRequests.length, 0);
  first.destroy();

  const secondRequests = [];
  const second = createBookmarkOperationQueue({
    accountScope: 'account-a',
    book: 'alpha-reading',
    storage: local,
    isOnline: () => true,
    request: async (operation) => {
      secondRequests.push(operation);
      return { ok: true };
    },
  });
  assert.equal(secondRequests.length, 0, 'restoration alone must not mutate the server');
  assert.deepEqual(second.overlay([]).map(({ id }) => id), ['bookmark-one']);
  await second.flush();
  assert.equal(secondRequests.length, 1);
  assert.equal(second.dirty(), false);
  assert.deepEqual(
    second.overlay([]),
    [],
    'an acknowledged PUT must not overlay a newer remote tombstone on next hydration',
  );
});

test('page matching tolerates reflow by using generated location bounds', () => {
  const generated = new Map([
    ['epubcfi(/6/4!/4/2:0)', 20],
    ['epubcfi(/6/4!/4/8:0)', 24],
    ['epubcfi(/6/4!/4/5:0)', 22],
    ['epubcfi(/6/4!/4/12:0)', 28],
  ]);
  const locations = { locationFromCfi: (cfi) => generated.get(cfi) };
  const page = {
    start: { cfi: 'epubcfi(/6/4!/4/2:0)' },
    end: { cfi: 'epubcfi(/6/4!/4/8:0)' },
  };
  assert.equal(
    bookmarkMatchesPage('epubcfi(/6/4!/4/5:0)', page, locations, page.start.cfi),
    true,
  );
  assert.equal(
    bookmarkMatchesPage('epubcfi(/6/4!/4/12:0)', page, locations, page.start.cfi),
    false,
  );
});
