import {
  appReducer,
  collectDirectoryCascade,
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

function makeDirectory(id: string, parentId: string | null): Directory {
  return { id, name: id, parentId };
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
