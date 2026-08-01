import {
  appReducer,
  collectDirectoryCascade,
  isDescendantDirectory,
  newEntry,
  type AppState,
} from './AppContext';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry, Directory } from '../types/editor';

function makeEntry(id: string, parentId: string | null, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    name: id,
    parentId,
    kind: 'writing',
    order: 0,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 0,
    updatedAt: 0,
    wordCount: 0,
    recordedDurationMs: 0,
    audioTakes: 0,
    draftHistory: [],
    ...overrides,
  };
}

function makeDirectory(
  id: string,
  parentId: string | null,
  kind: Directory['kind'] = 'folder'
): Directory {
  return { id, name: id, parentId, kind };
}

// dir-a > dir-b > dir-c nested chain, dir-d unrelated at root;
// one entry inside each directory plus one at the root
function makeState(): AppState {
  return {
    directories: {
      'dir-a': makeDirectory('dir-a', null),
      'dir-b': makeDirectory('dir-b', 'dir-a'),
      'dir-c': makeDirectory('dir-c', 'dir-b'),
      'dir-d': makeDirectory('dir-d', null),
    },
    entries: {
      'entry-a': makeEntry('entry-a', 'dir-a'),
      'entry-b': makeEntry('entry-b', 'dir-b'),
      'entry-c': makeEntry('entry-c', 'dir-c'),
      'entry-d': makeEntry('entry-d', 'dir-d'),
      'entry-root': makeEntry('entry-root', null),
    },
    activeEntryId: null,
    refinementSettings: { genre: 'freewrite', scale: 'sentence', temperature: 0.5 },
    lexicon: {},
  };
}

describe('appReducer DELETE_DIRECTORY', () => {
  it('cascades through nested subdirectories and their entries', () => {
    const state = makeState();
    const next = appReducer(state, { type: 'DELETE_DIRECTORY', id: 'dir-a' });

    expect(Object.keys(next.directories)).toEqual(['dir-d']);
    expect(Object.keys(next.entries).sort()).toEqual(['entry-d', 'entry-root']);
  });

  it('leaves unrelated siblings untouched when deleting a mid-level directory', () => {
    const state = makeState();
    const next = appReducer(state, { type: 'DELETE_DIRECTORY', id: 'dir-b' });

    expect(Object.keys(next.directories).sort()).toEqual(['dir-a', 'dir-d']);
    expect(Object.keys(next.entries).sort()).toEqual([
      'entry-a',
      'entry-d',
      'entry-root',
    ]);
  });

  it('clears activeEntryId when the active entry lived in a deleted subdirectory', () => {
    const state = { ...makeState(), activeEntryId: 'entry-c' };
    const next = appReducer(state, { type: 'DELETE_DIRECTORY', id: 'dir-a' });
    expect(next.activeEntryId).toBeNull();
  });

  it('preserves activeEntryId when the active entry survives', () => {
    const state = { ...makeState(), activeEntryId: 'entry-d' };
    const next = appReducer(state, { type: 'DELETE_DIRECTORY', id: 'dir-a' });
    expect(next.activeEntryId).toBe('entry-d');
  });
});

describe('collectDirectoryCascade', () => {
  it('collects the full descendant directory and entry id sets', () => {
    const state = makeState();
    const { directoryIds, entryIds } = collectDirectoryCascade(
      state.directories,
      state.entries,
      'dir-a'
    );

    expect([...directoryIds].sort()).toEqual(['dir-a', 'dir-b', 'dir-c']);
    expect(entryIds.sort()).toEqual(['entry-a', 'entry-b', 'entry-c']);
  });

  it('returns only the root and its direct entries for a leaf directory', () => {
    const state = makeState();
    const { directoryIds, entryIds } = collectDirectoryCascade(
      state.directories,
      state.entries,
      'dir-c'
    );

    expect([...directoryIds]).toEqual(['dir-c']);
    expect(entryIds).toEqual(['entry-c']);
  });
});

describe('appReducer UPDATE_ENTRY', () => {
  it('recomputes wordCount when rawTranscript changes', () => {
    const state = makeState();
    const next = appReducer(state, {
      type: 'UPDATE_ENTRY',
      id: 'entry-root',
      updates: { rawTranscript: 'four words in here' },
    });
    expect(next.entries['entry-root'].wordCount).toBe(4);
  });

  it('leaves wordCount untouched when other fields change', () => {
    const state = makeState();
    state.entries['entry-root'].wordCount = 7;
    const next = appReducer(state, {
      type: 'UPDATE_ENTRY',
      id: 'entry-root',
      updates: { refinedText: 'polished' },
    });
    expect(next.entries['entry-root'].wordCount).toBe(7);
  });

  it('returns state unchanged for unknown entry ids', () => {
    const state = makeState();
    const next = appReducer(state, {
      type: 'UPDATE_ENTRY',
      id: 'missing',
      updates: { refinedText: 'x' },
    });
    expect(next).toBe(state);
  });
});

describe('newEntry', () => {
  it('initializes metadata fields', () => {
    const entry = newEntry(null);
    expect(entry.wordCount).toBe(0);
    expect(entry.recordedDurationMs).toBe(0);
    expect(entry.audioTakes).toBe(0);
    expect(entry.draftHistory).toEqual([]);
  });

  it('defaults to a writing entry with order 0', () => {
    const entry = newEntry(null);
    expect(entry.kind).toBe('writing');
    expect(entry.order).toBe(0);
  });

  it('creates notes when asked', () => {
    const entry = newEntry(null, 'note');
    expect(entry.kind).toBe('note');
  });
});

describe('appReducer MOVE_NODE', () => {
  it('moves an entry to a new parent and appends its order after existing siblings', () => {
    const state = makeState();
    state.entries['entry-b'].order = 4;
    const next = appReducer(state, {
      type: 'MOVE_NODE',
      nodeType: 'entry',
      id: 'entry-root',
      newParentId: 'dir-b',
    });
    expect(next.entries['entry-root'].parentId).toBe('dir-b');
    expect(next.entries['entry-root'].order).toBe(5);
  });

  it('brings attached notes along when their entry moves', () => {
    const state = makeState();
    state.entries['note-1'] = makeEntry('note-1', null, {
      kind: 'note',
      attachedToId: 'entry-root',
    });
    const next = appReducer(state, {
      type: 'MOVE_NODE',
      nodeType: 'entry',
      id: 'entry-root',
      newParentId: 'dir-d',
    });
    expect(next.entries['note-1'].parentId).toBe('dir-d');
    expect(next.entries['note-1'].attachedToId).toBe('entry-root');
  });

  it('detaches a note that is moved away on its own', () => {
    const state = makeState();
    state.entries['note-1'] = makeEntry('note-1', null, {
      kind: 'note',
      attachedToId: 'entry-root',
    });
    const next = appReducer(state, {
      type: 'MOVE_NODE',
      nodeType: 'entry',
      id: 'note-1',
      newParentId: 'dir-d',
    });
    expect(next.entries['note-1'].parentId).toBe('dir-d');
    expect(next.entries['note-1'].attachedToId).toBeUndefined();
  });

  it('refuses to move a directory into its own descendant', () => {
    const state = makeState();
    const next = appReducer(state, {
      type: 'MOVE_NODE',
      nodeType: 'directory',
      id: 'dir-a',
      newParentId: 'dir-c',
    });
    expect(next).toBe(state);
  });

  it('refuses to move a directory into itself', () => {
    const state = makeState();
    expect(
      appReducer(state, {
        type: 'MOVE_NODE',
        nodeType: 'directory',
        id: 'dir-a',
        newParentId: 'dir-a',
      })
    ).toBe(state);
  });

  it('moves a directory to the root', () => {
    const state = makeState();
    const next = appReducer(state, {
      type: 'MOVE_NODE',
      nodeType: 'directory',
      id: 'dir-c',
      newParentId: null,
    });
    expect(next.directories['dir-c'].parentId).toBeNull();
  });
});

describe('appReducer CREATE_ENTRY ordering', () => {
  it('assigns order after existing siblings', () => {
    const state = makeState();
    state.entries['entry-d'].order = 2;
    const created = makeEntry('entry-new', 'dir-d');
    const next = appReducer(state, { type: 'CREATE_ENTRY', entry: created });
    expect(next.entries['entry-new'].order).toBe(3);
  });
});

describe('appReducer REORDER_ENTRY', () => {
  function bookState(): AppState {
    const state = makeState();
    state.directories['book-1'] = makeDirectory('book-1', null, 'book');
    state.entries['ch-1'] = makeEntry('ch-1', 'book-1', { order: 0 });
    state.entries['ch-2'] = makeEntry('ch-2', 'book-1', { order: 1 });
    state.entries['ch-3'] = makeEntry('ch-3', 'book-1', { order: 2 });
    return state;
  }

  it('places the moved entry before beforeId and re-sequences', () => {
    const next = appReducer(bookState(), {
      type: 'REORDER_ENTRY',
      id: 'ch-3',
      beforeId: 'ch-1',
    });
    expect(next.entries['ch-3'].order).toBe(0);
    expect(next.entries['ch-1'].order).toBe(1);
    expect(next.entries['ch-2'].order).toBe(2);
  });

  it('moves to the end when beforeId is null', () => {
    const next = appReducer(bookState(), {
      type: 'REORDER_ENTRY',
      id: 'ch-1',
      beforeId: null,
    });
    expect(next.entries['ch-2'].order).toBe(0);
    expect(next.entries['ch-3'].order).toBe(1);
    expect(next.entries['ch-1'].order).toBe(2);
  });

  it('returns state unchanged for unknown beforeId', () => {
    const state = bookState();
    expect(
      appReducer(state, { type: 'REORDER_ENTRY', id: 'ch-1', beforeId: 'missing' })
    ).toBe(state);
  });
});

describe('appReducer SET_DIRECTORY_KIND', () => {
  it('freezes alphabetical order when promoting a folder to a book', () => {
    const state = makeState();
    state.entries['zeta'] = makeEntry('zeta', 'dir-d', { name: 'Zeta', order: 9 });
    state.entries['alpha'] = makeEntry('alpha', 'dir-d', { name: 'Alpha', order: 3 });
    state.entries['entry-d'].name = 'Middling';
    state.entries['entry-d'].order = 7;

    const next = appReducer(state, {
      type: 'SET_DIRECTORY_KIND',
      id: 'dir-d',
      kind: 'book',
    });
    expect(next.directories['dir-d'].kind).toBe('book');
    expect(next.entries['alpha'].order).toBe(0);
    expect(next.entries['entry-d'].order).toBe(1);
    expect(next.entries['zeta'].order).toBe(2);
  });

  it('demoting a book to folder keeps orders inert', () => {
    const state = makeState();
    state.directories['dir-d'] = makeDirectory('dir-d', null, 'book');
    state.entries['entry-d'].order = 5;
    const next = appReducer(state, {
      type: 'SET_DIRECTORY_KIND',
      id: 'dir-d',
      kind: 'folder',
    });
    expect(next.directories['dir-d'].kind).toBe('folder');
    expect(next.entries['entry-d'].order).toBe(5);
  });
});

describe('appReducer note attachment', () => {
  it('ATTACH_NOTE sets attachedToId and syncs parentId to the target', () => {
    const state = makeState();
    state.entries['note-1'] = makeEntry('note-1', null, { kind: 'note' });
    const next = appReducer(state, {
      type: 'ATTACH_NOTE',
      noteId: 'note-1',
      entryId: 'entry-b',
    });
    expect(next.entries['note-1'].attachedToId).toBe('entry-b');
    expect(next.entries['note-1'].parentId).toBe('dir-b');
  });

  it('ATTACH_NOTE refuses note targets and non-notes', () => {
    const state = makeState();
    state.entries['note-1'] = makeEntry('note-1', null, { kind: 'note' });
    state.entries['note-2'] = makeEntry('note-2', null, { kind: 'note' });
    expect(
      appReducer(state, { type: 'ATTACH_NOTE', noteId: 'note-1', entryId: 'note-2' })
    ).toBe(state);
    expect(
      appReducer(state, { type: 'ATTACH_NOTE', noteId: 'entry-root', entryId: 'entry-b' })
    ).toBe(state);
  });

  it('DETACH_NOTE clears the link and leaves the note in place', () => {
    const state = makeState();
    state.entries['note-1'] = makeEntry('note-1', 'dir-b', {
      kind: 'note',
      attachedToId: 'entry-b',
    });
    const next = appReducer(state, { type: 'DETACH_NOTE', noteId: 'note-1' });
    expect(next.entries['note-1'].attachedToId).toBeUndefined();
    expect(next.entries['note-1'].parentId).toBe('dir-b');
  });

  it('DELETE_ENTRY detaches surviving notes that pointed at it', () => {
    const state = makeState();
    state.entries['note-1'] = makeEntry('note-1', 'dir-d', {
      kind: 'note',
      attachedToId: 'entry-d',
    });
    const next = appReducer(state, { type: 'DELETE_ENTRY', id: 'entry-d' });
    expect(next.entries['note-1']).toBeDefined();
    expect(next.entries['note-1'].attachedToId).toBeUndefined();
  });
});

describe('isDescendantDirectory', () => {
  it('detects deep descendants and rejects unrelated directories', () => {
    const { directories } = makeState();
    expect(isDescendantDirectory(directories, 'dir-c', 'dir-a')).toBe(true);
    expect(isDescendantDirectory(directories, 'dir-a', 'dir-c')).toBe(false);
    expect(isDescendantDirectory(directories, 'dir-d', 'dir-a')).toBe(false);
  });
});

describe('appReducer lexicon actions', () => {
  const candidate = {
    id: 'com prosody→comprosody',
    heard: 'com prosody',
    canonical: 'comprosody',
    similarity: 1,
  };

  it('CONFIRM_LEXICON_TERM adds a term, then folds a repeat confirmation', () => {
    const state = makeState();
    const once = appReducer(state, { type: 'CONFIRM_LEXICON_TERM', candidate });
    expect(Object.keys(once.lexicon)).toHaveLength(1);

    const twice = appReducer(once, { type: 'CONFIRM_LEXICON_TERM', candidate });
    expect(Object.keys(twice.lexicon)).toHaveLength(1);
    expect(Object.values(twice.lexicon)[0].confirmations).toBe(2);
  });

  it('RECORD_LEXICON_MISFIRE increments misfires', () => {
    const confirmed = appReducer(makeState(), {
      type: 'CONFIRM_LEXICON_TERM',
      candidate,
    });
    const termId = Object.keys(confirmed.lexicon)[0];
    const next = appReducer(confirmed, { type: 'RECORD_LEXICON_MISFIRE', id: termId });
    expect(next.lexicon[termId].misfires).toBe(1);
  });

  it('DELETE_LEXICON_TERM removes the term', () => {
    const confirmed = appReducer(makeState(), {
      type: 'CONFIRM_LEXICON_TERM',
      candidate,
    });
    const termId = Object.keys(confirmed.lexicon)[0];
    const next = appReducer(confirmed, { type: 'DELETE_LEXICON_TERM', id: termId });
    expect(next.lexicon).toEqual({});
  });

  it('returns state unchanged for unknown lexicon ids', () => {
    const state = makeState();
    expect(appReducer(state, { type: 'DELETE_LEXICON_TERM', id: 'missing' })).toBe(state);
    expect(appReducer(state, { type: 'RECORD_LEXICON_MISFIRE', id: 'missing' })).toBe(state);
  });
});
