import { act, renderHook } from '@testing-library/react';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  refineComplete: vi.fn(),
}));

vi.mock('../context/AppContext', () => ({
  useApp: () => ({ dispatch: mocks.dispatch, storageReady: true }),
}));

vi.mock('../lib/refinementApi', () => ({
  refineComplete: mocks.refineComplete,
}));

import { useAutomaticNoteTitle } from './useAutomaticNoteTitle';
import { noteTitleBasis } from '../lib/noteTitle';

function note(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'note-1',
    name: 'Untitled',
    titleSource: 'fallback',
    parentId: null,
    rawTranscript: '',
    refinedText: 'Archival absence reshapes how public memory returns.',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('useAutomaticNoteTitle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.dispatch.mockReset();
    mocks.refineComplete.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets a local fallback, then replaces it with a background agent title', async () => {
    mocks.refineComplete.mockResolvedValue('Archival Absence and Public Memory');
    const source = note().refinedText;
    const { result } = renderHook(() => useAutomaticNoteTitle(note()));

    await act(async () => {
      vi.advanceTimersByTime(1_200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, {
      type: 'UPDATE_ENTRY',
      id: 'note-1',
      updates: {
        name: 'Archival absence reshapes how public memory returns',
        titleSource: 'fallback',
        titleBasis: noteTitleBasis(source),
      },
      recordHistory: false,
    });
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'UPDATE_ENTRY',
      id: 'note-1',
      updates: {
        name: 'Archival Absence and Public Memory',
        titleSource: 'agent',
        titleBasis: noteTitleBasis(source),
      },
      recordHistory: false,
    });
    expect(result.current).toBe('suggested');
  });

  it('does not send manually titled notes to the background agent', () => {
    renderHook(() => useAutomaticNoteTitle(note({
      name: 'My chosen title',
      titleSource: 'manual',
    })));
    act(() => vi.advanceTimersByTime(2_000));
    expect(mocks.refineComplete).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('settles on the local fallback when the title request times out', async () => {
    mocks.refineComplete.mockImplementation(({ signal }: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      })
    ));
    const { result } = renderHook(() => useAutomaticNoteTitle(note()));

    await act(async () => {
      vi.advanceTimersByTime(1_200);
      await Promise.resolve();
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBe('fallback');
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });
});
