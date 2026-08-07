import { createSaveCoordinator } from './save-coordinator.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function validScope(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function normalizeOperation(id, value) {
  if (!SAFE_ID.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (value.type === 'delete') return { id, type: 'delete' };
  if (value.type !== 'put') return null;
  const cfi = typeof value.cfi === 'string' ? value.cfi.trim() : '';
  if (!cfi.startsWith('epubcfi(') || !cfi.endsWith(')')) return null;
  const createdAt = typeof value.createdAt === 'string'
    && Number.isFinite(new Date(value.createdAt).getTime())
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  const label = typeof value.label === 'string' && value.label.trim()
    ? value.label.trim().slice(0, 160)
    : undefined;
  return {
    id,
    type: 'put',
    cfi,
    ...(label ? { label } : {}),
    createdAt,
  };
}

export function bookmarkOutboxKey(accountScope, book) {
  const scope = validScope(accountScope, 'account scope');
  const slug = validScope(book, 'book');
  return `readings-bookmark-ops-v2:${encodeURIComponent(scope)}:${encodeURIComponent(slug)}`;
}

export function readBookmarkOperations(storage, storageKey) {
  let raw;
  try {
    raw = storage?.getItem?.(storageKey);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.jobs)) return [];
    return saved.jobs
      .map((job) => normalizeOperation(String(job?.slug || ''), job?.body))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function overlayBookmarkOperations(
  remoteBookmarks,
  operations,
  serverDeletedIds = new Set(),
) {
  const byId = new Map(
    (Array.isArray(remoteBookmarks) ? remoteBookmarks : [])
      .filter((bookmark) => bookmark?.id)
      .map((bookmark) => [bookmark.id, copy(bookmark)]),
  );
  for (const operation of operations || []) {
    if (!operation?.id) continue;
    if (operation.type === 'delete') byId.delete(operation.id);
    else if (operation.type === 'put') {
      byId.set(operation.id, {
        id: operation.id,
        cfi: operation.cfi,
        ...(operation.label ? { label: operation.label } : {}),
        createdAt: operation.createdAt,
        updatedAt: operation.createdAt,
      });
    }
  }
  for (const id of serverDeletedIds) byId.delete(id);
  return [...byId.values()].sort(
    (left, right) => String(left.createdAt).localeCompare(String(right.createdAt))
      || left.id.localeCompare(right.id),
  );
}

export function bookmarkMatchesPage(bookmarkCfi, location, locations, progress) {
  if (!bookmarkCfi || !location) return false;
  if (
    bookmarkCfi === progress
    || bookmarkCfi === location.start?.cfi
    || bookmarkCfi === location.end?.cfi
  ) return true;
  try {
    const point = Number(locations?.locationFromCfi?.(bookmarkCfi));
    const start = Number.isFinite(Number(location.start?.location))
      ? Number(location.start.location)
      : Number(locations?.locationFromCfi?.(location.start?.cfi));
    const end = Number.isFinite(Number(location.end?.location))
      ? Number(location.end.location)
      : Number(locations?.locationFromCfi?.(location.end?.cfi));
    if (![point, start, end].every(Number.isFinite)) return false;
    return point >= Math.min(start, end) && point <= Math.max(start, end);
  } catch {
    return false;
  }
}

export function createBookmarkOperationQueue({
  accountScope,
  book,
  request,
  storage,
  onStatus = () => {},
  isOnline = () => globalThis.navigator?.onLine !== false,
} = {}) {
  if (typeof request !== 'function') throw new TypeError('bookmark request is required');
  const storageKey = bookmarkOutboxKey(accountScope, book);
  const restored = readBookmarkOperations(storage, storageKey);
  const ids = new Set(restored.map(({ id }) => id));
  const serverDeletedIds = new Set();
  const coordinator = createSaveCoordinator({
    request: (job) => request({ id: job.slug, operation: job.body }),
    storage,
    storageKey,
    autoRestore: false,
    onlineTarget: null,
    isOnline,
    onStatus,
  });

  function operations() {
    return [...ids]
      .filter((id) => coordinator.status(id).dirty)
      .map((id) => normalizeOperation(id, coordinator.latest(id)))
      .filter(Boolean);
  }

  function enqueue(id, operation) {
    const normalized = normalizeOperation(id, operation);
    if (!normalized) throw new TypeError('invalid bookmark operation');
    ids.add(id);
    serverDeletedIds.delete(id);
    const { id: _id, ...body } = normalized;
    return coordinator.enqueue(id, body);
  }

  function markServerDeleted(id) {
    serverDeletedIds.add(id);
  }

  function overlay(remoteBookmarks) {
    return overlayBookmarkOperations(remoteBookmarks, operations(), serverDeletedIds);
  }

  function flush() {
    return Promise.allSettled(
      [...ids]
        .filter((id) => coordinator.status(id).dirty)
        .map((id) => coordinator.flush(id)),
    );
  }

  function retry() {
    return Promise.allSettled(
      [...ids]
        .filter((id) => coordinator.status(id).dirty)
        .map((id) => coordinator.retry(id)),
    );
  }

  function dirty() {
    return [...ids].some((id) => coordinator.status(id).dirty);
  }

  return Object.freeze({
    storageKey,
    restored: copy(restored),
    enqueue,
    flush,
    retry,
    dirty,
    status: (id) => coordinator.status(id),
    operations,
    overlay,
    markServerDeleted,
    destroy: () => coordinator.destroy(),
  });
}
