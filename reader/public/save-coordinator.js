const DEFAULT_STORAGE_KEY = 'readings:save-outbox:v1';
const DEFAULT_RETRY_DELAYS = Object.freeze([1000, 2000, 5000, 10_000, 30_000]);

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function browserStorage() {
  try {
    const candidate = globalThis.localStorage;
    if (candidate?.getItem && candidate?.setItem && candidate?.removeItem) return candidate;
  } catch {
    // Storage can be unavailable in restricted browsing contexts. The in-memory
    // fallback still saves online, but naturally cannot survive a page reload.
  }
  return memoryStorage();
}

function requireSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) throw new TypeError('A non-empty book slug is required');
  return slug;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
}

function captureBody(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`Save snapshots must be JSON-serializable: ${error.message}`);
  }
  if (serialized === undefined) throw new TypeError('Save snapshots must be JSON-serializable');
  return freezeDeep(JSON.parse(serialized));
}

function copyBody(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function makeJob(slug, revision, body) {
  return Object.freeze({ slug, revision, body: captureBody(body) });
}

function errorStatus(error) {
  const possible = [error?.status, error?.response?.status, error?.cause?.status];
  const status = possible.find((value) => Number.isInteger(Number(value)));
  return status === undefined ? null : Number(status);
}

function errorInfo(error, retryable = false, code = 'request') {
  return Object.freeze({
    message: error instanceof Error ? error.message : String(error || 'Save failed'),
    status: errorStatus(error),
    retryable,
    code,
  });
}

function failedResponse(result) {
  const status = Number(result?.status);
  if ((Number.isFinite(status) && status >= 400) || result?.ok === false) {
    const error = new Error(`Save request failed${Number.isFinite(status) ? ` (${status})` : ''}`);
    if (Number.isFinite(status)) error.status = status;
    return error;
  }
  return null;
}

function isRetryable(error) {
  const status = errorStatus(error);
  return status === null || status === 0 || status === 429 || status >= 500;
}

/**
 * Coordinate durable, latest-state saves independently for each book.
 *
 * `request` receives a deeply frozen `{ slug, revision, body }` job. A caller
 * should reject the returned promise (with an optional numeric `status`) for a
 * failed request, or may return a Fetch Response and let this module inspect it.
 */
export function createSaveCoordinator({
  request,
  storage = browserStorage(),
  storageKey = DEFAULT_STORAGE_KEY,
  timers = {},
  retryDelays = DEFAULT_RETRY_DELAYS,
  onStatus = () => {},
  onlineTarget = typeof globalThis.addEventListener === 'function' ? globalThis : null,
  isOnline: onlineCheck = () => globalThis.navigator?.onLine !== false,
  autoRestore = true,
} = {}) {
  if (typeof request !== 'function') throw new TypeError('createSaveCoordinator requires request(job)');
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) throw new TypeError('storage must implement getItem, setItem, and removeItem');
  if (typeof onStatus !== 'function') throw new TypeError('onStatus must be a function');

  const setTimer = typeof timers.setTimeout === 'function'
    ? (callback, delay) => timers.setTimeout(callback, delay)
    : (callback, delay) => globalThis.setTimeout(callback, delay);
  const clearTimer = typeof timers.clearTimeout === 'function'
    ? (id) => timers.clearTimeout(id)
    : (id) => globalThis.clearTimeout(id);
  const delays = retryDelays
    .map(Number)
    .filter((delay) => Number.isFinite(delay) && delay >= 0);
  if (!delays.length) delays.push(...DEFAULT_RETRY_DELAYS);

  const lanes = new Map();
  let destroyed = false;

  function newLane(slug) {
    return {
      slug,
      nextRevision: 0,
      ackedRevision: 0,
      latestBody: undefined,
      latestJob: null,
      pending: null,
      inFlight: null,
      timer: null,
      attempt: 0,
      state: 'idle',
      lastError: null,
      hardBlocked: false,
      persistenceBlocked: false,
      waiters: [],
      lastAcknowledgement: null,
    };
  }

  function laneFor(slug) {
    const validSlug = requireSlug(slug);
    if (!lanes.has(validSlug)) lanes.set(validSlug, newLane(validSlug));
    return lanes.get(validSlug);
  }

  function currentStatus(lane) {
    const revision = lane.latestJob?.revision ?? lane.lastAcknowledgement?.revision ?? lane.nextRevision;
    return Object.freeze({
      slug: lane.slug,
      state: lane.state,
      dirty: Boolean(lane.latestJob && lane.latestJob.revision > lane.ackedRevision),
      revision,
      ackedRevision: lane.ackedRevision,
      attempt: lane.attempt,
      error: lane.lastError,
    });
  }

  function emit(lane, state, error = null) {
    lane.state = state;
    lane.lastError = error;
    try { onStatus(currentStatus(lane)); } catch { /* UI status reporting must not stop persistence. */ }
  }

  function clearLaneTimer(lane) {
    if (lane.timer !== null) clearTimer(lane.timer);
    lane.timer = null;
  }

  function dirtyJobs() {
    return [...lanes.values()]
      .filter((lane) => lane.latestJob && lane.latestJob.revision > lane.ackedRevision)
      .map((lane) => lane.latestJob)
      .sort((left, right) => left.slug.localeCompare(right.slug));
  }

  function persistOutbox() {
    const jobs = dirtyJobs();
    if (!jobs.length) {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(storageKey, JSON.stringify({ version: 1, jobs }));
  }

  function safeOnline() {
    try { return onlineCheck() !== false; } catch { return true; }
  }

  function waitFor(lane, revision) {
    if (!Number.isInteger(revision) || revision < 1 || revision > lane.nextRevision) {
      return Promise.reject(new RangeError(`Unknown save revision ${revision} for ${lane.slug}`));
    }
    if (lane.ackedRevision >= revision && lane.lastAcknowledgement) {
      return Promise.resolve(lane.lastAcknowledgement);
    }
    return new Promise((resolve, reject) => lane.waiters.push({ revision, resolve, reject }));
  }

  function resolveAcknowledged(lane, job) {
    const remaining = [];
    for (const waiter of lane.waiters) {
      if (waiter.revision <= lane.ackedRevision) waiter.resolve(job);
      else remaining.push(waiter);
    }
    lane.waiters = remaining;
  }

  function retryDelay(lane) {
    return delays[Math.min(Math.max(lane.attempt - 1, 0), delays.length - 1)];
  }

  function schedule(lane, delay = 0, state = 'scheduled', error = null) {
    if (destroyed || lane.inFlight || !lane.pending || lane.hardBlocked || lane.persistenceBlocked) return;
    clearLaneTimer(lane);
    emit(lane, state, error);
    lane.timer = setTimer(() => {
      lane.timer = null;
      void send(lane);
    }, Math.max(0, Number(delay) || 0));
  }

  function scheduleRetry(lane, error) {
    const offline = !safeOnline();
    schedule(lane, retryDelay(lane), offline ? 'offline' : 'retrying', errorInfo(error, true));
  }

  function persistBeforeRequest(lane) {
    try {
      persistOutbox();
      lane.persistenceBlocked = false;
      return true;
    } catch (error) {
      lane.persistenceBlocked = true;
      emit(lane, 'blocked', errorInfo(error, false, 'storage'));
      return false;
    }
  }

  async function send(lane) {
    if (destroyed || lane.inFlight || !lane.pending || lane.hardBlocked || lane.persistenceBlocked) return;
    clearLaneTimer(lane);

    if (!safeOnline()) {
      lane.attempt += 1;
      scheduleRetry(lane, new TypeError('Offline'));
      return;
    }
    if (!persistBeforeRequest(lane)) return;

    const job = lane.pending;
    lane.pending = null;
    lane.inFlight = job;
    emit(lane, 'saving');

    try {
      const result = await request(job);
      const responseError = failedResponse(result);
      if (responseError) throw responseError;
      if (destroyed) return;

      lane.inFlight = null;
      lane.attempt = 0;
      lane.ackedRevision = Math.max(lane.ackedRevision, job.revision);
      lane.lastAcknowledgement = job;
      if (!lane.latestJob || lane.latestJob.revision <= job.revision) {
        lane.latestBody = job.body;
        lane.latestJob = null;
      }
      try { persistOutbox(); } catch { /* A stale outbox can be safely replayed. */ }
      resolveAcknowledged(lane, job);

      if (lane.pending) schedule(lane, 0);
      else emit(lane, 'saved');
    } catch (error) {
      if (destroyed) return;
      lane.inFlight = null;

      // A newer full snapshot supersedes the failed request. Sending it is both
      // safer and faster than retrying stale state.
      if (lane.pending && lane.pending.revision > job.revision) {
        lane.attempt = 0;
        lane.hardBlocked = false;
        schedule(lane, 0);
        return;
      }

      lane.pending = job;
      if (isRetryable(error)) {
        lane.attempt += 1;
        scheduleRetry(lane, error);
      } else {
        lane.hardBlocked = true;
        emit(lane, 'blocked', errorInfo(error, false));
      }
    }
  }

  function restoreOutbox() {
    let raw;
    try { raw = storage.getItem(storageKey); } catch { return; }
    if (!raw) return;

    try {
      const saved = JSON.parse(raw);
      if (saved?.version !== 1 || !Array.isArray(saved.jobs)) throw new Error('Unsupported save outbox');
      for (const candidate of saved.jobs) {
        const slug = requireSlug(candidate?.slug);
        const revision = Number(candidate?.revision);
        if (!Number.isInteger(revision) || revision < 1) throw new Error('Invalid save revision');
        const lane = laneFor(slug);
        if (lane.latestJob && lane.latestJob.revision >= revision) continue;
        const job = makeJob(slug, revision, candidate.body);
        lane.nextRevision = Math.max(lane.nextRevision, revision);
        lane.latestBody = job.body;
        lane.latestJob = job;
        lane.pending = job;
      }
    } catch {
      try { storage.removeItem(storageKey); } catch { /* Nothing else can be recovered. */ }
    }
  }

  function seed(slug, remoteState, { preserveLocalRevision = 0 } = {}) {
    const lane = laneFor(slug);
    const preserveRevision = Number(preserveLocalRevision);
    const preserveLocal = Number.isInteger(preserveRevision)
      && preserveRevision > 0
      && preserveRevision <= lane.nextRevision
      && lane.latestBody !== undefined;
    if (!lane.latestJob && !preserveLocal) lane.latestBody = captureBody(remoteState);
    else if (autoRestore && !lane.timer && !lane.inFlight && !lane.hardBlocked && !lane.persistenceBlocked) schedule(lane, 0);
    return copyBody(lane.latestBody);
  }

  function enqueue(slug, snapshot, { debounceMs = 0 } = {}) {
    if (destroyed) throw new Error('Save coordinator is destroyed');
    const lane = laneFor(slug);
    const job = makeJob(lane.slug, lane.nextRevision + 1, snapshot);
    lane.nextRevision = job.revision;
    lane.latestBody = job.body;
    lane.latestJob = job;
    lane.pending = job;
    lane.attempt = 0;
    lane.hardBlocked = false;
    lane.persistenceBlocked = false;
    clearLaneTimer(lane);

    let persisted = true;
    try { persistOutbox(); } catch (error) {
      persisted = false;
      lane.persistenceBlocked = true;
      emit(lane, 'blocked', errorInfo(error, false, 'storage'));
    }

    const acknowledged = waitFor(lane, job.revision);
    if (persisted) {
      if (lane.inFlight) emit(lane, 'saving');
      else schedule(lane, debounceMs);
    }
    return Object.freeze({ revision: job.revision, acknowledged });
  }

  function whenAcknowledged(slug, revision) {
    return waitFor(laneFor(slug), revision);
  }

  function flushOne(slug) {
    const lane = laneFor(slug);
    if (!lane.latestJob || lane.latestJob.revision <= lane.ackedRevision) {
      return Promise.resolve(lane.lastAcknowledgement);
    }
    clearLaneTimer(lane);
    if (!lane.inFlight && !lane.hardBlocked && !lane.persistenceBlocked) void send(lane);
    return waitFor(lane, lane.latestJob.revision);
  }

  function flush(slug) {
    if (slug !== undefined) return flushOne(slug);
    return Promise.all(dirtyJobs().map((job) => flushOne(job.slug)));
  }

  function retry(slug) {
    const lane = laneFor(slug);
    if (!lane.latestJob || lane.latestJob.revision <= lane.ackedRevision) {
      return Promise.resolve(lane.lastAcknowledgement);
    }
    if (lane.inFlight) return waitFor(lane, lane.latestJob.revision);
    clearLaneTimer(lane);
    lane.hardBlocked = false;
    lane.persistenceBlocked = false;
    lane.attempt = 0;
    lane.pending = lane.latestJob;
    if (!persistBeforeRequest(lane)) return waitFor(lane, lane.latestJob.revision);
    void send(lane);
    return waitFor(lane, lane.latestJob.revision);
  }

  function latest(slug) {
    const lane = lanes.get(requireSlug(slug));
    return copyBody(lane?.latestBody);
  }

  function status(slug) {
    const validSlug = requireSlug(slug);
    const lane = lanes.get(validSlug);
    return lane ? currentStatus(lane) : Object.freeze({
      slug: validSlug,
      state: 'idle',
      dirty: false,
      revision: 0,
      ackedRevision: 0,
      attempt: 0,
      error: null,
    });
  }

  function handleOnline() {
    for (const lane of lanes.values()) {
      if (!lane.latestJob || lane.hardBlocked || lane.persistenceBlocked) continue;
      clearLaneTimer(lane);
      if (lane.inFlight) continue;
      lane.pending ||= lane.latestJob;
      void send(lane);
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    onlineTarget?.removeEventListener?.('online', handleOnline);
    const error = new Error('Save coordinator is destroyed');
    for (const lane of lanes.values()) {
      clearLaneTimer(lane);
      lane.waiters.splice(0).forEach((waiter) => waiter.reject(error));
    }
  }

  restoreOutbox();
  onlineTarget?.addEventListener?.('online', handleOnline);
  if (autoRestore) {
    for (const lane of lanes.values()) schedule(lane, 0);
  }

  return Object.freeze({ seed, enqueue, flush, retry, whenAcknowledged, latest, status, destroy });
}
