export const MAX_BOOKMARKS_PER_BOOK = 500;
export const MAX_BOOKMARK_RECORDS_PER_BOOK = 5_000;
export const MAX_BOOKMARK_ID_LENGTH = 128;
export const MAX_BOOKMARK_CFI_LENGTH = 4_096;
export const MAX_BOOKMARK_LABEL_LENGTH = 160;

const BOOKMARK_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export class BookmarkValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'BookmarkValidationError';
    this.code = 'invalid_bookmarks';
    this.field = field;
  }
}

function invalid(field, message) {
  throw new BookmarkValidationError(field, message);
}

function normalizeTimestamp(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > 64) {
    invalid(field, 'must be an iso timestamp');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid(field, 'must be an iso timestamp');
  return parsed.toISOString();
}

export function normalizeBookmarkId(value, field = 'id') {
  const id = typeof value === 'string' ? value.trim() : '';
  if (
    !id
    || id.length > MAX_BOOKMARK_ID_LENGTH
    || !BOOKMARK_ID_PATTERN.test(id)
  ) {
    invalid(field, 'must be a safe identifier');
  }
  return id;
}

function normalizeBookmark(value, prefix, now, authoritativeId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(prefix, 'must be an object');
  }

  const id = normalizeBookmarkId(authoritativeId ?? value.id, `${prefix}.id`);

  const cfi = typeof value.cfi === 'string' ? value.cfi.trim() : '';
  if (
    !cfi
    || cfi.length > MAX_BOOKMARK_CFI_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(cfi)
    || !cfi.startsWith('epubcfi(')
    || !cfi.endsWith(')')
  ) {
    invalid(`${prefix}.cfi`, 'must be a valid epub cfi');
  }

  let label;
  if (value.label !== undefined && value.label !== null) {
    if (typeof value.label !== 'string') invalid(`${prefix}.label`, 'must be text');
    label = value.label.trim();
    if (label.length > MAX_BOOKMARK_LABEL_LENGTH || CONTROL_CHARACTER_PATTERN.test(label)) {
      invalid(`${prefix}.label`, `must be at most ${MAX_BOOKMARK_LABEL_LENGTH} characters`);
    }
  }

  const createdAt = normalizeTimestamp(value.createdAt, `${prefix}.createdAt`, now);
  return {
    id,
    cfi,
    ...(label ? { label } : {}),
    createdAt,
    updatedAt: now,
  };
}

export function normalizeBookmarkItem(id, payload, { now = new Date().toISOString() } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    invalid('body', 'must be an object');
  }
  for (const field of Object.keys(payload)) {
    if (!['cfi', 'label', 'createdAt'].includes(field)) {
      invalid(field, 'is not accepted');
    }
  }
  const normalizedNow = normalizeTimestamp(now, 'updatedAt', null);
  return normalizeBookmark(payload, 'bookmark', normalizedNow, normalizeBookmarkId(id));
}

export function normalizeBookmarkList(payload, { now = new Date().toISOString() } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    invalid('body', 'must be an object');
  }
  if (!Array.isArray(payload.bookmarks)) invalid('bookmarks', 'must be an array');
  if (payload.bookmarks.length > MAX_BOOKMARKS_PER_BOOK) {
    invalid('bookmarks', `must contain at most ${MAX_BOOKMARKS_PER_BOOK} items`);
  }

  const normalizedNow = normalizeTimestamp(now, 'updatedAt', null);
  const bookmarks = payload.bookmarks.map((bookmark, index) => (
    normalizeBookmark(bookmark, `bookmarks.${index}`, normalizedNow)
  ));
  const ids = new Set();
  for (let index = 0; index < bookmarks.length; index += 1) {
    if (ids.has(bookmarks[index].id)) {
      invalid(`bookmarks.${index}.id`, 'must be unique within the book');
    }
    ids.add(bookmarks[index].id);
  }
  return bookmarks;
}
