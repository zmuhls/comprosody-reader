import {
  createDebouncedPersist,
  loadEntries,
  saveEntries,
  normalizeEntry,
} from './storage';
import { STORAGE_KEYS } from '../constants';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';

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
    expect(entries.e1.name).toBe('');
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
    expect(localStorage.getItem(STORAGE_KEYS.schemaVersion)).toBe('2');
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
