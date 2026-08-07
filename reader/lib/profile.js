export const PROFILE_SCHEMA_VERSION = 1;

export const FONT_FAMILIES = Object.freeze([
  'iowan',
  'charter',
  'baskerville',
  'palatino',
  'georgia',
  'times',
  'bookman',
  'cochin',
  'didot',
  'hoefler',
  'system-serif',
  'avenir',
  'helvetica',
  'optima',
  'futura',
  'gill-sans',
  'verdana',
  'trebuchet',
  'system-sans',
  'menlo',
  'courier',
  'system-mono',
]);

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'dark',
  fontFamily: 'iowan',
  fontSize: 18,
  lineHeight: 1.6,
  pageWidth: 736,
  margins: 48,
  padding: 48,
});

export const DEFAULT_LAYOUT = Object.freeze({
  panels: Object.freeze({
    notes: 368,
    settings: 368,
    ingest: 368,
  }),
  rubi: Object.freeze({
    state: 'expanded',
    edge: 'left',
    y: 0.58,
  }),
});

export const PAGE_WIDTHS = Object.freeze([544, 640, 736, 832, 928]);
export const MARGINS = Object.freeze([24, 36, 48, 64, 80]);
export const PADDINGS = Object.freeze([16, 24, 32, 48, 64]);

const THEMES = new Set(['light', 'dark']);
const FONT_FAMILY_SET = new Set(FONT_FAMILIES);
const DIRECTORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_DIRECTORIES = 100;
const MAX_DIRECTORY_DEPTH = 8;
const MAX_POSITION = 10_000;
const MAX_PROFILE_REVISION = 2_147_483_646;
const RUBI_STATES = new Set(['expanded', 'collapsed', 'hidden']);
const RUBI_EDGES = new Set(['left', 'right']);

export class ProfileValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ProfileValidationError';
    this.code = 'invalid_profile';
    this.field = field;
  }
}

function fail(field, message) {
  throw new ProfileValidationError(field, message);
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, field) {
  if (!isRecord(value)) fail(field, 'must be an object');
  return value;
}

function requireExactKeys(value, field, required, optional = []) {
  const keys = Object.keys(requireRecord(value, field));
  const allowed = new Set([...required, ...optional]);
  for (const key of keys) if (!allowed.has(key)) fail(field ? `${field}.${key}` : key, 'is not allowed');
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(field ? `${field}.${key}` : key, 'is required');
  }
}

function requireSafeInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(field, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireFiniteNumber(value, field, minimum, maximum, decimalPlaces = null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(field, `must be a number from ${minimum} to ${maximum}`);
  }
  if (decimalPlaces !== null) {
    const scale = 10 ** decimalPlaces;
    if (!Number.isSafeInteger(Math.round(value * scale)) || Math.abs(value * scale - Math.round(value * scale)) > 1e-9) {
      fail(field, `must have at most ${decimalPlaces} decimal places`);
    }
  }
  return value;
}

function requireChoiceNumber(value, field, choices) {
  if (typeof value !== 'number' || !choices.includes(value)) {
    fail(field, `must be one of ${choices.join(', ')}`);
  }
  return value;
}

function catalogSlugs(bookSlugs) {
  if (!Array.isArray(bookSlugs)) throw new Error('The catalog must be an array.');
  const seen = new Set();
  return bookSlugs.map((slug) => {
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug) || seen.has(slug)) {
      throw new Error('The catalog contains an invalid or duplicate book slug.');
    }
    seen.add(slug);
    return slug;
  });
}

function validatePreferences(value) {
  const required = ['theme', 'fontFamily', 'fontSize', 'lineHeight', 'pageWidth', 'margins', 'padding'];
  requireExactKeys(value, 'preferences', required);
  if (!THEMES.has(value.theme)) fail('preferences.theme', 'must be light or dark');
  if (!FONT_FAMILY_SET.has(value.fontFamily)) fail('preferences.fontFamily', 'must be a supported font preset');
  const lineHeight = requireFiniteNumber(value.lineHeight, 'preferences.lineHeight', 1.2, 2.4, 2);
  if (Math.abs(lineHeight * 20 - Math.round(lineHeight * 20)) > 1e-9) {
    fail('preferences.lineHeight', 'must use increments of 0.05');
  }
  return {
    theme: value.theme,
    fontFamily: value.fontFamily,
    fontSize: requireSafeInteger(value.fontSize, 'preferences.fontSize', 12, 40),
    lineHeight,
    pageWidth: requireChoiceNumber(value.pageWidth, 'preferences.pageWidth', PAGE_WIDTHS),
    margins: requireChoiceNumber(value.margins, 'preferences.margins', MARGINS),
    padding: requireChoiceNumber(value.padding, 'preferences.padding', PADDINGS),
  };
}

function defaultLayout() {
  return {
    panels: { ...DEFAULT_LAYOUT.panels },
    rubi: { ...DEFAULT_LAYOUT.rubi },
  };
}

function validateLayout(value) {
  if (value === undefined) return defaultLayout();
  requireExactKeys(value, 'layout', ['panels', 'rubi']);
  requireExactKeys(value.panels, 'layout.panels', ['notes', 'settings', 'ingest']);
  requireExactKeys(value.rubi, 'layout.rubi', ['state', 'edge', 'y']);
  if (!RUBI_STATES.has(value.rubi.state)) {
    fail('layout.rubi.state', 'must be expanded, collapsed, or hidden');
  }
  if (!RUBI_EDGES.has(value.rubi.edge)) {
    fail('layout.rubi.edge', 'must be left or right');
  }
  return {
    panels: {
      notes: requireSafeInteger(value.panels.notes, 'layout.panels.notes', 280, 720),
      settings: requireSafeInteger(value.panels.settings, 'layout.panels.settings', 280, 720),
      ingest: requireSafeInteger(value.panels.ingest, 'layout.panels.ingest', 280, 720),
    },
    rubi: {
      state: value.rubi.state,
      edge: value.rubi.edge,
      y: requireFiniteNumber(value.rubi.y, 'layout.rubi.y', 0, 1, 4),
    },
  };
}

function validateDirectoryName(value, field) {
  if (typeof value !== 'string') fail(field, 'must be a string');
  const canonical = value.trim().normalize('NFC');
  if (!canonical || [...canonical].length > 80 || CONTROL_CHARACTERS.test(canonical)) {
    fail(field, 'must contain 1 to 80 characters without control characters');
  }
  return canonical;
}

function validateDirectoryId(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !DIRECTORY_ID.test(value)) fail(field, 'must be a lowercase uuid');
  return value;
}

function validateDirectories(value) {
  if (!Array.isArray(value)) fail('directories', 'must be an array');
  if (value.length > MAX_DIRECTORIES) fail('directories', `must contain at most ${MAX_DIRECTORIES} items`);

  const ids = new Set();
  const directories = value.map((item, index) => {
    const field = `directories[${index}]`;
    requireExactKeys(item, field, ['id', 'name', 'parentId', 'position']);
    const id = validateDirectoryId(item.id, `${field}.id`);
    if (ids.has(id)) fail(`${field}.id`, 'must be unique');
    ids.add(id);
    return {
      id,
      name: validateDirectoryName(item.name, `${field}.name`),
      parentId: validateDirectoryId(item.parentId, `${field}.parentId`, { nullable: true }),
      position: requireSafeInteger(item.position, `${field}.position`, 0, MAX_POSITION),
    };
  });

  const byId = new Map(directories.map((directory) => [directory.id, directory]));
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    if (directory.parentId !== null && !byId.has(directory.parentId)) {
      fail(`directories[${index}].parentId`, 'must reference an existing directory');
    }
    const visited = new Set([directory.id]);
    let current = directory;
    let depth = 0;
    while (current.parentId !== null) {
      if (visited.has(current.parentId)) fail(`directories[${index}].parentId`, 'must not create a cycle');
      visited.add(current.parentId);
      current = byId.get(current.parentId);
      depth += 1;
      if (depth > MAX_DIRECTORY_DEPTH) {
        fail(`directories[${index}].parentId`, `must not exceed ${MAX_DIRECTORY_DEPTH} nested levels`);
      }
    }
  }

  validateSiblingPositions(directories, (directory) => directory.parentId, 'directories');
  return directories;
}

function validateSiblingPositions(items, groupFor, field) {
  const groups = new Map();
  for (const item of items) {
    const group = groupFor(item);
    const positions = groups.get(group) || [];
    positions.push(item.position);
    groups.set(group, positions);
  }
  for (const positions of groups.values()) {
    positions.sort((left, right) => left - right);
    for (let index = 0; index < positions.length; index += 1) {
      if (positions[index] !== index) fail(field, 'sibling positions must be unique and contiguous from zero');
    }
  }
}

function validateBooks(value, bookSlugs, directoryIds) {
  if (!Array.isArray(value)) fail('books', 'must be an array');
  const knownBooks = new Set(bookSlugs);
  const seenBooks = new Set();
  const books = value.map((item, index) => {
    const field = `books[${index}]`;
    requireExactKeys(item, field, ['book', 'directoryId', 'position']);
    if (typeof item.book !== 'string' || !knownBooks.has(item.book)) fail(`${field}.book`, 'must reference a catalog book');
    if (seenBooks.has(item.book)) fail(`${field}.book`, 'must be unique');
    seenBooks.add(item.book);
    const directoryId = validateDirectoryId(item.directoryId, `${field}.directoryId`, { nullable: true });
    if (directoryId !== null && !directoryIds.has(directoryId)) {
      fail(`${field}.directoryId`, 'must reference an existing directory');
    }
    return {
      book: item.book,
      directoryId,
      position: requireSafeInteger(item.position, `${field}.position`, 0, MAX_POSITION),
    };
  });

  for (const slug of bookSlugs) if (!seenBooks.has(slug)) fail('books', `must include catalog book ${slug}`);
  if (books.length !== bookSlugs.length) fail('books', 'must contain each catalog book exactly once');
  validateSiblingPositions(books, (book) => book.directoryId, 'books');
  return books;
}

export function createDefaultProfile(bookSlugs) {
  const slugs = catalogSlugs(bookSlugs);
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    preferences: { ...DEFAULT_PREFERENCES },
    layout: defaultLayout(),
    directories: [],
    books: slugs.map((book, position) => ({ book, directoryId: null, position })),
  };
}

export function validateProfileDocument(value, bookSlugs) {
  const slugs = catalogSlugs(bookSlugs);
  requireExactKeys(value, '', ['schemaVersion', 'preferences', 'directories', 'books'], ['layout']);
  if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) fail('schemaVersion', `must be ${PROFILE_SCHEMA_VERSION}`);
  const directories = validateDirectories(value.directories);
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    preferences: validatePreferences(value.preferences),
    layout: validateLayout(value.layout),
    directories,
    books: validateBooks(value.books, slugs, new Set(directories.map((directory) => directory.id))),
  };
}

export function validateProfileUpdate(value, bookSlugs) {
  requireExactKeys(
    value,
    '',
    ['schemaVersion', 'revision', 'preferences', 'layout', 'directories', 'books'],
    ['updatedAt'],
  );
  const revision = requireSafeInteger(value.revision, 'revision', 0, MAX_PROFILE_REVISION);
  if (Object.hasOwn(value, 'updatedAt') && value.updatedAt !== null) {
    const parsed = typeof value.updatedAt === 'string' ? Date.parse(value.updatedAt) : Number.NaN;
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.updatedAt) {
      fail('updatedAt', 'must be null or an iso timestamp');
    }
  }
  return {
    revision,
    document: validateProfileDocument({
      schemaVersion: value.schemaVersion,
      preferences: value.preferences,
      layout: value.layout,
      directories: value.directories,
      books: value.books,
    }, bookSlugs),
  };
}

function reindexBooks(items, bookSlugs) {
  const knownBooks = new Set(bookSlugs);
  const seenBooks = new Set();
  const groups = new Map();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isRecord(item) || typeof item.book !== 'string' || !knownBooks.has(item.book) || seenBooks.has(item.book)) continue;
    seenBooks.add(item.book);
    const group = item.directoryId === null ? null : item.directoryId;
    const entries = groups.get(group) || [];
    entries.push({ ...item, sourceIndex: index });
    groups.set(group, entries);
  }

  const books = [];
  for (const entries of groups.values()) {
    entries.sort((left, right) => {
      const leftPosition = Number.isSafeInteger(left.position) ? left.position : MAX_POSITION + 1;
      const rightPosition = Number.isSafeInteger(right.position) ? right.position : MAX_POSITION + 1;
      return leftPosition - rightPosition || left.sourceIndex - right.sourceIndex;
    });
    entries.forEach((item, position) => books.push({
      book: item.book,
      directoryId: item.directoryId,
      position,
    }));
  }

  const rootCount = books.filter((book) => book.directoryId === null).length;
  let rootPosition = rootCount;
  for (const book of bookSlugs) {
    if (!seenBooks.has(book)) books.push({ book, directoryId: null, position: rootPosition++ });
  }
  return books;
}

export function reconcileStoredProfile(value, bookSlugs) {
  const slugs = catalogSlugs(bookSlugs);
  if (!isRecord(value) || !Object.keys(value).length) return createDefaultProfile(slugs);
  const candidate = {
    schemaVersion: value.schemaVersion,
    preferences: value.preferences,
    layout: value.layout,
    directories: value.directories,
    books: reindexBooks(Array.isArray(value.books) ? value.books : [], slugs),
  };
  return validateProfileDocument(candidate, slugs);
}

export function formatProfileRecord(record, bookSlugs) {
  if (!isRecord(record)) throw new Error('The profile store returned an invalid record.');
  const revision = Number(record.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('The profile store returned an invalid revision.');
  const updatedAt = record.updatedAt === null || record.updatedAt === undefined
    ? null
    : new Date(record.updatedAt).toISOString();
  return {
    ...reconcileStoredProfile(record.document, bookSlugs),
    revision,
    updatedAt,
  };
}
