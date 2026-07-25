import { createSaveCoordinator } from './save-coordinator.js';
import {
  bookmarkMatchesPage,
  createBookmarkOperationQueue,
} from './bookmark-ops.js';
import { installGridMotion } from './grid-motion.js';
import { initialReadingTarget, isCoverSection } from './reader-navigation.js';
import {
  DEFAULT_PREFERENCES,
  FONT_PRESETS,
  MARGIN_STOPS,
  PADDING_STOPS,
  WIDTH_STOPS,
  buildReaderTheme,
  fontPreset,
  normalizePreferences,
  stopIndex,
} from './reader-preferences.js';
import {
  catalogForDirectory,
  createDirectory,
  deleteDirectory,
  directoryDescendants,
  flattenDirectories,
  moveBook,
  moveDirectory,
  renameDirectory,
  reorderBook,
  reorderDirectory,
} from './library-profile.js';
import { createRubiCompanion, RUBI_STATES } from './rubi/companion.js';

const $ = (selector) => document.querySelector(selector);
let catalog = [];
let profile;
let selectedDirectoryId = null;
let book;
let rendition;
let activeSlug;
let annotations = [];
let progress = null;
let bookmarks = [];
let currentReaderLocation = null;
let bookmarkHydrated = false;
let bookmarkLoadFailed = false;
let activeBookmarkSession = null;
let bookmarkActionFeedback = null;
let pendingSelection = null;
let selectionWindow = null;
let selectionFallbackTimer;
let selectionPollTimer;
let selectionEpoch = 0;
let dialogEpoch = 0;
let dialogSave = null;
let notesReturnFocus = null;
let settingsReturnFocus = null;
let ingestReturnFocus = null;
let profileChangeVersion = 0;
let profileSavedVersion = 0;
let profileSaving = false;
let profileSaveTimer;
let readerThemeFrame;
let ingestionPollTimer;
let activeIngestionId;
let activeIngestionController;
let ingestionEpoch = 0;
let pdfRuntimePromise;
const bookmarkSessions = new Map();

const rubi = createRubiCompanion();

let durableStorage;
try { durableStorage = window.localStorage; } catch { durableStorage = undefined; }
try { durableStorage?.removeItem('readings-bookmark-outbox-v1'); } catch {}

const saves = createSaveCoordinator({
  request: async (job) => api(`/api/annotations/${encodeURIComponent(job.slug)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(job.body),
  }),
  storage: durableStorage,
  storageKey: 'readings-save-outbox-v1',
  onlineTarget: window,
  isOnline: () => navigator.onLine,
  onStatus: renderSaveStatus,
});

async function api(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    const error = new Error('Your sign-in expired. Sign in again to continue.');
    error.status = 401;
    location.href = '/login.html';
    throw error;
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let payload;
    try {
      payload = await response.json();
      if (payload?.message) message = payload.message;
      else if (payload?.error) message = payload.error;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    error.retryAfter = response.headers.get('retry-after');
    error.payload = payload;
    error.profile = payload?.profile;
    throw error;
  }
  return response.json();
}

function cloneState(state) {
  return {
    annotations: JSON.parse(JSON.stringify(Array.isArray(state?.annotations) ? state.annotations : [])),
    progress: typeof state?.progress === 'string' ? state.progress : null,
  };
}

function currentState() { return cloneState({ annotations, progress }); }
function makeId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cloneProfile(value = profile) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function lower(value) {
  return String(value ?? '').toLocaleLowerCase();
}

function renderDirectoryNav() {
  if (!profile) return;
  const directories = flattenDirectories(profile);
  const rootSelected = selectedDirectoryId === null;
  $('#directory-nav').innerHTML = `
    <button data-directory="" ${rootSelected ? 'aria-current="page"' : ''}>all readings</button>
    ${directories.map((directory) => `
      <button data-directory="${escapeAttribute(directory.id)}" style="--depth:${directory.depth + 1}" ${selectedDirectoryId === directory.id ? 'aria-current="page"' : ''}>${escapeHtml(lower(directory.name))}</button>
    `).join('')}`;
  document.querySelectorAll('[data-directory]').forEach((node) => node.addEventListener('click', () => {
    selectedDirectoryId = node.dataset.directory || null;
    if (activeSlug) returnToLibrary();
    renderDirectoryNav();
    renderLibrary();
    setMenuOpen(false);
  }));
}

function renderLibrary() {
  if (!profile) return;
  if (selectedDirectoryId && !profile.directories.some((directory) => directory.id === selectedDirectoryId)) {
    selectedDirectoryId = null;
  }
  const visible = catalogForDirectory(catalog, profile, selectedDirectoryId);
  const selectedDirectory = profile.directories.find((directory) => directory.id === selectedDirectoryId);
  $('#library-title').textContent = selectedDirectory ? lower(selectedDirectory.name) : 'comprosody reader';
  $('#library-subtitle').textContent = 'reader and note-taking library';
  $('#book-list').innerHTML = visible.length ? visible.map((item, index) => {
    const catalogNumber = String(catalog.findIndex((entry) => entry.book === item.book) + 1).padStart(2, '0');
    return `
    <article class="book-row" style="--delay:${index * 70}ms">
      <button class="cover-wrap" data-open="${escapeAttribute(item.book)}" aria-label="read ${escapeAttribute(lower(item.title))}"><span class="cover-art" aria-hidden="true"><small>comprosody</small><strong>${catalogNumber}</strong></span></button>
      <div class="book-meta"><p>${escapeHtml(lower(item.author || 'unknown author'))}</p><h2>${escapeHtml(lower(item.title))}</h2>
      <span>${Number(item.words || 0).toLocaleString()} words · ${Number(item.sections || 0)} section${Number(item.sections) === 1 ? '' : 's'}</span>
      <div><button class="read-button" data-open="${escapeAttribute(item.book)}">read</button><a href="/books/${encodeURIComponent(item.book)}.epub" download>download epub</a></div></div>
    </article>`;
  }).join('') : '<p class="empty">empty.</p>';
  document.querySelectorAll('[data-open]').forEach((node) => node.addEventListener('click', () => { void openBook(node.dataset.open); }));
}

async function loadCatalog() {
  [catalog, profile] = await Promise.all([api('/api/catalog'), api('/api/profile')]);
  profile.preferences = normalizePreferences(profile.preferences);
  profileChangeVersion = 0;
  profileSavedVersion = 0;
  applyProfileAppearance();
  renderDirectoryNav();
  renderLibrary();
  renderOrganizer();
}

function showCatalogError(error) {
  $('#book-list').innerHTML = `<p class="empty">not loaded. ${escapeHtml(lower(error.message || 'check the connection.'))}</p><button id="retry-catalog" class="read-button">retry</button>`;
  $('#retry-catalog').addEventListener('click', () => { void loadCatalog().catch(showCatalogError); });
}

function readerIsCurrent(slug, epoch, currentBook, currentRendition) {
  return activeSlug === slug && selectionEpoch === epoch && book === currentBook && rendition === currentRendition;
}

function bookmarkSessionKey(accountScope, slug) {
  return `${accountScope}\u001f${slug}`;
}

function activeBookmarkOperation(session, id) {
  return session?.queue.operations().find((operation) => operation.id === id) || null;
}

function applyBookmarkServerResult(session, id, result) {
  if (result?.deleted) session.queue.markServerDeleted(id);
  if (session !== activeBookmarkSession || !bookmarkHydrated) return;
  const latest = activeBookmarkOperation(session, id);
  if (result?.deleted || latest?.type === 'delete') {
    bookmarks = bookmarks.filter((bookmark) => bookmark.id !== id);
  } else if (result?.bookmark && latest?.type === 'put') {
    bookmarks = [
      ...bookmarks.filter((bookmark) => bookmark.id !== id),
      result.bookmark,
    ].sort((left, right) => (
      String(left.createdAt).localeCompare(String(right.createdAt))
      || left.id.localeCompare(right.id)
    ));
  }
  renderBookmarks();
}

function ensureBookmarkSession(accountScope, slug) {
  const key = bookmarkSessionKey(accountScope, slug);
  if (bookmarkSessions.has(key)) return bookmarkSessions.get(key);
  const session = {
    key,
    accountScope,
    slug,
    statuses: new Map(),
    queue: null,
  };
  session.queue = createBookmarkOperationQueue({
    accountScope,
    book: slug,
    storage: durableStorage,
    isOnline: () => navigator.onLine,
    request: async ({ id, operation }) => {
      const url = `/api/bookmarks/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
      const result = operation.type === 'delete'
        ? await api(url, { method: 'DELETE' })
        : await api(url, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              cfi: operation.cfi,
              ...(operation.label ? { label: operation.label } : {}),
              createdAt: operation.createdAt,
            }),
          });
      applyBookmarkServerResult(session, id, result);
      return result;
    },
    onStatus: (status) => {
      session.statuses.set(status.slug, status);
      if (session === activeBookmarkSession) {
        renderBookmarkSaveStatus();
        renderBookmarkButton();
      }
    },
  });
  bookmarkSessions.set(key, session);
  return session;
}

async function hydrateBookmarks(slug, epoch) {
  bookmarkHydrated = false;
  bookmarkLoadFailed = false;
  activeBookmarkSession = null;
  bookmarkActionFeedback = null;
  $('#bookmark-current').disabled = true;
  $('#retry-bookmarks').hidden = true;
  $('#bookmark-status').textContent = 'loading…';
  let state;
  try {
    state = await api(`/api/bookmarks/${encodeURIComponent(slug)}`);
    if (
      typeof state?.accountScope !== 'string'
      || !state.accountScope
      || !Array.isArray(state.bookmarks)
    ) {
      throw new Error('bookmarks did not load.');
    }
  } catch {
    if (activeSlug === slug && selectionEpoch === epoch) {
      bookmarks = [];
      bookmarkLoadFailed = true;
      renderBookmarks();
      $('#bookmark-status').textContent = 'not loaded · retry when connected';
      $('#retry-bookmarks').hidden = false;
      renderBookmarkButton();
    }
    return false;
  }
  if (activeSlug !== slug || selectionEpoch !== epoch) return false;
  const session = ensureBookmarkSession(state.accountScope, slug);
  activeBookmarkSession = session;
  bookmarkHydrated = true;
  bookmarks = session.queue.overlay(state.bookmarks);
  renderBookmarks();
  renderBookmarkSaveStatus();
  void session.queue.flush();
  return true;
}

function flushActiveBookmarks() {
  if (!bookmarkHydrated || !activeBookmarkSession) return;
  void activeBookmarkSession.queue.flush();
}

async function openBook(slug) {
  const item = catalog.find((entry) => entry.book === slug);
  if (!item) return;
  if (activeSlug) {
    void saves.flush(activeSlug);
    flushActiveBookmarks();
  }
  resetPendingSelection();
  stopSelectionPolling();
  const currentSelectionEpoch = ++selectionEpoch;
  if (book) book.destroy();
  book = null;
  rendition = null;
  activeSlug = slug;
  annotations = [];
  progress = null;
  bookmarks = [];
  currentReaderLocation = null;
  bookmarkHydrated = false;
  bookmarkLoadFailed = false;
  activeBookmarkSession = null;
  bookmarkActionFeedback = null;
  setNotesOpen(false, { returnFocus: false });
  renderNotes();
  renderBookmarks();
  $('#viewer').replaceChildren();
  $('#notes-toggle').disabled = true;
  $('#bookmark-current').disabled = true;
  $('#bookmark-current').setAttribute('aria-pressed', 'false');
  $('#bookmark-current').textContent = 'mark';
  $('#back').disabled = true;
  $('#forward').disabled = true;
  $('#library').hidden = true;
  $('#reader').hidden = false;
  $('#reader-title').textContent = lower(item.title);
  $('#reader-location').textContent = 'opening…';
  renderSaveStatus(saves.status(slug));
  const stateLoadBaseline = saves.status(slug);
  const preserveLocalRevision = stateLoadBaseline.dirty ? stateLoadBaseline.revision : stateLoadBaseline.revision + 1;

  let state;
  try { state = await api(`/api/annotations/${encodeURIComponent(slug)}`); }
  catch (error) {
    if (activeSlug === slug && selectionEpoch === currentSelectionEpoch) {
      $('#reader-location').textContent = 'not open';
      $('#save-status').textContent = lower(error.message);
    }
    return;
  }
  if (activeSlug !== slug || selectionEpoch !== currentSelectionEpoch) return;

  const effectiveState = saves.seed(slug, state, { preserveLocalRevision });
  ({ annotations, progress } = cloneState(effectiveState));
  const savedProgress = progress;
  await hydrateBookmarks(slug, currentSelectionEpoch);
  if (activeSlug !== slug || selectionEpoch !== currentSelectionEpoch) return;

  const currentBook = window.ePub(`/books/${encodeURIComponent(slug)}.epub`);
  const currentRendition = currentBook.renderTo('viewer', { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
  book = currentBook;
  rendition = currentRendition;
  currentRendition.themes.default(buildReaderTheme(profile.preferences));
  currentRendition.on('rendered', (_section, view) => {
    view?.iframe?.setAttribute('title', `${item.title} — reading content`);
  });
  currentRendition.on('selected', (cfiRange, contents) => stageCurrentSelection(contents, cfiRange, currentSelectionEpoch));
  currentRendition.on('mouseup', (_event, contents) => scheduleSelectionFallback(contents, currentSelectionEpoch));
  currentRendition.on('touchend', (_event, contents) => scheduleSelectionFallback(contents, currentSelectionEpoch));
  currentRendition.on('relocated', (location) => {
    if (!readerIsCurrent(slug, currentSelectionEpoch, currentBook, currentRendition)) return;
    let locatedSection;
    try { locatedSection = currentBook.spine.get(location.start.cfi); } catch {}
    if (isCoverSection(locatedSection)) {
      currentReaderLocation = null;
      $('#reader-location').textContent = 'cover';
      renderBookmarkButton();
      return;
    }
    progress = location.start.cfi;
    currentReaderLocation = location;
    const percent = Math.round(currentBook.locations.percentageFromCfi(location.start.cfi) * 100);
    $('#reader-location').textContent = `${percent}%`;
    renderBookmarkButton();
    saves.enqueue(slug, currentState(), { debounceMs: 350 });
  });

  try {
    await currentBook.ready;
    await currentBook.locations.generate(1200);
    if (!readerIsCurrent(slug, currentSelectionEpoch, currentBook, currentRendition)) return;
    await currentRendition.display(initialReadingTarget(currentBook.spine, savedProgress));
  } catch (error) {
    if (readerIsCurrent(slug, currentSelectionEpoch, currentBook, currentRendition)) {
      $('#reader-location').textContent = 'not rendered';
      $('#save-status').textContent = lower(error.message || 'could not render.');
    }
    return;
  }
  if (!readerIsCurrent(slug, currentSelectionEpoch, currentBook, currentRendition)) return;
  annotations.forEach((annotation) => applyHighlight(annotation, currentRendition));
  startSelectionPolling(currentRendition, currentSelectionEpoch);
  renderNotes();
  renderBookmarks();
  renderSaveStatus(saves.status(slug));
  $('#notes-toggle').disabled = false;
  renderBookmarkButton();
  $('#back').disabled = false;
  $('#forward').disabled = false;
}

function applyHighlight(item, targetRendition = rendition) {
  try {
    const dark = profile?.preferences?.theme !== 'light';
    targetRendition.annotations.highlight(item.cfiRange, {}, () => openExisting(item.id), `hl-${item.id}`, {
      fill: dark ? '#dedbd2' : '#85847e',
      'fill-opacity': dark ? '0.22' : '0.18',
      'mix-blend-mode': dark ? 'screen' : 'multiply',
    });
  } catch {}
}

function showAnnotationDialog(item, editing = false) {
  dialogEpoch += 1;
  dialogSave = null;
  pendingSelection = { ...item };
  $('#annotation-dialog h2').textContent = editing ? 'edit note' : 'annotate';
  $('#selected-text').textContent = item.text;
  $('#note-text').value = item.note || '';
  $('#note-text').readOnly = false;
  $('#annotation-error').textContent = '';
  $('#save-note').disabled = false;
  $('#save-note').textContent = 'save';
  clearActiveSelection(); $('#annotation-dialog').showModal();
  $('#note-text').focus();
}

function openExisting(id) {
  const item = annotations.find((entry) => entry.id === id);
  if (!item) return;
  resetPendingSelection();
  showAnnotationDialog(item, true);
}

function renderNotes() {
  $('#notes-list').innerHTML = annotations.length ? annotations.map((item) => `
    <article>
      <button data-jump="${escapeAttribute(item.id)}">“${escapeHtml(item.text.slice(0, 110))}${item.text.length > 110 ? '…' : ''}”</button>
      ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
      <div class="note-actions"><button data-edit="${escapeAttribute(item.id)}">${item.note ? 'edit' : 'add note'}</button><button class="delete-note" data-delete="${escapeAttribute(item.id)}">delete</button></div>
    </article>`).join('') : '<p class="empty">select text to highlight.</p>';
  document.querySelectorAll('[data-jump]').forEach((node) => node.addEventListener('click', () => {
    const item = annotations.find((annotation) => annotation.id === node.dataset.jump);
    if (item) void rendition?.display(item.cfiRange);
  }));
  document.querySelectorAll('[data-edit]').forEach((node) => node.addEventListener('click', () => openExisting(node.dataset.edit)));
  document.querySelectorAll('[data-delete]').forEach((node) => node.addEventListener('click', () => { void removeAnnotation(node.dataset.delete); }));
}

function bookmarkAtCurrentLocation() {
  if (typeof progress !== 'string' || !progress.startsWith('epubcfi(')) return null;
  return bookmarks.find((bookmark) => bookmarkMatchesPage(
    bookmark.cfi,
    currentReaderLocation,
    book?.locations,
    progress,
  )) || null;
}

function bookmarkOperationStatus(id) {
  return activeBookmarkSession?.queue.status(id) || null;
}

function renderBookmarkButton() {
  const button = $('#bookmark-current');
  const current = bookmarkAtCurrentLocation();
  const available = Boolean(
    bookmarkHydrated
    && !bookmarkLoadFailed
    && activeBookmarkSession
    && activeSlug
    && rendition
    && typeof progress === 'string'
    && progress.startsWith('epubcfi('),
  );
  button.disabled = !available;
  button.setAttribute('aria-pressed', String(Boolean(current)));
  if (!available) {
    button.setAttribute(
      'aria-label',
      bookmarkLoadFailed ? 'bookmarks unavailable' : 'bookmark this page',
    );
    button.textContent = 'mark';
    return;
  }
  const feedbackApplies = bookmarkActionFeedback && bookmarkMatchesPage(
    bookmarkActionFeedback.cfi,
    currentReaderLocation,
    book?.locations,
    progress,
  );
  const status = feedbackApplies
    ? bookmarkOperationStatus(bookmarkActionFeedback.id)
    : null;
  const pendingLabel = {
    scheduled: 'saving…',
    saving: 'saving…',
    retrying: 'saving…',
    offline: 'kept',
    blocked: 'retry',
  }[status?.state];
  button.setAttribute('aria-label', current ? 'remove bookmark from this page' : 'bookmark this page');
  button.textContent = pendingLabel || (current ? 'marked' : 'mark');
}

function renderBookmarks() {
  const list = $('#bookmark-list');
  if (!list) return;
  list.innerHTML = bookmarks.length ? bookmarks.map((bookmark) => {
    const date = Number.isFinite(new Date(bookmark.createdAt).getTime())
      ? lower(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(bookmark.createdAt)))
      : '';
    return `<article class="bookmark-row">
      <button data-bookmark-jump="${escapeAttribute(bookmark.id)}"><strong>${escapeHtml(lower(bookmark.label || 'bookmark'))}</strong>${date ? `<span>${escapeHtml(date)}</span>` : ''}</button>
      <button class="bookmark-delete" data-bookmark-delete="${escapeAttribute(bookmark.id)}" aria-label="remove ${escapeAttribute(lower(bookmark.label || 'bookmark'))}">remove</button>
    </article>`;
  }).join('') : '<p class="empty">no bookmarks.</p>';
  document.querySelectorAll('[data-bookmark-jump]').forEach((node) => node.addEventListener('click', async () => {
    const item = bookmarks.find((bookmark) => bookmark.id === node.dataset.bookmarkJump);
    if (!item || !rendition) return;
    await rendition.display(item.cfi);
    if (window.matchMedia('(max-width: 1099px)').matches) setNotesOpen(false);
  }));
  document.querySelectorAll('[data-bookmark-delete]').forEach((node) => node.addEventListener('click', () => {
    removeBookmark(node.dataset.bookmarkDelete);
  }));
  renderBookmarkButton();
}

function renderBookmarkSaveStatus() {
  if (!$('#bookmark-status')) return;
  if (bookmarkLoadFailed) {
    $('#bookmark-status').textContent = 'not loaded · retry when connected';
    $('#retry-bookmarks').hidden = false;
    return;
  }
  if (!bookmarkHydrated || !activeBookmarkSession) {
    $('#bookmark-status').textContent = '';
    $('#retry-bookmarks').hidden = true;
    return;
  }
  const statuses = [...activeBookmarkSession.statuses.values()];
  const priority = ['blocked', 'offline', 'saving', 'retrying', 'scheduled', 'saved'];
  const status = priority
    .map((state) => statuses.find((candidate) => candidate.state === state))
    .find(Boolean);
  const storageBlocked = status?.state === 'blocked' && status.error?.code === 'storage';
  const labels = {
    idle: '', scheduled: 'saving…', saving: 'saving…', saved: 'saved',
    retrying: 'retrying…', blocked: 'not saved', offline: 'offline · kept',
  };
  $('#bookmark-status').textContent = storageBlocked
    ? 'storage unavailable'
    : (labels[status?.state] ?? '');
  $('#retry-bookmarks').hidden = !['blocked', 'offline'].includes(status?.state);
}

function queueBookmarkOperation(id, operation) {
  if (!bookmarkHydrated || !activeBookmarkSession || !activeSlug) return;
  bookmarkActionFeedback = {
    id,
    type: operation.type,
    cfi: operation.cfi || progress,
  };
  const queued = activeBookmarkSession.queue.enqueue(id, operation);
  renderBookmarkSaveStatus();
  renderBookmarkButton();
  void queued.acknowledged.catch(() => {});
}

function removeBookmark(id) {
  if (!bookmarkHydrated || !activeBookmarkSession) return;
  const removed = bookmarks.find((bookmark) => bookmark.id === id);
  const next = bookmarks.filter((bookmark) => bookmark.id !== id);
  if (next.length === bookmarks.length) return;
  bookmarks = next;
  renderBookmarks();
  queueBookmarkOperation(id, { type: 'delete', cfi: removed?.cfi || progress });
}

function toggleCurrentBookmark() {
  if (
    !bookmarkHydrated
    || !activeBookmarkSession
    || !activeSlug
    || typeof progress !== 'string'
    || !progress.startsWith('epubcfi(')
  ) return;
  const feedbackApplies = bookmarkActionFeedback && bookmarkMatchesPage(
    bookmarkActionFeedback.cfi,
    currentReaderLocation,
    book?.locations,
    progress,
  );
  if (
    feedbackApplies
    && bookmarkOperationStatus(bookmarkActionFeedback.id)?.state === 'blocked'
  ) {
    void activeBookmarkSession.queue.retry();
    return;
  }
  const current = bookmarkAtCurrentLocation();
  if (current) {
    removeBookmark(current.id);
    return;
  }
  const now = new Date().toISOString();
  const id = makeId();
  bookmarks = [...bookmarks, {
    id,
    cfi: progress,
    label: $('#reader-location').textContent || 'bookmark',
    createdAt: now,
    updatedAt: now,
  }];
  renderBookmarks();
  queueBookmarkOperation(id, {
    type: 'put',
    cfi: progress,
    label: $('#reader-location').textContent || 'bookmark',
    createdAt: now,
  });
}

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = String(value ?? '');
  return span.innerHTML;
}

function escapeAttribute(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function stageCurrentSelection(contents, cfiRange, currentSelectionEpoch) {
  if (currentSelectionEpoch !== selectionEpoch || $('#annotation-dialog').open) return;
  const selection = contents.window.getSelection();
  const text = selection?.toString().trim();
  if (!text || !selection.rangeCount || selection.getRangeAt(0).collapsed) return;
  let resolvedCfi = cfiRange;
  try { resolvedCfi ||= contents.cfiFromRange(selection.getRangeAt(0)); } catch { return; }
  pendingSelection = { cfiRange: resolvedCfi, text };
  selectionWindow = contents.window;
  $('#selection-action').hidden = false;
}

function scheduleSelectionFallback(contents, currentSelectionEpoch) {
  if (currentSelectionEpoch !== selectionEpoch) return;
  clearTimeout(selectionFallbackTimer);
  selectionFallbackTimer = setTimeout(() => stageCurrentSelection(contents, undefined, currentSelectionEpoch), 320);
}

function startSelectionPolling(currentRendition, currentSelectionEpoch) {
  if (currentSelectionEpoch !== selectionEpoch) return;
  const pollTimer = setInterval(() => {
    if (currentSelectionEpoch !== selectionEpoch) {
      clearInterval(pollTimer);
      if (selectionPollTimer === pollTimer) selectionPollTimer = null;
      return;
    }
    if (document.hidden) return;
    currentRendition.getContents().forEach((contents) => stageCurrentSelection(contents, undefined, currentSelectionEpoch));
  }, 500);
  selectionPollTimer = pollTimer;
}

function stopSelectionPolling() { clearInterval(selectionPollTimer); selectionPollTimer = null; }
function clearActiveSelection() { selectionWindow?.getSelection()?.removeAllRanges(); selectionWindow = null; }
function resetPendingSelection() {
  clearTimeout(selectionFallbackTimer);
  clearActiveSelection();
  pendingSelection = null;
  $('#selection-action').hidden = true;
}

function renderSaveStatus(status) {
  if (!status || status.slug !== activeSlug) return;
  const storageBlocked = status.state === 'blocked' && status.error?.code === 'storage';
  const labels = {
    idle: '', scheduled: 'saving…', saving: 'saving…', saved: 'saved',
    retrying: 'retrying…', blocked: 'not saved', offline: 'offline · kept',
  };
  $('#save-status').textContent = storageBlocked ? 'storage unavailable' : (labels[status.state] ?? '');
  $('#retry-save').hidden = !['blocked', 'offline'].includes(status.state);

  if (dialogSave?.slug !== status.slug || dialogSave.token !== dialogEpoch || !$('#annotation-dialog').open) return;
  if (status.state === 'blocked' || status.state === 'offline') {
    $('#annotation-error').textContent = storageBlocked
      ? 'this change exists only in this open tab because device storage is unavailable. keep the page open, make storage available, then retry.'
      : status.state === 'offline'
      ? 'you are offline. this highlight is kept on this device and will retry automatically.'
      : 'the highlight is kept on this device. retry when your connection is ready.';
    $('#save-note').disabled = false;
    $('#save-note').textContent = 'retry';
  } else if (status.state === 'retrying') {
    $('#annotation-error').textContent = 'the connection was interrupted. retrying without losing your note…';
  }
}

async function persistAnnotation() {
  if (!pendingSelection || !activeSlug) return;
  if (dialogSave?.token === dialogEpoch) {
    $('#save-note').disabled = true;
    $('#save-note').textContent = 'saving…';
    $('#annotation-error').textContent = '';
    saves.retry(dialogSave.slug);
    return;
  }

  const slug = activeSlug;
  const token = dialogEpoch;
  const existingIndex = annotations.findIndex((annotation) => annotation.id === pendingSelection.id);
  const savedItem = existingIndex >= 0
    ? { ...annotations[existingIndex], note: $('#note-text').value.trim() }
    : { ...pendingSelection, id: makeId(), note: $('#note-text').value.trim(), createdAt: new Date().toISOString() };
  annotations = existingIndex >= 0
    ? annotations.map((annotation, index) => index === existingIndex ? savedItem : annotation)
    : [...annotations, savedItem];
  pendingSelection = savedItem;
  if (existingIndex < 0) applyHighlight(savedItem);
  renderNotes();

  $('#note-text').readOnly = true;
  $('#save-note').disabled = true;
  $('#save-note').textContent = 'saving…';
  $('#annotation-error').textContent = '';
  const queued = saves.enqueue(slug, currentState());
  dialogSave = { slug, revision: queued.revision, token };
  renderSaveStatus(saves.status(slug));

  try {
    await queued.acknowledged;
    if (dialogSave?.revision !== queued.revision || dialogSave.token !== dialogEpoch || !$('#annotation-dialog').open) return;
    dialogSave = null;
    $('#annotation-dialog').close();
  } catch (error) {
    if (token !== dialogEpoch || !$('#annotation-dialog').open) return;
    $('#annotation-error').textContent = lower(error.message || 'could not save. your highlight remains on this device.');
    $('#save-note').disabled = false;
    $('#save-note').textContent = 'retry';
  }
}

async function removeAnnotation(id) {
  const item = annotations.find((annotation) => annotation.id === id);
  if (!item || !activeSlug) return;
  const slug = activeSlug;
  try { rendition.annotations.remove(item.cfiRange, 'highlight'); } catch {}
  annotations = annotations.filter((annotation) => annotation.id !== id);
  renderNotes();
  const queued = saves.enqueue(slug, currentState());
  try { await queued.acknowledged; } catch {}
}

function showProfileStatus(message) {
  $('#settings-status').textContent = message;
  $('#organize-status').textContent = message;
}

function syncSettingsControls() {
  if (!profile) return;
  const preferences = normalizePreferences(profile.preferences);
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === preferences.theme;
  });
  $('#font-value').textContent = fontPreset(preferences.fontFamily).label;
  $('#font-size').value = String(preferences.fontSize);
  $('#font-size-value').textContent = `${preferences.fontSize} px`;
  $('#line-height').value = String(preferences.lineHeight);
  $('#line-height-value').textContent = preferences.lineHeight.toFixed(2);
  $('#page-width').value = String(stopIndex(WIDTH_STOPS, preferences.pageWidth));
  $('#page-margin').value = String(stopIndex(MARGIN_STOPS, preferences.margins));
  $('#page-padding').value = String(stopIndex(PADDING_STOPS, preferences.padding));
  $('#page-width').setAttribute('aria-valuetext', ['very narrow', 'narrow', 'medium', 'wide', 'very wide'][$('#page-width').value]);
  $('#page-margin').setAttribute('aria-valuetext', ['very small', 'small', 'medium', 'large', 'very large'][$('#page-margin').value]);
  $('#page-padding').setAttribute('aria-valuetext', ['very small', 'small', 'medium', 'large', 'very large'][$('#page-padding').value]);
  document.querySelectorAll('input[name="reader-font"]').forEach((input) => {
    input.checked = input.value === preferences.fontFamily;
  });
}

function refreshReaderTheme() {
  if (!rendition || readerThemeFrame) return;
  const targetRendition = rendition;
  readerThemeFrame = requestAnimationFrame(async () => {
    readerThemeFrame = null;
    if (targetRendition !== rendition || !profile) return;
    let currentLocation;
    try { currentLocation = await Promise.resolve(targetRendition.currentLocation()); } catch {}
    const cfi = currentLocation?.start?.cfi || progress || undefined;
    targetRendition.themes.default(buildReaderTheme(profile.preferences));
    for (const annotation of annotations) {
      try { targetRendition.annotations.remove(annotation.cfiRange, 'highlight'); } catch {}
      applyHighlight(annotation, targetRendition);
    }
    try { targetRendition.resize(undefined, undefined, cfi); } catch {}
  });
}

function applyProfileAppearance() {
  if (!profile) return;
  profile.preferences = normalizePreferences(profile.preferences);
  const { theme } = profile.preferences;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const themeColor = theme === 'light' ? '#f3f1ea' : '#0a0a0a';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  try { localStorage.setItem('readings-theme', theme); } catch {}
  syncSettingsControls();
  refreshReaderTheme();
}

async function flushProfile() {
  clearTimeout(profileSaveTimer);
  if (!profile || profileSaving || profileSavedVersion === profileChangeVersion) return;
  profileSaving = true;
  while (profileSavedVersion < profileChangeVersion) {
    const sendingVersion = profileChangeVersion;
    const draft = cloneProfile();
    showProfileStatus('saving…');
    try {
      const saved = await api('/api/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (profileChangeVersion === sendingVersion) profile = saved;
      else {
        profile.revision = saved.revision;
        profile.updatedAt = saved.updatedAt;
      }
      profileSavedVersion = sendingVersion;
      showProfileStatus('saved');
    } catch (error) {
      if (error.status === 409 && error.profile) {
        profile.revision = error.profile.revision;
        profile.updatedAt = error.profile.updatedAt;
        continue;
      }
      showProfileStatus('not saved · retrying');
      break;
    }
  }
  profileSaving = false;
}

function updateProfile(mutator, { structure = false, debounceMs = 240, message = '' } = {}) {
  if (!profile) return;
  const draft = cloneProfile();
  profile = mutator(draft) || draft;
  profile.preferences = normalizePreferences(profile.preferences);
  profileChangeVersion += 1;
  applyProfileAppearance();
  if (structure) {
    renderDirectoryNav();
    renderLibrary();
    renderOrganizer();
  }
  if (message) showProfileStatus(message);
  clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(() => { void flushProfile(); }, debounceMs);
}

function renderFontOptions() {
  const groups = ['serif', 'sans', 'mono'];
  $('#font-options').innerHTML = groups.map((group) => `
    <fieldset class="font-group"><legend>${group}</legend>
      ${FONT_PRESETS.filter((preset) => preset.group === group).map((preset) => `
        <label class="font-option"><input type="radio" name="reader-font" value="${escapeAttribute(preset.id)}"><span data-font-preview="${escapeAttribute(preset.id)}">${escapeHtml(preset.label)}</span></label>
      `).join('')}
    </fieldset>`).join('');
  document.querySelectorAll('[data-font-preview]').forEach((node) => {
    node.style.fontFamily = fontPreset(node.dataset.fontPreview).stack;
  });
  document.querySelectorAll('input[name="reader-font"]').forEach((input) => input.addEventListener('change', () => {
    if (!input.checked) return;
    updateProfile((next) => {
      next.preferences.fontFamily = input.value;
      return next;
    });
    $('#font-value').textContent = fontPreset(input.value).label;
  }));
}

function folderOptions(selectedId = null, excludedIds = new Set()) {
  const rows = ['<option value="">all readings</option>'];
  for (const directory of flattenDirectories(profile)) {
    if (excludedIds.has(directory.id)) continue;
    const selected = directory.id === selectedId ? ' selected' : '';
    rows.push(`<option value="${escapeAttribute(directory.id)}"${selected}>${'· '.repeat(directory.depth)}${escapeHtml(lower(directory.name))}</option>`);
  }
  return rows.join('');
}

function renderOrganizer() {
  if (!profile) return;
  $('#new-folder-parent').innerHTML = folderOptions(null);
  const directories = flattenDirectories(profile);
  $('#folder-organizer').innerHTML = directories.length ? directories.map((directory) => {
    const excluded = directoryDescendants(profile, directory.id);
    excluded.add(directory.id);
    return `<div class="folder-row" data-folder-row="${escapeAttribute(directory.id)}">
      <input value="${escapeAttribute(directory.name)}" maxlength="80" aria-label="folder name">
      <select aria-label="parent folder">${folderOptions(directory.parentId, excluded)}</select>
      <button type="button" data-folder-up="${escapeAttribute(directory.id)}" aria-label="move ${escapeAttribute(lower(directory.name))} up">↑</button>
      <button type="button" data-folder-down="${escapeAttribute(directory.id)}" aria-label="move ${escapeAttribute(lower(directory.name))} down">↓</button>
      <button type="button" class="folder-delete" data-folder-delete="${escapeAttribute(directory.id)}" aria-label="delete ${escapeAttribute(lower(directory.name))}">×</button>
    </div>`;
  }).join('') : '<p class="empty">no folders.</p>';

  const placementByBook = new Map(profile.books.map((placement) => [placement.book, placement]));
  $('#book-organizer').innerHTML = catalog.map((item) => {
    const placement = placementByBook.get(item.book);
    return `<div class="book-organizer-row">
      <strong>${escapeHtml(lower(item.title))}</strong>
      <select data-book-folder="${escapeAttribute(item.book)}" aria-label="folder for ${escapeAttribute(lower(item.title))}">${folderOptions(placement?.directoryId || null)}</select>
      <button type="button" data-book-up="${escapeAttribute(item.book)}" aria-label="move ${escapeAttribute(lower(item.title))} up">↑</button>
      <button type="button" data-book-down="${escapeAttribute(item.book)}" aria-label="move ${escapeAttribute(lower(item.title))} down">↓</button>
    </div>`;
  }).join('');

  document.querySelectorAll('[data-folder-row] input').forEach((input) => input.addEventListener('change', () => {
    const id = input.closest('[data-folder-row]').dataset.folderRow;
    const name = input.value.trim();
    if (!name) return renderOrganizer();
    updateProfile((next) => renameDirectory(next, id, name), { structure: true, debounceMs: 0, message: 'renamed' });
  }));
  document.querySelectorAll('[data-folder-row] select').forEach((select) => select.addEventListener('change', () => {
    const id = select.closest('[data-folder-row]').dataset.folderRow;
    updateProfile((next) => moveDirectory(next, id, select.value || null), { structure: true, debounceMs: 0, message: 'moved' });
  }));
  document.querySelectorAll('[data-folder-up]').forEach((button) => button.addEventListener('click', () => {
    updateProfile((next) => reorderDirectory(next, button.dataset.folderUp, -1), { structure: true, debounceMs: 0, message: 'moved' });
  }));
  document.querySelectorAll('[data-folder-down]').forEach((button) => button.addEventListener('click', () => {
    updateProfile((next) => reorderDirectory(next, button.dataset.folderDown, 1), { structure: true, debounceMs: 0, message: 'moved' });
  }));
  document.querySelectorAll('[data-folder-delete]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.folderDelete;
    const target = profile.directories.find((directory) => directory.id === id);
    if (!target || !window.confirm(`delete “${lower(target.name)}”? readings move to the parent.`)) return;
    if (selectedDirectoryId === id) selectedDirectoryId = target.parentId || null;
    updateProfile((next) => deleteDirectory(next, id), { structure: true, debounceMs: 0, message: 'deleted' });
  }));
  document.querySelectorAll('[data-book-folder]').forEach((select) => select.addEventListener('change', () => {
    updateProfile((next) => moveBook(next, select.dataset.bookFolder, select.value || null), { structure: true, debounceMs: 0, message: 'moved' });
  }));
  document.querySelectorAll('[data-book-up]').forEach((button) => button.addEventListener('click', () => {
    updateProfile((next) => reorderBook(next, button.dataset.bookUp, -1), { structure: true, debounceMs: 0, message: 'moved' });
  }));
  document.querySelectorAll('[data-book-down]').forEach((button) => button.addEventListener('click', () => {
    updateProfile((next) => reorderBook(next, button.dataset.bookDown, 1), { structure: true, debounceMs: 0, message: 'moved' });
  }));
}

function setMenuOpen(open) {
  $('#navigation-stack').classList.toggle('is-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}

function updateOverlayInert() {
  const overlay = window.matchMedia('(max-width: 1099px)').matches
    && (!$('#notes-panel').hidden || !$('#settings-panel').hidden || !$('#ingest-panel').hidden);
  $('#library').inert = overlay;
  $('#reader').inert = overlay;
  $('.app-header').inert = overlay;
  rubi.element.inert = overlay;
  [$('#notes-panel'), $('#settings-panel'), $('#ingest-panel')].forEach((panel) => {
    const modal = overlay && !panel.hidden;
    if (modal) {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
    } else {
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
    }
  });
}

function setNotesOpen(open, { returnFocus = true } = {}) {
  const panel = $('#notes-panel');
  if (open) {
    setMenuOpen(false);
    setSettingsOpen(false, { returnFocus: false });
    setIngestOpen(false, { returnFocus: false });
  }
  $('.app-shell').classList.toggle('notes-open', open);
  if (open) {
    notesReturnFocus = document.activeElement;
    panel.hidden = false;
    $('#notes-toggle').setAttribute('aria-expanded', 'true');
    $('#notes-close').focus();
  } else {
    panel.hidden = true;
    $('#notes-toggle').setAttribute('aria-expanded', 'false');
    updateOverlayInert();
    if (returnFocus && notesReturnFocus instanceof HTMLElement) notesReturnFocus.focus();
    notesReturnFocus = null;
  }
  if (open) updateOverlayInert();
}

function setSettingsOpen(open, { returnFocus = true } = {}) {
  const panel = $('#settings-panel');
  if (open) {
    setMenuOpen(false);
    setNotesOpen(false, { returnFocus: false });
    setIngestOpen(false, { returnFocus: false });
    settingsReturnFocus = document.activeElement;
    panel.hidden = false;
    $('.app-shell').classList.add('settings-open');
    $('#settings-toggle').setAttribute('aria-expanded', 'true');
    $('#settings-main').hidden = false;
    $('#font-picker').hidden = true;
    $('#settings-close').focus();
  } else {
    panel.hidden = true;
    $('.app-shell').classList.remove('settings-open');
    $('#settings-toggle').setAttribute('aria-expanded', 'false');
    updateOverlayInert();
    if (returnFocus && settingsReturnFocus instanceof HTMLElement) settingsReturnFocus.focus();
    settingsReturnFocus = null;
  }
  if (open) updateOverlayInert();
}

function setIngestOpen(open, { returnFocus = true } = {}) {
  const panel = $('#ingest-panel');
  if (open) {
    setMenuOpen(false);
    setNotesOpen(false, { returnFocus: false });
    setSettingsOpen(false, { returnFocus: false });
    ingestReturnFocus = document.activeElement;
    panel.hidden = false;
    $('.app-shell').classList.add('ingest-open');
    $('#ingest-toggle').setAttribute('aria-expanded', 'true');
    $('#ingest-close').focus();
  } else {
    panel.hidden = true;
    $('.app-shell').classList.remove('ingest-open');
    $('#ingest-toggle').setAttribute('aria-expanded', 'false');
    updateOverlayInert();
    if (returnFocus && ingestReturnFocus instanceof HTMLElement) ingestReturnFocus.focus();
    ingestReturnFocus = null;
  }
  if (open) updateOverlayInert();
}

function returnToLibrary() {
  if (activeSlug) {
    void saves.flush(activeSlug);
    flushActiveBookmarks();
  }
  selectionEpoch += 1;
  stopSelectionPolling();
  resetPendingSelection();
  setNotesOpen(false, { returnFocus: false });
  $('#reader').hidden = true;
  $('#library').hidden = false;
  activeSlug = null;
  renderDirectoryNav();
  renderLibrary();
}

function stepRange(input, amount) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const next = Math.min(maximum, Math.max(minimum, Number(input.value) + Number(amount)));
  input.value = String(Math.round(next * 100) / 100);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function activeOverlay() {
  if ($('#organize-dialog').open) return $('#organize-dialog');
  if ($('#annotation-dialog').open) return $('#annotation-dialog');
  if (!$('#ingest-panel').hidden) return $('#ingest-panel');
  if (!$('#settings-panel').hidden) return $('#settings-panel');
  if (!$('#notes-panel').hidden) return $('#notes-panel');
  return null;
}

function trapOverlayFocus(event) {
  if (event.key !== 'Tab' || !window.matchMedia('(max-width: 1099px)').matches) return;
  const overlay = activeOverlay();
  if (!overlay) return;
  const focusable = [...overlay.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.hidden && node.getClientRects().length);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncRubiControl() {
  const state = rubi.getState();
  $('#rubi-value').textContent = state === RUBI_STATES.hidden ? 'hidden' : state;
  $('#rubi-visibility').setAttribute(
    'aria-label',
    state === RUBI_STATES.hidden ? 'show rubi' : 'hide rubi',
  );
}

function appendIngestionLog(message) {
  const text = lower(message).trim();
  if (!text) return;
  const log = $('#ingest-log');
  if ([...log.children].some((node) => node.textContent === text)) return;
  const item = document.createElement('li');
  item.textContent = text;
  log.append(item);
  item.scrollIntoView({ block: 'nearest' });
}

async function loadPdfRuntime() {
  if (window.ReadingsPdfIngest) return window.ReadingsPdfIngest;
  if (!pdfRuntimePromise) {
    document.querySelector('script[data-pdf-ingest]')?.remove();
    const script = document.createElement('script');
    script.src = '/pdf-ingest.js';
    script.dataset.pdfIngest = '';
    document.head.append(script);
    pdfRuntimePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('pdf tools did not load.')), 15_000);
      script.addEventListener('load', () => {
        clearTimeout(timeout);
        if (window.ReadingsPdfIngest) resolve(window.ReadingsPdfIngest);
        else reject(new Error('pdf tools did not load.'));
      }, { once: true });
      script.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('pdf tools did not load.'));
      }, { once: true });
    }).catch((error) => {
      script.remove();
      pdfRuntimePromise = null;
      throw error;
    });
  }
  return pdfRuntimePromise;
}

function renderIngestionJob(job) {
  for (const event of job.events || []) appendIngestionLog(event.message || event.stage);
  const label = job.progress?.label || job.stage || job.status || 'working';
  const completed = Number(job.progress?.completed);
  const total = Number(job.progress?.total);
  $('#ingest-status').textContent = lower(label);
  $('#ingest-progress').textContent = Number.isFinite(completed) && Number.isFinite(total) && total > 0
    ? `${completed}/${total}`
    : '';
  if (job.status === 'completed') {
    clearTimeout(ingestionPollTimer);
    $('#ingest-start').disabled = false;
    $('#ingest-cancel').disabled = false;
    $('#ingest-cancel').hidden = true;
    $('#ingest-download').href = `/api/ingestions/${encodeURIComponent(job.id)}/epub`;
    $('#ingest-download').download = job.filename || 'reading.epub';
    $('#ingest-download').hidden = false;
    appendIngestionLog('ready');
  } else if (job.status === 'failed' || job.status === 'cancelled') {
    clearTimeout(ingestionPollTimer);
    $('#ingest-start').disabled = false;
    $('#ingest-cancel').disabled = false;
    $('#ingest-cancel').hidden = true;
    appendIngestionLog(job.status === 'cancelled' ? 'cancelled' : (job.error?.message || 'not completed'));
  }
}

function scheduleIngestionPoll(delay = 1000) {
  clearTimeout(ingestionPollTimer);
  ingestionPollTimer = setTimeout(() => { void pollIngestion(); }, delay);
}

async function pollIngestion() {
  if (!activeIngestionId) return;
  try {
    const job = await api(`/api/ingestions/${encodeURIComponent(activeIngestionId)}`);
    renderIngestionJob(job);
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      scheduleIngestionPoll();
    }
  } catch (error) {
    $('#ingest-status').textContent = lower(error.message);
    scheduleIngestionPoll(2500);
  }
}

async function cancelServerIngestion(jobId) {
  activeIngestionId = jobId;
  clearTimeout(ingestionPollTimer);
  $('#ingest-status').textContent = 'cancelling';
  $('#ingest-progress').textContent = '';
  $('#ingest-cancel').disabled = true;
  appendIngestionLog('cancelling');
  try {
    const job = await api(`/api/ingestions/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    renderIngestionJob(job);
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      $('#ingest-cancel').hidden = true;
      scheduleIngestionPoll();
    }
    return true;
  } catch (error) {
    $('#ingest-status').textContent = 'cancel not confirmed';
    $('#ingest-progress').textContent = '';
    appendIngestionLog('cancel not confirmed');
    $('#ingest-start').disabled = true;
    $('#ingest-cancel').disabled = false;
    $('#ingest-cancel').hidden = false;
    scheduleIngestionPoll(1500);
    return false;
  }
}

renderFontOptions();
syncRubiControl();

$('#selection-action').addEventListener('click', () => {
  if (!pendingSelection) return;
  const selection = { ...pendingSelection };
  $('#selection-action').hidden = true;
  showAnnotationDialog(selection, false);
});
$('#annotation-dialog form').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  void persistAnnotation();
});
$('#back').addEventListener('click', () => { void rendition?.prev(); });
$('#forward').addEventListener('click', () => { void rendition?.next(); });
$('#home-button').addEventListener('click', returnToLibrary);
$('#annotation-dialog').addEventListener('close', () => {
  dialogEpoch += 1;
  dialogSave = null;
  $('#note-text').readOnly = false;
  resetPendingSelection();
});
$('#menu-toggle').addEventListener('click', () => setMenuOpen(!$('#navigation-stack').classList.contains('is-open')));
$('#ingest-toggle').addEventListener('click', () => {
  setMenuOpen(false);
  setIngestOpen($('#ingest-panel').hidden);
});
$('#ingest-close').addEventListener('click', () => setIngestOpen(false));
$('#notes-toggle').addEventListener('click', () => setNotesOpen($('#notes-panel').hidden));
$('#notes-close').addEventListener('click', () => setNotesOpen(false));
$('#settings-toggle').addEventListener('click', () => {
  setMenuOpen(false);
  setSettingsOpen($('#settings-panel').hidden);
});
$('#reader-settings').addEventListener('click', () => setSettingsOpen(true));
$('#settings-close').addEventListener('click', () => setSettingsOpen(false));
$('#font-open').addEventListener('click', () => {
  $('#settings-main').hidden = true;
  $('#font-picker').hidden = false;
  $('#font-back').focus();
});
$('#font-back').addEventListener('click', () => {
  $('#font-picker').hidden = true;
  $('#settings-main').hidden = false;
  $('#font-open').focus();
});
document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener('change', () => {
  if (!input.checked) return;
  updateProfile((next) => {
    next.preferences.theme = input.value;
    return next;
  });
}));
$('#font-size').addEventListener('input', (event) => {
  updateProfile((next) => {
    next.preferences.fontSize = Number(event.currentTarget.value);
    return next;
  });
});
$('#line-height').addEventListener('input', (event) => {
  updateProfile((next) => {
    next.preferences.lineHeight = Number(event.currentTarget.value);
    return next;
  });
});
$('#page-width').addEventListener('input', (event) => {
  updateProfile((next) => {
    next.preferences.pageWidth = WIDTH_STOPS[Number(event.currentTarget.value)];
    return next;
  });
});
$('#page-margin').addEventListener('input', (event) => {
  updateProfile((next) => {
    next.preferences.margins = MARGIN_STOPS[Number(event.currentTarget.value)];
    return next;
  });
});
$('#page-padding').addEventListener('input', (event) => {
  updateProfile((next) => {
    next.preferences.padding = PADDING_STOPS[Number(event.currentTarget.value)];
    return next;
  });
});
document.querySelectorAll('[data-step-for]').forEach((button) => button.addEventListener('click', () => {
  stepRange(document.getElementById(button.dataset.stepFor), button.dataset.step);
}));
$('#settings-reset').addEventListener('click', () => {
  updateProfile((next) => {
    next.preferences = { ...DEFAULT_PREFERENCES };
    return next;
  }, { debounceMs: 0, message: 'reset' });
});
document.addEventListener('rubi:statechange', syncRubiControl);
$('#rubi-visibility').addEventListener('click', () => {
  if (rubi.getState() === RUBI_STATES.hidden) rubi.show();
  else rubi.hide();
  syncRubiControl();
});
$('#ingest-pdf').addEventListener('change', () => {
  const file = $('#ingest-pdf').files?.[0];
  $('#ingest-file').textContent = file ? lower(file.name) : 'choose';
  if (file && !$('#ingest-title').value.trim()) {
    $('#ingest-title').value = file.name.replace(/\.pdf$/iu, '').replaceAll(/[_-]+/gu, ' ').trim();
  }
});
$('#ingest-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('#ingest-pdf').files?.[0];
  if (!file) return;
  const runEpoch = ++ingestionEpoch;
  const controller = new AbortController();
  activeIngestionController?.abort();
  activeIngestionController = controller;
  clearTimeout(ingestionPollTimer);
  activeIngestionId = null;
  $('#ingest-log').replaceChildren();
  $('#ingest-download').hidden = true;
  $('#ingest-start').disabled = true;
  $('#ingest-cancel').disabled = false;
  $('#ingest-cancel').hidden = false;
  try {
    appendIngestionLog('loading local pdf tools');
    $('#ingest-status').textContent = 'loading local pdf tools';
    $('#ingest-progress').textContent = '';
    const runtime = await loadPdfRuntime();
    appendIngestionLog('extracting pages on this device');
    $('#ingest-status').textContent = 'extracting pages on this device';
    const extracted = await runtime.extract(file, {
      signal: controller.signal,
      onProgress: ({ current, total }) => {
        if (runEpoch === ingestionEpoch) $('#ingest-progress').textContent = `${current}/${total}`;
      },
    });
    if (runEpoch !== ingestionEpoch) throw new DOMException('cancelled.', 'AbortError');
    if (activeIngestionController === controller) activeIngestionController = null;
    const characterCount = extracted.pages.reduce((total, page) => total + page.text.length, 0);
    if (characterCount > 2_000_000) throw new Error('extracted text exceeds the two million character limit.');
    appendIngestionLog('local extraction complete');
    $('#ingest-pdf').value = '';
    $('#ingest-file').textContent = 'extracted';
    $('#ingest-status').textContent = 'queueing';
    $('#ingest-progress').textContent = '';
    const job = await api('/api/ingestions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pages: extracted.pages,
        metadata: {
          title: $('#ingest-title').value.trim(),
          author: $('#ingest-author').value.trim(),
          language: $('#ingest-language').value.trim().toLowerCase(),
        },
      }),
    });
    if (runEpoch !== ingestionEpoch) {
      await cancelServerIngestion(job.id);
      return;
    }
    activeIngestionId = job.id;
    renderIngestionJob(job);
    void pollIngestion();
  } catch (error) {
    if (runEpoch !== ingestionEpoch || error.name === 'AbortError') {
      $('#ingest-status').textContent = 'cancelled';
      $('#ingest-progress').textContent = '';
      appendIngestionLog('cancelled');
    } else {
      $('#ingest-status').textContent = lower(error.message || 'not started');
      $('#ingest-progress').textContent = '';
      appendIngestionLog(error.message || 'not started');
    }
    $('#ingest-start').disabled = false;
    $('#ingest-cancel').hidden = true;
  } finally {
    if (activeIngestionController === controller) activeIngestionController = null;
  }
});
$('#ingest-cancel').addEventListener('click', async () => {
  ingestionEpoch += 1;
  if (activeIngestionController) {
    activeIngestionController.abort();
    activeIngestionController = null;
  }
  if (!activeIngestionId) {
    $('#ingest-start').disabled = false;
    $('#ingest-cancel').disabled = false;
    $('#ingest-cancel').hidden = true;
    $('#ingest-status').textContent = 'cancelled';
    $('#ingest-progress').textContent = '';
    appendIngestionLog('cancelled');
    return;
  }
  await cancelServerIngestion(activeIngestionId);
});
$('#organize-open').addEventListener('click', () => {
  renderOrganizer();
  $('#organize-dialog').showModal();
  $('#new-folder-name').focus();
});
$('#organize-close').addEventListener('click', () => $('#organize-dialog').close());
$('#new-folder-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#new-folder-name').value.trim();
  if (!name) return;
  updateProfile(
    (next) => createDirectory(next, name, $('#new-folder-parent').value || null),
    { structure: true, debounceMs: 0, message: 'created' },
  );
  $('#new-folder-form').reset();
  $('#new-folder-name').focus();
});
$('#retry-save').addEventListener('click', () => { if (activeSlug) saves.retry(activeSlug); });
$('#bookmark-current').addEventListener('click', toggleCurrentBookmark);
$('#retry-bookmarks').addEventListener('click', () => {
  if (!activeSlug) return;
  if (bookmarkLoadFailed) {
    void hydrateBookmarks(activeSlug, selectionEpoch).then(() => renderBookmarkButton());
  } else if (bookmarkHydrated && activeBookmarkSession) {
    void activeBookmarkSession.queue.retry();
  }
});
$('#logout').addEventListener('click', async () => {
  const hasUnsavedChanges = catalog.some((item) => saves.status(item.book)?.dirty)
    || [...bookmarkSessions.values()].some((session) => session.queue.dirty());
  if (hasUnsavedChanges && !window.confirm('changes are still saving. sign out?')) return;
  try {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) throw new Error('could not sign out.');
    location.href = '/login.html';
  } catch (error) { $('#save-status').textContent = lower(error.message || 'could not sign out.'); }
});
document.addEventListener('keydown', (event) => {
  trapOverlayFocus(event);
  if (event.key === 'Escape') {
    if ($('#organize-dialog').open) $('#organize-dialog').close();
    else if ($('#annotation-dialog').open) $('#annotation-dialog').close();
    else if (!$('#font-picker').hidden) $('#font-back').click();
    else if (!$('#ingest-panel').hidden) setIngestOpen(false);
    else if (!$('#settings-panel').hidden) setSettingsOpen(false);
    else if (!$('#notes-panel').hidden) setNotesOpen(false);
    else setMenuOpen(false);
    return;
  }
  const formControl = event.target instanceof HTMLElement
    && (event.target.matches('input, textarea, select, button') || event.target.isContentEditable);
  if (formControl || activeOverlay()) return;
  if (event.key === 'ArrowLeft') void rendition?.prev();
  if (event.key === 'ArrowRight') void rendition?.next();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (activeSlug) {
    void saves.flush(activeSlug);
    flushActiveBookmarks();
  }
  void flushProfile();
});
window.addEventListener('pagehide', () => {
  if (activeSlug) {
    void saves.flush(activeSlug);
    flushActiveBookmarks();
  }
  void flushProfile();
});
window.addEventListener('online', () => {
  void flushProfile();
  flushActiveBookmarks();
});
window.addEventListener('resize', () => {
  updateOverlayInert();
  refreshReaderTheme();
});

installGridMotion({
  targets: [
    $('#navigation-stack'),
    $('#notes-panel'),
    $('#settings-panel'),
    $('#ingest-panel'),
  ],
});

void loadCatalog().catch(showCatalogError);
