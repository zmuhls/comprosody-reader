import { describe, expect, it } from 'vitest';
import { appReducer, type AppState } from './AppContext';
import type { Directory, Entry } from '../types/editor';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';

function entry(id: string, updatedAt: number): Entry {
  return {
    id,
    name: id,
    parentId: null,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: updatedAt,
    updatedAt,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    entries: {},
    directories: {},
    activeEntryId: null,
    refinementSettings: {
      genre: 'academic',
      scale: 'sentence',
      temperature: 0.2,
      mode: 'faithful',
      highFidelity: true,
      autoRefine: true,
    },
    errors: [],
    history: [],
    historyIndex: -1,
    ...overrides,
  };
}

describe('workspace hydration', () => {
  it('reopens the most recently updated note when no active note survives', () => {
    const older = entry('older', 10);
    const newer = entry('newer', 20);

    const hydrated = appReducer(state(), {
      type: 'HYDRATE_WORKSPACE',
      entries: { older, newer },
      directories: {},
    });

    expect(hydrated.activeEntryId).toBe('newer');
  });

  it('preserves an active note that exists in the canonical snapshot', () => {
    const active = entry('active', 10);
    const newer = entry('newer', 20);

    const hydrated = appReducer(
      state({ activeEntryId: active.id }),
      {
        type: 'HYDRATE_WORKSPACE',
        entries: { active, newer },
        directories: {},
      },
    );

    expect(hydrated.activeEntryId).toBe('active');
  });
});

describe('workspace organization', () => {
  const directories: Record<string, Directory> = {
    archive: { id: 'archive', name: 'Archive', parentId: null },
    chapter: { id: 'chapter', name: 'Chapter', parentId: 'archive' },
  };

  it('moves a note into a valid directory and records undo history', () => {
    const note = entry('note', 10);
    const moved = appReducer(state({ entries: { note }, directories }), {
      type: 'MOVE_ENTRY',
      id: note.id,
      parentId: 'chapter',
    });

    expect(moved.entries.note.parentId).toBe('chapter');
    expect(moved.history).toHaveLength(2);
  });

  it('rejects missing destinations and directory cycles', () => {
    const note = entry('note', 10);
    const original = state({ entries: { note }, directories });

    expect(
      appReducer(original, {
        type: 'MOVE_ENTRY',
        id: note.id,
        parentId: 'missing',
      }),
    ).toBe(original);
    expect(
      appReducer(original, {
        type: 'MOVE_DIRECTORY',
        id: 'archive',
        parentId: 'chapter',
      }),
    ).toBe(original);
  });

  it('protects a user-renamed note from later automatic titles', () => {
    const note = { ...entry('note', 10), titleSource: 'agent' as const };
    const renamed = appReducer(state({ entries: { note } }), {
      type: 'RENAME_ENTRY',
      id: note.id,
      name: 'My chosen title',
    });

    expect(renamed.entries.note).toMatchObject({
      name: 'My chosen title',
      titleSource: 'manual',
    });
    expect(renamed.entries.note.titleBasis).toBeUndefined();
  });
});
