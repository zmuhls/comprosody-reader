import { act, renderHook, waitFor } from '@testing-library/react';

const services = vi.hoisted(() => ({
  appDispatch: vi.fn(),
  recordImprovementEvent: vi.fn().mockResolvedValue(true),
  recordingDispatch: vi.fn(),
}));

vi.mock('../context/AppContext', () => ({
  useApp: () => ({ dispatch: services.appDispatch }),
}));
vi.mock('../context/RecordingContext', () => ({
  useRecording: () => ({ dispatch: services.recordingDispatch }),
}));
vi.mock('../lib/improvementMetrics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/improvementMetrics')>()),
  recordImprovementEvent: services.recordImprovementEvent,
}));

import {
  buildTranscriptionRequestMetadata,
  MAX_KEYTERMS_HEADER_BYTES,
  MAX_TRANSCRIPTION_KEYTERMS,
  serializeKeytermsHeader,
  useTranscription,
} from './useTranscription';

describe('serializeKeytermsHeader', () => {
  it('keeps learned vocabulary out of URLs and in bounded JSON header data', () => {
    const values = Array.from(
      { length: MAX_TRANSCRIPTION_KEYTERMS + 20 },
      (_, index) => `term ${index}`,
    );
    const header = serializeKeytermsHeader(values);
    const request = buildTranscriptionRequestMetadata('elevenlabs', values);
    const parsed = JSON.parse(header) as string[];

    expect(parsed).toHaveLength(MAX_TRANSCRIPTION_KEYTERMS);
    expect(header.length).toBeLessThanOrEqual(MAX_KEYTERMS_HEADER_BYTES);
    expect(request.url).toBe('/api/transcribe?provider=elevenlabs');
    expect(request.url).not.toContain('term');
    expect(request.keytermsHeader).toBe(header);
  });

  it('deduplicates, trims, and ASCII-escapes vocabulary safely', () => {
    const header = serializeKeytermsHeader([
      '  prosody  ',
      'prosody',
      'Glissant',
      'créolité',
    ]);

    expect(JSON.parse(header)).toEqual(['prosody', 'Glissant', 'créolité']);
    expect(header).not.toContain('é');
  });
});

describe('useTranscription cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts an in-flight audio request without surfacing a logout error', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );
    const { result } = renderHook(() =>
      useTranscription({ provider: 'elevenlabs' }),
    );
    let request!: Promise<unknown>;

    act(() => {
      request = result.current.transcribe(
        new Blob(['audio'], { type: 'audio/webm' }),
      );
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    });
    await waitFor(() => expect(requestSignal).toBeDefined());
    act(() => result.current.cancel());
    await rejection;

    expect(requestSignal?.aborted).toBe(true);
    expect(services.appDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_ERROR' }),
    );
    expect(services.recordImprovementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'transcription',
        outcome: 'cancelled',
      }),
    );
  });
});
