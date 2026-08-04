import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../constants';
import {
  createDebouncedPersist,
  loadDirectories,
  loadEntries,
  loadRefinementSettings,
  normalizeEntry,
  saveEntries,
} from './storage';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';

beforeEach(() => {
  localStorage.clear();
});

describe('loadRefinementSettings', () => {
  it('loads only supported refinement settings', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      genre: 'academic',
      scale: 'paragraph',
      temperature: 0.35,
      mode: 'overhaul',
      highFidelity: false,
      autoRefine: false,
      unexpected: 'discard me',
    }));

    expect(loadRefinementSettings()).toEqual({
      genre: 'academic',
      scale: 'paragraph',
      temperature: 0.35,
      mode: 'overhaul',
      highFidelity: false,
      autoRefine: false,
    });
  });

  it('drops invalid values so application defaults remain authoritative', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      genre: 'legal-brief',
      scale: 'book',
      temperature: 1.5,
      mode: 'rewrite-everything',
      highFidelity: 'yes',
      autoRefine: 'always',
    }));

    expect(loadRefinementSettings()).toEqual({});
  });

  it('migrates the legacy boolean fidelity field without trusting other legacy values', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      fidelity: true,
      temperature: '0.2',
      autoRefine: null,
    }));

    expect(loadRefinementSettings()).toEqual({
      highFidelity: true,
    });
  });

  it.each(['null', '[]', '"academic"', '{not-json'])(
    'returns an empty settings object for invalid storage payload %s',
    (payload) => {
      localStorage.setItem(STORAGE_KEYS.settings, payload);
      expect(loadRefinementSettings()).toEqual({});
    },
  );
});

function makeLegacyEntry(overrides: Partial<Entry> = {}): Partial<Entry> & { id: string } {
  return {
    id: 'e1',
    name: 'First take',
    parentId: null,
    rawTranscript: 'one two three',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('createDebouncedPersist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces schedules within the delay into one trailing save', () => {
    const save = vi.fn();
    const persist = createDebouncedPersist<string>(save, 300);

    persist.schedule('first');
    persist.schedule('second');
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('second');
  });

  it('flush saves pending value immediately with no later duplicate', () => {
    const save = vi.fn();
    const persist = createDebouncedPersist<string>(save, 300);

    persist.schedule('value');
    persist.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('value');

    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush without pending value does nothing', () => {
    const save = vi.fn();
    const persist = createDebouncedPersist<string>(save, 300);

    persist.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancel discards pending value without saving', () => {
    const save = vi.fn();
    const persist = createDebouncedPersist<string>(save, 300);

    persist.schedule('value');
    persist.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();

    persist.flush();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('loadEntries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('backfills metadata fields on legacy-shaped entries', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({ e1: makeLegacyEntry() })
    );

    const entries = loadEntries();
    expect(entries.e1.wordCount).toBe(3);
    expect(entries.e1.recordedDurationMs).toBe(0);
    expect(entries.e1.audioTakes).toBe(0);
    expect(entries.e1.draftHistory).toEqual([]);
    expect(entries.e1.name).toBe('First take');
    expect(entries.e1.createdAt).toBe(1000);
  });

  it('preserves already-present metadata fields', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({
        e1: makeLegacyEntry({
          wordCount: 42,
          recordedDurationMs: 9000,
          audioTakes: 2,
          draftHistory: ['old draft'],
        }),
      })
    );

    const entries = loadEntries();
    expect(entries.e1.wordCount).toBe(42);
    expect(entries.e1.recordedDurationMs).toBe(9000);
    expect(entries.e1.audioTakes).toBe(2);
    expect(entries.e1.draftHistory).toEqual(['old draft']);
  });

  it('fills defensive defaults for missing prosody, voiceConfig, and text fields', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({ e1: { id: 'e1' } })
    );

    const entries = loadEntries();
    expect(entries.e1.prosody).toEqual(defaultProsody);
    expect(entries.e1.voiceConfig).toEqual(defaultVoiceConfig);
    expect(entries.e1.name).toBe('Untitled');
    expect(entries.e1.titleSource).toBe('fallback');
    expect(entries.e1.rawTranscript).toBe('');
    expect(entries.e1.refinedText).toBe('');
    expect(entries.e1.parentId).toBeNull();
    expect(entries.e1.wordCount).toBe(0);
  });

  it('returns empty record for corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEYS.entries, 'not json{');
    expect(loadEntries()).toEqual({});
  });
});

describe('saveEntries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes the schema version alongside entries', () => {
    saveEntries({});
    expect(localStorage.getItem(STORAGE_KEYS.schemaVersion)).toBe('3');
    expect(localStorage.getItem(STORAGE_KEYS.entries)).toBe('{}');
  });

  it('does not throw when localStorage is full', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => saveEntries({})).not.toThrow();
    expect(warn).toHaveBeenCalled();

    setItem.mockRestore();
    warn.mockRestore();
  });
});

describe('normalizeEntry', () => {
  it('computes wordCount from rawTranscript when missing', () => {
    const entry = normalizeEntry({ id: 'e1', rawTranscript: 'a b c d' });
    expect(entry.wordCount).toBe(4);
  });
});

describe('schema v3 migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates v2 entries to v3 with kind and name-ordered order', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({
        b: makeLegacyEntry({ id: 'b', name: 'Beta', parentId: 'd1' }),
        a: makeLegacyEntry({ id: 'a', name: 'Alpha', parentId: 'd1' }),
        r: makeLegacyEntry({ id: 'r', name: 'Rootling', parentId: null }),
      })
    );

    const entries = loadEntries();
    expect(entries.a).toMatchObject({ kind: 'writing', order: 0 });
    expect(entries.b).toMatchObject({ kind: 'writing', order: 1 });
    expect(entries.r).toMatchObject({ kind: 'writing', order: 0 });
  });

  it('normalizes unknown kind values to defaults', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({ e1: { ...makeLegacyEntry(), kind: 'zebra' } })
    );
    expect(loadEntries().e1.kind).toBe('writing');
  });

  it('preserves already-present kind, order, and attachment fields', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({
        n1: {
          ...makeLegacyEntry({ id: 'n1' }),
          kind: 'note',
          order: 7,
          attachedToId: 'e9',
          includeInRefinement: false,
        },
      })
    );

    const entries = loadEntries();
    expect(entries.n1.kind).toBe('note');
    expect(entries.n1.order).toBe(7);
    expect(entries.n1.attachedToId).toBe('e9');
    expect(entries.n1.includeInRefinement).toBe(false);
  });

  it('assigns missing order after existing orders within the same parent', () => {
    localStorage.setItem(
      STORAGE_KEYS.entries,
      JSON.stringify({
        kept: { ...makeLegacyEntry({ id: 'kept', name: 'Zulu', parentId: 'd1' }), order: 3 },
        added: makeLegacyEntry({ id: 'added', name: 'Alpha', parentId: 'd1' }),
      })
    );

    const entries = loadEntries();
    expect(entries.kept.order).toBe(3);
    expect(entries.added.order).toBe(4);
  });

  it('backfills directory kind to folder and preserves book', () => {
    localStorage.setItem(
      STORAGE_KEYS.directories,
      JSON.stringify({
        d1: { id: 'd1', name: 'old folder', parentId: null },
        d2: { id: 'd2', name: 'a book', parentId: null, kind: 'book' },
        d3: { id: 'd3', name: 'weird', parentId: null, kind: 'zebra' },
      })
    );

    const dirs = loadDirectories();
    expect(dirs.d1.kind).toBe('folder');
    expect(dirs.d2.kind).toBe('book');
    expect(dirs.d3.kind).toBe('folder');
  });
});
