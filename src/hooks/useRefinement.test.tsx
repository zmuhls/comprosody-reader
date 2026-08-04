import { act, renderHook, waitFor } from '@testing-library/react';
import type { AppState } from '../context/AppContext';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';
import type { Variant } from '../types/llm';
import { buildVoiceProfile } from '../lib/voiceProfile';

const services = vi.hoisted(() => ({
  generateVariantsApi: vi.fn(),
  streamRefinement: vi.fn(),
  useApp: vi.fn(),
}));

vi.mock('../context/AppContext', () => ({
  useApp: services.useApp,
}));

vi.mock('../lib/refinementApi', () => ({
  generateVariantsApi: services.generateVariantsApi,
  streamRefinement: services.streamRefinement,
}));

import {
  isDocumentRevisionCurrent,
  selectRelevantVocabularyHints,
  useRefinement,
} from './useRefinement';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function makeEntry(id: string, text: string): Entry {
  return {
    id,
    name: `Note ${id}`,
    parentId: null,
    kind: 'note',
    order: 0,
    rawTranscript: '',
    refinedText: text,
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeState(entries: Record<string, Entry>): AppState {
  return {
    entries,
    directories: {},
    activeEntryId: 'a',
    refinementSettings: {
      genre: 'academic',
      scale: 'sentence',
      temperature: 0.2,
      mode: 'faithful',
      highFidelity: true,
    },
    errors: [],
    history: [],
    historyIndex: -1,
    lexicon: {},
  };
}

function installDeferredStream(): Deferred<string> {
  const stream = deferred<string>();
  services.streamRefinement.mockImplementationOnce(async function* () {
    yield await stream.promise;
  });
  return stream;
}

describe('selectRelevantVocabularyHints', () => {
  it('keeps only normalized, whole-term hints present in the request', () => {
    expect(
      selectRelevantVocabularyHints(
        ['Glissant', 'counter-archive', 'art', 'unrelated term'],
        'GLISSANT describes a counter‑archive, not a partial account.',
      ),
    ).toEqual(['Glissant', 'counter-archive']);
  });

  it('deduplicates normalized hints and keeps the request payload tightly bounded', () => {
    const hints = Array.from({ length: 20 }, (_, index) => `Term ${index}`);
    const request = `${hints.join(' ')} TERM 0`;

    expect(selectRelevantVocabularyHints([...hints, 'term 0'], request)).toEqual(
      hints.slice(0, 12),
    );
  });
});

describe('isDocumentRevisionCurrent', () => {
  it('allows an explicit editor or appended-transcript source to settle into state', () => {
    expect(
      isDocumentRevisionCurrent(
        { rawTranscript: 'before', refinedText: 'existing' },
        { rawTranscript: 'before and after', refinedText: 'existing' },
        'before and after',
      ),
    ).toBe(true);
  });

  it('allows auto-refine when both transcript and edited body receive the append', () => {
    expect(
      isDocumentRevisionCurrent(
        { rawTranscript: 'old raw', refinedText: 'edited body' },
        {
          rawTranscript: 'old raw\n\nnew dictation',
          refinedText: 'edited body\n\nnew dictation',
        },
        'edited body\n\nnew dictation',
      ),
    ).toBe(true);
  });

  it('rejects a result when another working representation has a newer edit', () => {
    expect(
      isDocumentRevisionCurrent(
        { rawTranscript: 'source', refinedText: 'existing' },
        { rawTranscript: 'source', refinedText: 'newer writer edit' },
        'source',
      ),
    ).toBe(false);
  });
});

describe('useRefinement async note integrity', () => {
  const variants: Variant[] = [
    { label: 'cool', temperature: 0.2, text: 'Cool result' },
    { label: 'warm', temperature: 0.5, text: 'Warm result' },
    { label: 'hot', temperature: 0.8, text: 'Hot result' },
  ];
  let state: AppState;
  let dispatch: ReturnType<typeof vi.fn>;
  let context: {
    state: AppState;
    dispatch: ReturnType<typeof vi.fn>;
    voiceProfile: ReturnType<typeof buildVoiceProfile>;
    storageReady: boolean;
  };

  beforeEach(() => {
    services.generateVariantsApi.mockReset();
    services.streamRefinement.mockReset();
    services.useApp.mockReset();
    dispatch = vi.fn();
    state = makeState({
      a: makeEntry('a', 'Alpha source'),
      b: makeEntry('b', 'Beta source'),
    });
    context = {
      state,
      dispatch,
      voiceProfile: buildVoiceProfile(state.entries),
      storageReady: true,
    };
    services.useApp.mockImplementation(() => context);
  });

  it('returns no selection result after the active note changes', async () => {
    const stream = installDeferredStream();
    const { result, rerender } = renderHook(() => useRefinement());
    let selectionPromise!: Promise<string | null>;

    act(() => {
      selectionPromise = result.current.refineSelection({
        selection: 'Alpha',
        contextBefore: '',
        contextAfter: 'source',
      });
    });

    context = {
      ...context,
      state: { ...context.state, activeEntryId: 'b' },
    };
    rerender();

    let selectionResult: string | null = 'not resolved';
    await act(async () => {
      stream.resolve('Refined alpha');
      selectionResult = await selectionPromise;
    });

    expect(selectionResult).toBeNull();
    expect(result.current.proposal).toBeNull();
  });

  it('hides variants on switch and refuses a stale accept callback', async () => {
    services.generateVariantsApi.mockResolvedValueOnce({
      variants,
      errors: [],
    });
    const { result, rerender } = renderHook(() => useRefinement());

    await act(async () => {
      await result.current.generateVariants();
    });
    expect(result.current.variants).toEqual(variants);
    const staleAccept = result.current.acceptVariant;

    context = {
      ...context,
      state: { ...context.state, activeEntryId: 'b' },
    };
    rerender();

    expect(result.current.variants).toEqual([]);
    act(() => staleAccept(variants[0]));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('discards variants that arrive after a switch, including after returning', async () => {
    const response = deferred<{ variants: Variant[]; errors: [] }>();
    services.generateVariantsApi.mockReturnValueOnce(response.promise);
    const { result, rerender } = renderHook(() => useRefinement());
    let generationPromise!: Promise<void>;

    act(() => {
      generationPromise = result.current.generateVariants();
    });
    context = {
      ...context,
      state: { ...context.state, activeEntryId: 'b' },
    };
    rerender();

    await act(async () => {
      response.resolve({ variants, errors: [] });
      await generationPromise;
    });

    context = {
      ...context,
      state: { ...context.state, activeEntryId: 'a' },
    };
    rerender();
    expect(result.current.variants).toEqual([]);
  });

  it('does not start variant generation while a refine request is active', async () => {
    const stream = installDeferredStream();
    const { result } = renderHook(() => useRefinement());
    let refinePromise!: Promise<string | null>;

    act(() => {
      refinePromise = result.current.refine();
      void result.current.generateVariants();
    });
    expect(services.generateVariantsApi).not.toHaveBeenCalled();

    await act(async () => {
      stream.resolve('Refined document');
      await refinePromise;
    });
  });

  it('does not overwrite a newer whole-document edit', async () => {
    const stream = installDeferredStream();
    const { result, rerender } = renderHook(() => useRefinement());
    let refinePromise!: Promise<string | null>;

    act(() => {
      refinePromise = result.current.refine();
    });
    context = {
      ...context,
      state: {
        ...context.state,
        entries: {
          ...context.state.entries,
          a: { ...context.state.entries.a, refinedText: 'Newer writer edit' },
        },
      },
    };
    rerender();

    let refineResult: string | null = 'not resolved';
    await act(async () => {
      stream.resolve('Model result');
      refineResult = await refinePromise;
    });

    expect(refineResult).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retries a stale document proposal against the current note text', async () => {
    const firstStream = installDeferredStream();
    const { result, rerender } = renderHook(() => useRefinement());
    let firstRequest!: Promise<string | null>;

    act(() => {
      firstRequest = result.current.refine();
    });
    context = {
      ...context,
      state: {
        ...context.state,
        entries: {
          ...context.state.entries,
          a: {
            ...context.state.entries.a,
            refinedText: 'Current writer revision',
          },
        },
      },
    };
    rerender();
    await act(async () => {
      firstStream.resolve('Stale model proposal');
      await firstRequest;
    });
    expect(result.current.proposal?.status).toBe('stale');

    services.streamRefinement.mockImplementationOnce(async function* () {
      yield 'Current-source proposal';
    });
    await act(async () => {
      await result.current.retryProposal('Repair only the transition.', {
        documentText: 'Current writer revision',
      });
    });

    expect(services.streamRefinement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userMessage: 'Current writer revision',
      }),
    );
    expect(result.current.proposal).toMatchObject({
      sourceText: 'Current writer revision',
      status: 'ready',
      text: 'Current-source proposal',
    });
  });

  it('requires a fresh selection target before retrying a stale selection', async () => {
    const firstStream = installDeferredStream();
    const { result, rerender } = renderHook(() => useRefinement());
    let firstRequest!: Promise<string | null>;

    act(() => {
      firstRequest = result.current.refineSelection({
        contextAfter: ' source',
        contextBefore: '',
        documentText: 'Alpha source',
        from: 1,
        selection: 'Alpha',
        to: 6,
      });
    });
    context = {
      ...context,
      state: {
        ...context.state,
        entries: {
          ...context.state.entries,
          a: {
            ...context.state.entries.a,
            refinedText: 'Rewritten Alpha source',
          },
        },
      },
    };
    rerender();
    await act(async () => {
      firstStream.resolve('Refined alpha');
      await firstRequest;
    });

    await act(async () => {
      expect(
        await result.current.retryProposal('Try the selected phrase again.', {
          documentText: 'Rewritten Alpha source',
        }),
      ).toBeNull();
    });
    expect(services.streamRefinement).toHaveBeenCalledTimes(1);
  });

  it('proposes an appended-source edit and commits it only after acceptance', async () => {
    state = makeState({
      a: {
        ...makeEntry('a', 'Existing refinement'),
        rawTranscript: 'Earlier transcript',
      },
      b: makeEntry('b', 'Beta source'),
    });
    context = {
      ...context,
      state,
      voiceProfile: buildVoiceProfile(state.entries),
    };
    const stream = installDeferredStream();
    const { result, rerender } = renderHook(() => useRefinement());
    let refinePromise!: Promise<string | null>;

    act(() => {
      refinePromise = result.current.refine({
        entryId: 'a',
        sourceText: 'Earlier transcript\n\nAppended thought',
      });
    });
    context = {
      ...context,
      state: {
        ...context.state,
        entries: {
          ...context.state.entries,
          a: {
            ...context.state.entries.a,
            rawTranscript: 'Earlier transcript\n\nAppended thought',
          },
        },
      },
    };
    rerender();

    await act(async () => {
      stream.resolve('Refined appended thought');
      await refinePromise;
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.proposal).toMatchObject({
      status: 'ready',
      text: 'Refined appended thought',
    });
    act(() => {
      expect(result.current.acceptProposal()).toBe(true);
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_ENTRY',
      id: 'a',
      updates: { refinedText: 'Refined appended thought' },
      recordHistory: true,
    });
  });

  it('publishes incremental proposal text without mutating the note', async () => {
    const remainder = deferred<string>();
    services.streamRefinement.mockImplementationOnce(async function* () {
      yield 'A connected';
      yield await remainder.promise;
    });
    const { result } = renderHook(() => useRefinement());
    let refinePromise!: Promise<string | null>;

    act(() => {
      refinePromise = result.current.refine();
    });

    await waitFor(() =>
      expect(result.current.proposal).toMatchObject({
        status: 'streaming',
        text: 'A connected',
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();

    await act(async () => {
      remainder.resolve(' argument.');
      await refinePromise;
    });

    expect(result.current.proposal).toMatchObject({
      status: 'ready',
      text: 'A connected argument.',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects without mutation and retries from the trusted source with guidance', async () => {
    services.streamRefinement
      .mockImplementationOnce(async function* () {
        yield 'Overwritten voice';
      })
      .mockImplementationOnce(async function* () {
        yield 'Voice-preserving revision';
      });
    const { result } = renderHook(() => useRefinement());

    await act(async () => {
      await result.current.refine({ instruction: 'Tighten this.' });
    });
    act(() => {
      expect(result.current.rejectProposal()).toBe(true);
    });
    expect(result.current.proposal?.status).toBe('rejected');
    expect(dispatch).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retryProposal(
        'Keep the opening and revise only the transition.',
      );
    });

    expect(result.current.proposal).toMatchObject({
      status: 'ready',
      text: 'Voice-preserving revision',
    });
    expect(services.streamRefinement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userMessage: 'Alpha source',
        systemPrompt: expect.stringContaining(
          'Keep the opening and revise only the transition.',
        ),
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});
