import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultProfile,
  DEFAULT_LAYOUT,
  DEFAULT_PREFERENCES,
  FONT_FAMILIES,
  ProfileValidationError,
  reconcileStoredProfile,
  validateProfileUpdate,
} from '../lib/profile.js';

const BOOKS = ['alpha-reading', 'beta-reading', 'gamma-reading'];
const ROOT_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

function updateBody() {
  return { ...createDefaultProfile(BOOKS), revision: 0, updatedAt: null };
}

function expectInvalid(mutator, field) {
  const body = updateBody();
  mutator(body);
  assert.throws(
    () => validateProfileUpdate(body, BOOKS),
    (error) => error instanceof ProfileValidationError && error.field === field,
  );
}

test('an empty catalog produces a valid empty profile', () => {
  const profile = createDefaultProfile([]);
  assert.deepEqual(profile.books, []);
  assert.deepEqual(
    validateProfileUpdate({ ...profile, revision: 0, updatedAt: null }, []).document,
    profile,
  );
});

test('profile defaults expose all reader controls', () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    theme: 'dark',
    fontFamily: 'iowan',
    fontSize: 18,
    lineHeight: 1.6,
    pageWidth: 736,
    margins: 48,
    padding: 48,
  });
  assert.ok(FONT_FAMILIES.length >= 20);
  const profile = createDefaultProfile(BOOKS);
  assert.deepEqual(profile.books, BOOKS.map((book, position) => ({
    book,
    directoryId: null,
    position,
  })));
  assert.deepEqual(profile.layout, DEFAULT_LAYOUT);
});

test('canonicalizes nested directories and supported preferences', () => {
  const body = updateBody();
  body.preferences = {
    theme: 'light',
    fontFamily: 'charter',
    fontSize: 22,
    lineHeight: 1.75,
    pageWidth: 832,
    margins: 64,
    padding: 32,
  };
  body.directories = [
    { id: ROOT_ID, name: '  theory  ', parentId: null, position: 0 },
    { id: CHILD_ID, name: 'Methods', parentId: ROOT_ID, position: 0 },
  ];
  body.books = [
    { book: BOOKS[0], directoryId: CHILD_ID, position: 0 },
    { book: BOOKS[1], directoryId: null, position: 0 },
    { book: BOOKS[2], directoryId: null, position: 1 },
  ];

  const result = validateProfileUpdate(body, BOOKS);
  assert.equal(result.document.directories[0].name, 'theory');
  assert.equal(result.document.directories[1].name, 'Methods');
  assert.deepEqual(result.document.preferences, body.preferences);
  assert.deepEqual(result.document.layout, body.layout);
});

test('rejects unknown fields, malformed directories, and missing book placements', () => {
  expectInvalid((body) => { body.extra = true; }, 'extra');
  expectInvalid((body) => { body.preferences.theme = 'system'; }, 'preferences.theme');
  expectInvalid((body) => { body.preferences.fontSize = 11; }, 'preferences.fontSize');
  expectInvalid((body) => { body.layout.extra = true; }, 'layout.extra');
  expectInvalid((body) => { body.layout.panels.notes = 279; }, 'layout.panels.notes');
  expectInvalid((body) => { body.layout.panels.settings = 721; }, 'layout.panels.settings');
  expectInvalid((body) => { body.layout.panels.ingest = 400.5; }, 'layout.panels.ingest');
  expectInvalid((body) => { body.layout.rubi.state = 'floating'; }, 'layout.rubi.state');
  expectInvalid((body) => { body.layout.rubi.edge = 'center'; }, 'layout.rubi.edge');
  expectInvalid((body) => { body.layout.rubi.y = 1.01; }, 'layout.rubi.y');
  expectInvalid((body) => { body.layout.rubi.y = 0.12345; }, 'layout.rubi.y');
  expectInvalid((body) => {
    body.directories = [{ id: ROOT_ID, name: 'bad\nname', parentId: null, position: 0 }];
  }, 'directories[0].name');
  expectInvalid((body) => { body.books.pop(); }, 'books');
  expectInvalid((body) => { body.books[0].book = 'unknown'; }, 'books[0].book');
});

test('reconciles catalog additions and removals without resetting preferences', () => {
  const stored = createDefaultProfile(BOOKS);
  stored.preferences.fontFamily = 'didot';
  delete stored.layout;
  const reconciled = reconcileStoredProfile(
    stored,
    [BOOKS[0], BOOKS[2], 'delta-reading'],
  );
  assert.equal(reconciled.preferences.fontFamily, 'didot');
  assert.deepEqual(reconciled.layout, DEFAULT_LAYOUT);
  assert.deepEqual(reconciled.books, [
    { book: BOOKS[0], directoryId: null, position: 0 },
    { book: BOOKS[2], directoryId: null, position: 1 },
    { book: 'delta-reading', directoryId: null, position: 2 },
  ]);
});
