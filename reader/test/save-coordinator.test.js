import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaveCoordinator } from '../public/save-coordinator.js';

const OUTBOX_KEY = 'readings:save-outbox:v1';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    failWrites: false,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (this.failWrites) throw new Error('Storage quota exceeded');
      writes.push({ key, value: String(value) });
      values.set(key, String(value));
    },
    removeItem(key) {
      if (this.failWrites) throw new Error('Storage quota exceeded');
      writes.push({ key, value: null });
      values.delete(key);
    },
  };
}

function fakeTimers() {
  let sequence = 0;
  const pending = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      pending.set(id, { id, callback, delay });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    count() { return pending.size; },
    delays() { return [...pending.values()].map((job) => job.delay); },
    runNext() {
      const job = [...pending.values()].sort((left, right) => left.id - right.id)[0];
      assert.ok(job, 'expected a pending timer');
      pending.delete(job.id);
      job.callback();
      return job.delay;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

test('captures immutable snapshots, persists before I/O, and coalesces unsent states', async () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const requests = [];
  const source = { annotations: [{ id: 'one', note: 'first' }], progress: 'cfi-1' };
  const coordinator = createSaveCoordinator({
    storage,
    timers,
    autoRestore: false,
    request(job) {
      const persisted = JSON.parse(storage.getItem(OUTBOX_KEY));
      assert.equal(persisted.jobs[0].revision, job.revision, 'outbox must be durable before request starts');
      requests.push(job);
      return { ok: true, status: 200 };
    },
  });

  const first = coordinator.enqueue('book', source, { debounceMs: 50 });
  source.annotations[0].note = 'mutated outside';
  const second = coordinator.enqueue('book', {
    annotations: [{ id: 'one', note: 'second' }],
    progress: 'cfi-2',
  }, { debounceMs: 50 });

  assert.equal(timers.count(), 1);
  assert.deepEqual(JSON.parse(storage.getItem(OUTBOX_KEY)).jobs, [{
    slug: 'book',
    revision: 2,
    body: { annotations: [{ id: 'one', note: 'second' }], progress: 'cfi-2' },
  }]);

  assert.equal(timers.runNext(), 50);
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].revision, 2);
  assert.ok(Object.isFrozen(requests[0]));
  assert.ok(Object.isFrozen(requests[0].body));
  assert.ok(Object.isFrozen(requests[0].body.annotations[0]));
  assert.equal((await first.acknowledged).revision, 2);
  assert.equal((await second.acknowledged).revision, 2);
  assert.equal(storage.getItem(OUTBOX_KEY), null);
  assert.equal(coordinator.status('book').state, 'saved');
});

test('allows one in-flight request per book and never reports a stale response as fully saved', async () => {
  const timers = fakeTimers();
  const responses = [];
  const requests = [];
  const statuses = [];
  let active = 0;
  let maxActive = 0;
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    autoRestore: false,
    onStatus: (status) => statuses.push(status),
    request(job) {
      requests.push(job);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const response = deferred();
      responses.push(response);
      return response.promise.finally(() => { active -= 1; });
    },
  });

  const first = coordinator.enqueue('book', { annotations: [], progress: 'one' });
  timers.runNext();
  await settle();
  const second = coordinator.enqueue('book', { annotations: [], progress: 'two' });
  assert.equal(requests.length, 1);
  assert.equal(timers.count(), 0);

  responses[0].resolve({ ok: true, status: 200 });
  await settle();
  assert.equal(coordinator.status('book').dirty, true);
  assert.notEqual(coordinator.status('book').state, 'saved');
  assert.equal(timers.count(), 1);
  assert.equal(statuses.some((status) => status.state === 'saved' && status.revision === 2 && status.ackedRevision === 1), false);

  timers.runNext();
  await settle();
  assert.deepEqual(requests.map((job) => job.revision), [1, 2]);
  responses[1].resolve({ ok: true, status: 200 });
  await settle();
  assert.equal((await first.acknowledged).revision, 1);
  assert.equal((await second.acknowledged).revision, 2);
  assert.equal(maxActive, 1);
  assert.deepEqual(coordinator.status('book'), {
    slug: 'book', state: 'saved', dirty: false, revision: 2,
    ackedRevision: 2, attempt: 0, error: null,
  });
});

test('keeps book lanes independent when another book fails and retries', async () => {
  const timers = fakeTimers();
  const slow = deferred();
  const requests = [];
  let slowAttempts = 0;
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    retryDelays: [5],
    autoRestore: false,
    request(job) {
      requests.push(job.slug);
      if (job.slug !== 'slow-book') return { ok: true, status: 200 };
      slowAttempts += 1;
      return slowAttempts === 1 ? slow.promise : { ok: true, status: 200 };
    },
  });

  const slowSave = coordinator.enqueue('slow-book', { annotations: ['slow'], progress: null });
  const fastSave = coordinator.enqueue('fast-book', { annotations: ['fast'], progress: null });
  timers.runNext();
  await settle();
  timers.runNext();
  await settle();

  assert.deepEqual(requests, ['slow-book', 'fast-book']);
  assert.equal(coordinator.status('slow-book').state, 'saving');
  assert.equal(coordinator.status('fast-book').state, 'saved');
  await fastSave.acknowledged;
  slow.reject(new TypeError('Slow book network failure'));
  await settle();
  assert.equal(coordinator.status('slow-book').state, 'retrying');
  assert.equal(coordinator.status('fast-book').state, 'saved');
  assert.equal(timers.runNext(), 5);
  await slowSave.acknowledged;
  assert.deepEqual(requests, ['slow-book', 'fast-book', 'slow-book']);
});

test('retries network, 429, and 5xx failures with bounded exponential delays', async () => {
  const timers = fakeTimers();
  const statuses = [];
  let attempts = 0;
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    retryDelays: [10, 20],
    autoRestore: false,
    onStatus: (status) => statuses.push(status),
    request() {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Network unavailable');
      if (attempts === 2) return { ok: false, status: 429 };
      if (attempts === 3) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    },
  });

  const save = coordinator.enqueue('book', { annotations: [], progress: 'cfi' });
  assert.equal(timers.runNext(), 0);
  await settle();
  assert.equal(timers.runNext(), 10);
  await settle();
  assert.equal(timers.runNext(), 20);
  await settle();
  assert.equal(timers.runNext(), 20, 'the final retry delay is capped');
  await save.acknowledged;

  assert.equal(attempts, 4);
  assert.equal(statuses.filter((status) => status.state === 'retrying').length, 3);
  assert.equal(coordinator.status('book').state, 'saved');
});

test('keeps hard 4xx failures pending until an explicit retry', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    autoRestore: false,
    request() {
      attempts += 1;
      return attempts === 1 ? { ok: false, status: 400 } : { ok: true, status: 200 };
    },
  });

  const save = coordinator.enqueue('book', { annotations: [], progress: null });
  timers.runNext();
  await settle();
  assert.equal(coordinator.status('book').state, 'blocked');
  assert.equal(coordinator.status('book').error.status, 400);
  assert.equal(timers.count(), 0);

  let acknowledged = false;
  void save.acknowledged.then(() => { acknowledged = true; });
  await settle();
  assert.equal(acknowledged, false);
  await coordinator.retry('book');
  assert.equal(attempts, 2);
  assert.equal(acknowledged, true);
});

test('does not queue or overlap a duplicate when retry is pressed during the latest in-flight save', async () => {
  const timers = fakeTimers();
  const response = deferred();
  let requests = 0;
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    autoRestore: false,
    request() {
      requests += 1;
      return response.promise;
    },
  });

  const original = coordinator.enqueue('book', { annotations: [], progress: 'cfi' });
  timers.runNext();
  await settle();
  assert.equal(requests, 1);
  assert.equal(coordinator.status('book').state, 'saving');

  const manualRetry = coordinator.retry('book');
  assert.equal(requests, 1);
  assert.equal(timers.count(), 0);
  response.resolve({ ok: true, status: 200 });
  await Promise.all([original.acknowledged, manualRetry]);
  await settle();

  assert.equal(requests, 1);
  assert.equal(timers.count(), 0);
  assert.equal(coordinator.status('book').state, 'saved');
});

test('restores a dirty outbox, lets local state win over stale remote state, and resumes revisions', async () => {
  const localState = { annotations: [{ id: 'local' }], progress: 'local-cfi' };
  const storage = fakeStorage({
    [OUTBOX_KEY]: JSON.stringify({
      version: 1,
      jobs: [{ slug: 'book', revision: 7, body: localState }],
    }),
  });
  const requests = [];
  const coordinator = createSaveCoordinator({
    storage,
    timers: fakeTimers(),
    autoRestore: false,
    request(job) {
      assert.equal(JSON.parse(storage.getItem(OUTBOX_KEY)).jobs[0].revision, job.revision);
      requests.push(job);
      return { ok: true, status: 200 };
    },
  });

  const effective = coordinator.seed('book', { annotations: [{ id: 'remote' }], progress: 'remote-cfi' });
  assert.deepEqual(effective, localState);
  effective.annotations[0].id = 'caller mutation';
  assert.deepEqual(coordinator.latest('book'), localState);
  assert.equal((await coordinator.flush('book')).revision, 7);
  assert.equal(storage.getItem(OUTBOX_KEY), null);
  assert.equal(requests.length, 1);

  const next = coordinator.enqueue('book', { annotations: [], progress: 'next' });
  assert.equal(next.revision, 8);
  await coordinator.flush('book');
});

test('does not let an in-flight stale remote read erase a just-acknowledged local recovery', async () => {
  const timers = fakeTimers();
  const response = deferred();
  const localState = { annotations: [{ id: 'recovered' }], progress: 'local-cfi' };
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    autoRestore: false,
    request() { return response.promise; },
  });

  const save = coordinator.enqueue('book', localState);
  const readBaseline = coordinator.status('book');
  assert.equal(readBaseline.dirty, true);
  timers.runNext();
  await settle();
  response.resolve({ ok: true, status: 200 });
  await save.acknowledged;
  assert.equal(coordinator.status('book').dirty, false);

  const effective = coordinator.seed(
    'book',
    { annotations: [{ id: 'stale-remote' }], progress: 'stale-cfi' },
    { preserveLocalRevision: readBaseline.revision },
  );
  assert.deepEqual(effective, localState);

  const laterRemote = { annotations: [{ id: 'newer-remote' }], progress: 'newer-cfi' };
  assert.deepEqual(coordinator.seed('book', laterRemote), laterRemote);
});

test('preserves a new local revision created while a clean remote read is in flight', async () => {
  const timers = fakeTimers();
  const response = deferred();
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    autoRestore: false,
    request() { return response.promise; },
  });
  coordinator.seed('book', { annotations: [], progress: 'initial' });
  const readBaseline = coordinator.status('book');
  assert.equal(readBaseline.dirty, false);
  const preserveLocalRevision = readBaseline.revision + 1;

  const localState = { annotations: [{ id: 'during-read' }], progress: 'local-cfi' };
  const save = coordinator.enqueue('book', localState);
  timers.runNext();
  await settle();
  response.resolve({ ok: true, status: 200 });
  await save.acknowledged;

  const effective = coordinator.seed(
    'book',
    { annotations: [], progress: 'stale-read' },
    { preserveLocalRevision },
  );
  assert.deepEqual(effective, localState);
});

test('waits while offline and retries immediately when the online event arrives', async () => {
  const timers = fakeTimers();
  const listeners = new Map();
  const onlineTarget = {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  let online = false;
  let requests = 0;
  const coordinator = createSaveCoordinator({
    storage: fakeStorage(),
    timers,
    retryDelays: [25],
    autoRestore: false,
    onlineTarget,
    isOnline: () => online,
    request() { requests += 1; return { ok: true, status: 200 }; },
  });

  const save = coordinator.enqueue('book', { annotations: [], progress: 'cfi' });
  timers.runNext();
  await settle();
  assert.equal(requests, 0);
  assert.equal(coordinator.status('book').state, 'offline');
  assert.deepEqual(timers.delays(), [25]);

  online = true;
  listeners.get('online')();
  await save.acknowledged;
  assert.equal(requests, 1);
  assert.equal(timers.count(), 0);
  coordinator.destroy();
  assert.equal(listeners.has('online'), false);
});

test('never begins network I/O until the latest snapshot is durably recorded', async () => {
  const storage = fakeStorage();
  storage.failWrites = true;
  let requests = 0;
  const coordinator = createSaveCoordinator({
    storage,
    timers: fakeTimers(),
    autoRestore: false,
    request() { requests += 1; return { ok: true, status: 200 }; },
  });

  const save = coordinator.enqueue('book', { annotations: [], progress: 'must-survive' });
  assert.equal(requests, 0);
  assert.equal(coordinator.status('book').state, 'blocked');
  assert.equal(coordinator.status('book').error.code, 'storage');

  storage.failWrites = false;
  await coordinator.retry('book');
  await save.acknowledged;
  assert.equal(requests, 1);
  assert.equal(storage.getItem(OUTBOX_KEY), null);
});
