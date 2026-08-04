import { act, renderHook, waitFor } from '@testing-library/react';

const client = vi.hoisted(() => {
  const listeners = new Map<string, Array<(payload?: unknown) => void>>();
  const connection = {
    close: vi.fn(),
    commit: vi.fn(),
    on: vi.fn(
      (event: string, listener: (payload?: unknown) => void) => {
        const current = listeners.get(event) ?? [];
        current.push(listener);
        listeners.set(event, current);
      },
    ),
    send: vi.fn(),
  };
  return {
    connection,
    emit(event: string, payload?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    listeners,
    scribeConnect: vi.fn(() => connection),
  };
});

const services = vi.hoisted(() => ({
  appDispatch: vi.fn(),
  recordImprovementEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('@elevenlabs/client', () => ({
  AudioFormat: { PCM_16000: 'pcm_16000' },
  CommitStrategy: { MANUAL: 'manual', VAD: 'vad' },
  RealtimeEvents: {
    CLOSE: 'close',
    COMMITTED_TRANSCRIPT: 'committed_transcript',
    ERROR: 'error',
    PARTIAL_TRANSCRIPT: 'partial_transcript',
    SESSION_STARTED: 'session_started',
  },
  Scribe: { connect: client.scribeConnect },
}));

vi.mock('../context/AppContext', () => ({
  useApp: () => ({ dispatch: services.appDispatch }),
}));

vi.mock('../lib/improvementMetrics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/improvementMetrics')>()),
  recordImprovementEvent: services.recordImprovementEvent,
}));

import {
  selectRealtimeKeyterms,
  useRealtimeTranscription,
} from './useRealtimeTranscription';

class FakeAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioWorkletNode extends FakeAudioNode {
  port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null };
}

class FakeAudioContext {
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  destination = new FakeAudioNode();
  close = vi.fn().mockResolvedValue(undefined);
  createGain = vi.fn(() => {
    const node = new FakeAudioNode() as FakeAudioNode & {
      gain: { value: number };
    };
    node.gain = { value: 1 };
    return node;
  });
  createMediaStreamSource = vi.fn(() => new FakeAudioNode());
  resume = vi.fn().mockResolvedValue(undefined);
}

const fakeStream = {} as MediaStream;

describe('selectRealtimeKeyterms', () => {
  it('deduplicates and conforms learned vocabulary to realtime limits', () => {
    const values = [
      '  Glissant  ',
      'glissant',
      'a phrase that is substantially longer than twenty characters',
      ...Array.from({ length: 60 }, (_, index) => `term ${index}`),
    ];

    const selected = selectRealtimeKeyterms(values);
    expect(selected).toHaveLength(50);
    expect(selected[0]).toBe('Glissant');
    expect(selected.every((term) => Array.from(term).length <= 20)).toBe(true);
  });
});

describe('useRealtimeTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.listeners.clear();
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: FakeAudioWorkletNode,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            token: 'single-use-token-that-is-long-enough',
            expiresInSeconds: 900,
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('replaces partial text and finalizes only after a post-stop commit event', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRealtimeTranscription());

    await act(async () => {
      expect(await result.current.start(fakeStream, ['Glissant'])).toBe(true);
    });
    expect(client.scribeConnect).toHaveBeenCalledWith(
      expect.objectContaining({ commitStrategy: 'manual' }),
    );
    act(() => {
      client.emit('session_started', {});
      client.emit('partial_transcript', { text: 'The archive' });
    });
    expect(result.current.liveTranscript).toBe('The archive');

    act(() => {
      client.emit('partial_transcript', {
        text: 'The archive preserves',
      });
      client.emit('committed_transcript', {
        text: 'The archive preserves',
      });
      client.emit('partial_transcript', { text: 'a public memory' });
    });
    expect(result.current.liveTranscript).toBe(
      'The archive preserves a public memory',
    );

    let stopped!: Promise<{
      shouldFallback: boolean;
      transcript: string;
    }>;
    act(() => {
      stopped = result.current.stop();
    });
    await act(async () => {
      await Promise.resolve();
      client.emit('committed_transcript', {
        text: 'a public memory',
      });
    });
    await expect(stopped).resolves.toEqual({
      shouldFallback: false,
      transcript: 'The archive preserves a public memory',
    });
    expect(client.connection.commit).toHaveBeenCalledTimes(1);
  });

  it('falls back when earlier committed text has no post-stop commit event', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRealtimeTranscription());

    await act(async () => {
      expect(await result.current.start(fakeStream, [])).toBe(true);
    });
    act(() => {
      client.emit('session_started', {});
      client.emit('committed_transcript', {
        text: 'An earlier committed segment',
      });
    });

    let stopped!: Promise<{
      shouldFallback: boolean;
      transcript: string;
    }>;
    act(() => {
      stopped = result.current.stop();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    await expect(stopped).resolves.toEqual({
      shouldFallback: true,
      transcript: 'An earlier committed segment',
    });
    expect(client.connection.commit).toHaveBeenCalledTimes(1);
  });

  it('marks a disconnected live session for exactly one final batch fallback', async () => {
    const { result } = renderHook(() => useRealtimeTranscription());
    await act(async () => {
      await result.current.start(fakeStream, []);
    });
    act(() => {
      client.emit('session_started', {});
      client.emit('committed_transcript', { text: 'An early segment' });
      client.emit('error', { error: 'socket interrupted' });
    });

    await waitFor(() => expect(result.current.status).toBe('degraded'));
    await expect(result.current.stop()).resolves.toEqual({
      shouldFallback: true,
      transcript: 'An early segment',
    });
  });
});
