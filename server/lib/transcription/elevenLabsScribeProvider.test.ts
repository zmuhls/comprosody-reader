import { describe, expect, it, vi } from 'vitest';
import { TranscriptionConfigurationError } from './types.js';
import {
  createElevenLabsRealtimeTokenClient,
  createElevenLabsScribeProvider,
} from './elevenLabsScribeProvider.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ElevenLabs Scribe provider', () => {
  it('sends the documented multipart request and normalizes word timestamps', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        language_code: 'en',
        text: 'Hello world!',
        words: [
          { text: 'Hello', start: 0.1234, end: 0.5678, type: 'word' },
          { text: ' ', start: 0.5678, end: 0.7, type: 'spacing' },
          { text: 'world!', start: 0.7, end: 1.23456, type: 'word' },
          { text: '(door)', start: 1.235, end: 1.5, type: 'audio_event' },
        ],
      })
    );
    const provider = createElevenLabsScribeProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'test-api-key',
    });

    const result = await provider.transcribe({
      audioBuffer: Buffer.from('webm audio bytes'),
      contentType: 'application/octet-stream',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('xi-api-key')).toBe('test-api-key');
    expect(headers.has('content-type')).toBe(false);

    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('timestamps_granularity')).toBe('word');
    expect(form.get('no_verbatim')).toBe('false');
    const file = form.get('file');
    expect(typeof file).not.toBe('string');
    expect(file).not.toBeNull();
    expect((file as File).name).toBe('recording.webm');
    expect((file as File).type).toBe('audio/webm');
    expect(await (file as File).text()).toBe('webm audio bytes');

    expect(result).toEqual({
      transcript: 'Hello world!',
      words: [
        { word: 'Hello', start: 0.123, end: 0.568 },
        { word: 'world!', start: 0.7, end: 1.235 },
      ],
      language: 'en',
      duration: 1.5,
    });
  });

  it('allows the request model to override the configured default', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ language_code: 'en', text: '', words: [] })
    );
    const provider = createElevenLabsScribeProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'test-api-key',
      getDefaultModel: () => 'configured-model',
    });

    await provider.transcribe({
      audioBuffer: Buffer.from('audio'),
      model: 'request-model',
      contentType: 'audio/wav',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('request-model');
    const file = form.get('file') as File;
    expect(file.name).toBe('recording.wav');
    expect(file.type).toBe('audio/wav');
  });

  it('sends vocabulary hints as repeated keyterms fields', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ language_code: 'en', text: '', words: [] })
    );
    const provider = createElevenLabsScribeProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'test-api-key',
    });

    await provider.transcribe({
      audioBuffer: Buffer.from('audio'),
      keyterms: ['Comprosody', 'Black Mountain College'],
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.getAll('keyterms')).toEqual([
      'Comprosody',
      'Black Mountain College',
    ]);
  });

  it('fails before making a request when the API key is absent', async () => {
    const fetchMock = vi.fn();
    const provider = createElevenLabsScribeProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => undefined,
    });

    await expect(
      provider.transcribe({ audioBuffer: Buffer.from('audio') })
    ).rejects.toBeInstanceOf(TranscriptionConfigurationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a concise upstream API error', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ detail: { message: 'Invalid API key' } }, 401)
    );
    const provider = createElevenLabsScribeProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'bad-key',
    });

    await expect(
      provider.transcribe({ audioBuffer: Buffer.from('audio') })
    ).rejects.toMatchObject({
      status: 401,
      message: 'ElevenLabs transcription failed (401): Invalid API key',
    });
  });

  it('rejects a malformed successful response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: 'Missing words' }));
    const provider = createElevenLabsScribeProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'test-api-key',
    });

    await expect(
      provider.transcribe({ audioBuffer: Buffer.from('audio') })
    ).rejects.toMatchObject({
      status: 502,
      message: 'ElevenLabs returned an invalid transcription response',
    });
  });
});

describe('ElevenLabs realtime Scribe token client', () => {
  it('mints a single-use realtime_scribe token without exposing the API key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ token: 'test-realtime-single-use-token' })
    );
    const client = createElevenLabsRealtimeTokenClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-api-key',
    });

    await expect(client.createToken()).resolves.toBe(
      'test-realtime-single-use-token'
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
    );
    expect(init).toMatchObject({ method: 'POST' });
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('xi-api-key')).toBe('server-only-api-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails before making a request when realtime transcription is unconfigured', async () => {
    const fetchMock = vi.fn();
    const client = createElevenLabsRealtimeTokenClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => undefined,
    });

    await expect(client.createToken()).rejects.toMatchObject({
      name: 'TranscriptionConfigurationError',
      message: 'ELEVENLABS_API_KEY is required for realtime transcription',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { token: '' },
    { token: 'short' },
    { token: `token with whitespace ${'x'.repeat(20)}` },
    { token: 'x'.repeat(8_193) },
  ])('rejects an invalid successful token response', async (body) => {
    const fetchMock = vi.fn(async () => jsonResponse(body));
    const client = createElevenLabsRealtimeTokenClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-api-key',
    });

    await expect(client.createToken()).rejects.toMatchObject({
      status: 502,
      message: 'ElevenLabs returned an invalid realtime transcription token',
    });
  });

  it('does not reflect upstream response details or transport errors', async () => {
    const upstreamDetail = 'secret-upstream-diagnostic';
    const responseClient = createElevenLabsRealtimeTokenClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ detail: upstreamDetail }, 401)
      ) as unknown as typeof fetch,
      getApiKey: () => 'server-only-api-key',
    });
    await expect(responseClient.createToken()).rejects.toMatchObject({
      status: 401,
      message: 'ElevenLabs realtime transcription token request failed (401)',
    });

    const transportClient = createElevenLabsRealtimeTokenClient({
      fetchImpl: vi.fn(async () => {
        throw new Error(upstreamDetail);
      }) as unknown as typeof fetch,
      getApiKey: () => 'server-only-api-key',
    });
    await expect(transportClient.createToken()).rejects.toMatchObject({
      status: 502,
      message:
        'Could not reach ElevenLabs realtime transcription token service',
    });
  });

  it('aborts a token request at the configured deadline', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }
    );
    const client = createElevenLabsRealtimeTokenClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-api-key',
      timeoutMs: 5,
    });

    await expect(client.createToken()).rejects.toMatchObject({
      status: 504,
      message:
        'ElevenLabs realtime transcription token service timed out',
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('links caller cancellation to the upstream request', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true }
          );
        });
      }
    );
    const client = createElevenLabsRealtimeTokenClient({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-api-key',
    });
    const controller = new AbortController();
    const request = client.createToken({ signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      status: 499,
      message: 'Realtime transcription token request was cancelled',
    });
    expect(requestSignal?.aborted).toBe(true);
  });
});
