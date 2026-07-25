import { describe, expect, it } from 'vitest';
import { appReducer, type AppState } from './AppContext';
import type { Entry } from '../types/editor';
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
