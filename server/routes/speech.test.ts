import { EventEmitter } from 'node:events';
import type { Request, Response as ExpressResponse } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SPEECH_AUDIO_BYTES,
  MAX_SPEECH_TEXT_CHARACTERS,
  createSpeechHandlers,
} from './speech.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

class MockResponse extends EventEmitter {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();
  chunks: Buffer[] = [];
  headersSent = false;
  writableEnded = false;
  destroyedWith: Error | undefined;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: number | string): this {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    this.headersSent = true;
    this.writableEnded = true;
    return this;
  }

  write(chunk: Uint8Array): boolean {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(): this {
    this.writableEnded = true;
    return this;
  }

  destroy(error?: Error): this {
    this.destroyedWith = error;
    this.writableEnded = true;
    return this;
  }
}

function request(
  options: {
    query?: Record<string, unknown>;
    body?: unknown;
  } = {},
): Request {
  const req = new EventEmitter() as unknown as Request;
  req.query = (options.query ?? {}) as Request['query'];
  req.body = options.body;
  return req;
}

function response(): {
  express: ExpressResponse;
  mock: MockResponse;
} {
  const mock = new MockResponse();
  return {
    express: mock as unknown as ExpressResponse,
    mock,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function alignment(text: string): {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
} {
  const characters = Array.from(text);
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index / 10),
    character_end_times_seconds: characters.map((_, index) => (index + 1) / 10),
  };
}

function timedUpstream(text: string): Record<string, unknown> {
  return {
    audio_base64: Buffer.from([0x49, 0x44, 0x33, 0x04]).toString('base64'),
    alignment: alignment(text),
    normalized_alignment: alignment(text.toLocaleUpperCase()),
    request_id: 'must-not-be-forwarded',
    provider_metadata: { account: 'must-not-be-forwarded' },
  };
}

describe('GET /api/speech/voices', () => {
  it('uses server-only auth and returns only normalized voice metadata', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        voices: [
          {
            voice_id: 'voice-alpha',
            name: 'Alpha',
            category: 'premade',
            labels: { accent: 'American', ignored: 42 },
            description: 'Clear and composed.',
            preview_url: 'https://example.test/alpha.mp3',
            samples: [{ sample_id: 'not-forwarded' }],
          },
        ],
        has_more: false,
        next_page_token: null,
        account_id: 'not-forwarded',
      }),
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.listVoices(
      request({ query: { pageSize: '25', search: '  clear  ' } }),
      res.express,
    );

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.elevenlabs.io/v2/voices',
    );
    expect(url.searchParams.get('page_size')).toBe('25');
    expect(url.searchParams.get('search')).toBe('clear');
    expect(new Headers(init.headers).get('xi-api-key')).toBe('server-only-key');
    expect(res.mock.body).toEqual({
      voices: [
        {
          id: 'voice-alpha',
          name: 'Alpha',
          category: 'premade',
          labels: { accent: 'American' },
          description: 'Clear and composed.',
          previewUrl: 'https://example.test/alpha.mp3',
        },
      ],
      hasMore: false,
      nextPageToken: null,
    });
  });

  it('maps a stalled voice provider to 504 at the shared deadline', async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    let rejectProvider: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        providerSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          rejectProvider = reject;
          providerSignal?.addEventListener(
            'abort',
            () => reject(providerSignal?.reason),
            { once: true },
          );
        });
      },
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
      providerTimeoutMs: 25,
    });
    const res = response();

    const pending = handlers.listVoices(request(), res.express);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    const observedDeadline = providerSignal?.aborted === true;
    if (!observedDeadline) {
      rejectProvider?.(new Error('test cleanup: voice provider was not aborted'));
    }
    await pending;

    expect(observedDeadline).toBe(true);
    expect(res.mock.statusCode).toBe(504);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs voice service timed out',
    });
  });

  it('aborts a stalled voice provider when the client disconnects', async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    let rejectProvider: ((reason?: unknown) => void) | undefined;
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        providerSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          rejectProvider = reject;
          providerSignal?.addEventListener(
            'abort',
            () => reject(providerSignal?.reason),
            { once: true },
          );
        });
      },
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
      providerTimeoutMs: 60_000,
    });
    const req = request();
    const res = response();

    const pending = handlers.listVoices(req, res.express);
    await Promise.resolve();
    (req as unknown as EventEmitter).emit('aborted');
    const observedClientAbort = providerSignal?.aborted === true;
    if (!observedClientAbort) {
      rejectProvider?.(new Error('test cleanup: voice provider was not aborted'));
    }
    await pending;

    expect(observedClientAbort).toBe(true);
    expect(res.mock.headersSent).toBe(false);
    expect(res.mock.writableEnded).toBe(false);
  });
});

describe('POST /api/speech/synthesize', () => {
  it('retains the existing raw MPEG streaming contract', async () => {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x05, 0x06]);
    const fetchMock = vi.fn(async () =>
      new Response(audio, {
        headers: { 'content-length': String(audio.byteLength) },
      }),
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesize(
      request({
        body: {
          voiceId: 'JBFqnCBsd6RMkjVDRZzb',
          text: 'A sentence for careful listening.',
          speed: 0.85,
        },
      }),
      res.express,
    );

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(String(input)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'A sentence for careful listening.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { speed: 0.85 },
    });
    expect(new Headers(init.headers).get('xi-api-key')).toBe('server-only-key');
    expect(res.mock.statusCode).toBe(200);
    expect(res.mock.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.mock.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.concat(res.mock.chunks)).toEqual(Buffer.from(audio));
  });

  it('rejects an oversized declared audio length before sending audio headers or bytes', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([0x49, 0x44, 0x33]), {
        headers: {
          'content-length': String(MAX_SPEECH_AUDIO_BYTES + 1),
        },
      }),
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesize(
      request({
        body: {
          voiceId: 'voice_1',
          text: 'Reject oversized declared audio.',
          speed: 1,
        },
      }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(502);
    expect(res.mock.headers.has('content-type')).toBe(false);
    expect(res.mock.headers.has('content-length')).toBe(false);
    expect(res.mock.chunks).toHaveLength(0);
    expect(res.mock.destroyedWith).toBeUndefined();
    expect(res.mock.body).toEqual({
      error: expect.stringMatching(/audio/iu),
    });
  });

  it('terminates chunked audio before writing beyond the 25 MiB ceiling', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_SPEECH_AUDIO_BYTES));
        controller.enqueue(new Uint8Array([0x00]));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream));
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesize(
      request({
        body: {
          voiceId: 'voice_1',
          text: 'Bound the chunked audio stream.',
          speed: 1,
        },
      }),
      res.express,
    );

    const writtenBytes = res.mock.chunks.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    );
    expect(res.mock.headers.has('content-length')).toBe(false);
    expect(writtenBytes).toBeLessThanOrEqual(MAX_SPEECH_AUDIO_BYTES);
    expect(res.mock.destroyedWith).toBeInstanceOf(Error);
    expect(res.mock.destroyedWith?.message).toMatch(/audio/iu);
  });
});

describe('POST /api/speech/synthesize-with-timestamps', () => {
  it('returns a versioned, whitelisted timed speech response', async () => {
    const text = 'One sentence. Then another.';
    const fetchMock = vi.fn(async () => jsonResponse(timedUpstream(text)));
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({
        body: {
          voiceId: 'voice_123',
          text,
          speed: 1.1,
        },
      }),
      res.express,
    );

    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(String(input)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice_123/with-timestamps?output_format=mp3_44100_128',
    );
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('xi-api-key')).toBe('server-only-key');
    expect(JSON.parse(String(init.body))).toEqual({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { speed: 1.1 },
    });

    expect(res.mock.statusCode).toBe(200);
    expect(res.mock.headers.get('cache-control')).toBe('no-store');
    expect(res.mock.body).toEqual({
      schemaVersion: 1,
      mediaType: 'audio/mpeg',
      audioBase64: Buffer.from([0x49, 0x44, 0x33, 0x04]).toString('base64'),
      alignment: {
        characters: Array.from(text),
        startTimesSeconds: Array.from(text).map((_, index) => index / 10),
        endTimesSeconds: Array.from(text).map((_, index) => (index + 1) / 10),
      },
      normalizedAlignment: {
        characters: Array.from(text.toLocaleUpperCase()),
        startTimesSeconds: Array.from(text).map((_, index) => index / 10),
        endTimesSeconds: Array.from(text).map((_, index) => (index + 1) / 10),
      },
    });
    expect(JSON.stringify(res.mock.body)).not.toMatch(
      /request_id|provider_metadata|account/iu,
    );
  });

  it('accepts a null normalized alignment while requiring original alignment', async () => {
    const text = 'Original alignment.';
    const upstream = timedUpstream(text);
    upstream.normalized_alignment = null;
    const handlers = createSpeechHandlers({
      fetchImpl: vi.fn(async () => jsonResponse(upstream)),
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({ body: { voiceId: 'voice_1', text } }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(200);
    expect(res.mock.body).toMatchObject({ normalizedAlignment: null });
  });

  it.each([
    {
      name: 'missing original alignment',
      mutate: (body: Record<string, unknown>) => {
        body.alignment = null;
      },
    },
    {
      name: 'characters that do not reproduce the request text',
      mutate: (body: Record<string, unknown>) => {
        body.alignment = alignment('Different text.');
      },
    },
    {
      name: 'mismatched timing lengths',
      mutate: (body: Record<string, unknown>) => {
        const value = alignment('Aligned text.');
        value.character_end_times_seconds.pop();
        body.alignment = value;
      },
    },
    {
      name: 'non-monotonic timing',
      mutate: (body: Record<string, unknown>) => {
        const value = alignment('Aligned text.');
        value.character_start_times_seconds[2] = 0;
        body.alignment = value;
      },
    },
    {
      name: 'invalid base64 audio',
      mutate: (body: Record<string, unknown>) => {
        body.audio_base64 = 'not base64';
      },
    },
    {
      name: 'malformed normalized alignment',
      mutate: (body: Record<string, unknown>) => {
        body.normalized_alignment = { characters: ['x'] };
      },
    },
  ])('rejects $name without forwarding upstream details', async ({ mutate }) => {
    const text = 'Aligned text.';
    const upstream = timedUpstream(text);
    mutate(upstream);
    const handlers = createSpeechHandlers({
      fetchImpl: vi.fn(async () => jsonResponse(upstream)),
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({ body: { voiceId: 'voice_1', text, speed: 1 } }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(502);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs returned an invalid timed speech response',
    });
  });

  it('rejects bad inputs before contacting ElevenLabs', async () => {
    const fetchMock = vi.fn();
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock,
      getApiKey: () => 'server-only-key',
    });

    for (const body of [
      { voiceId: '../voice', text: 'Hello', speed: 1 },
      { voiceId: 'voice_1', text: ' ', speed: 1 },
      {
        voiceId: 'voice_1',
        text: 'x'.repeat(MAX_SPEECH_TEXT_CHARACTERS + 1),
        speed: 1,
      },
      { voiceId: 'voice_1', text: 'Hello', speed: 1.21 },
    ]) {
      const res = response();
      await handlers.synthesizeWithTimestamps(
        request({ body }),
        res.express,
      );
      expect(res.mock.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires configuration without exposing or contacting the provider', async () => {
    const fetchMock = vi.fn();
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock,
      getApiKey: () => undefined,
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({ body: { voiceId: 'voice_1', text: 'Hello.' } }),
      res.express,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.mock.statusCode).toBe(503);
    expect(res.mock.body).toEqual({
      error: 'ELEVENLABS_API_KEY is required for ElevenLabs read-aloud',
    });
  });

  it('maps upstream failures to a value-free gateway error', async () => {
    const handlers = createSpeechHandlers({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            detail: 'account-specific detail',
            apiKeyFragment: 'must-not-be-forwarded',
          },
          429,
        ),
      ),
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({ body: { voiceId: 'voice_1', text: 'Hello.' } }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(502);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs timed text-to-speech failed (429)',
    });
  });

  it('maps a timed provider deadline to 504 without logging private input', async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let providerSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        providerSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          providerSignal?.addEventListener(
            'abort',
            () => reject(providerSignal?.reason),
            { once: true },
          );
        });
      },
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'private-elevenlabs-key',
      providerTimeoutMs: 25,
    });
    const res = response();

    const pending = handlers.synthesizeWithTimestamps(
      request({
        body: {
          voiceId: 'private-voice-id',
          text: 'Private note text must never reach a diagnostic log.',
          speed: 1,
        },
      }),
      res.express,
    );
    await vi.advanceTimersByTimeAsync(25);
    await pending;

    expect(providerSignal?.aborted).toBe(true);
    expect(res.mock.statusCode).toBe(504);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs timed text-to-speech service timed out',
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(JSON.stringify(res.mock.body)).not.toMatch(
      /private note|private-voice-id|private-elevenlabs-key/iu,
    );
  });

  it('keeps the shared deadline active while a timed response body stalls', async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        providerSignal = init?.signal ?? undefined;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              providerSignal?.addEventListener(
                'abort',
                () => reject(providerSignal?.reason),
                { once: true },
              );
            }),
        } as Response;
      },
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
      providerTimeoutMs: 25,
    });
    const res = response();

    const pending = handlers.synthesizeWithTimestamps(
      request({
        body: {
          voiceId: 'voice_1',
          text: 'Provider headers arrived, but the response body stalled.',
          speed: 1,
        },
      }),
      res.express,
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    await pending;

    expect(providerSignal?.aborted).toBe(true);
    expect(res.mock.statusCode).toBe(504);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs timed text-to-speech service timed out',
    });
  });

  it('logs only bounded metadata for an unexpected timed-response error', async () => {
    const privateText = 'Private note text must never enter diagnostics.';
    const privateVoiceId = 'private-voice-id';
    const privateApiKey = 'private-elevenlabs-key';
    const privateProviderBody = '{"audio_base64":"private-provider-body"}';
    const unexpected = Object.assign(
      new Error(`Parse failed for ${privateText}`),
      {
        name: 'ProviderParserError',
        code: 'E_PROVIDER_PARSE',
        cause: Object.assign(new Error(privateProviderBody), {
          name: 'ProviderSyntaxError',
          code: 'E_PROVIDER_SHAPE',
        }),
        providerBody: privateProviderBody,
      },
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handlers = createSpeechHandlers({
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: () => {
          throw unexpected;
        },
      }) as unknown as Response),
      getApiKey: () => privateApiKey,
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({
        body: {
          voiceId: privateVoiceId,
          text: privateText,
          speed: 1,
        },
      }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(500);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs read-aloud request failed',
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0]?.[0]).toBe('[speech-route-error]');
    const serializedMetadata = errorLog.mock.calls[0]?.[1];
    expect(typeof serializedMetadata).toBe('string');
    const metadata = JSON.parse(String(serializedMetadata)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(metadata).sort()).toEqual([
      'causeClass',
      'causeCode',
      'durationMs',
      'errorClass',
      'errorCode',
      'event',
      'inputCharacters',
      'operation',
      'phase',
    ]);
    expect(metadata).toMatchObject({
      event: 'speech_route_error',
      operation: 'synthesize_with_timestamps',
      phase: 'provider_parse',
      inputCharacters: Array.from(privateText).length,
      errorClass: 'ProviderParserError',
      errorCode: 'E_PROVIDER_PARSE',
      causeClass: 'ProviderSyntaxError',
      causeCode: 'E_PROVIDER_SHAPE',
    });
    expect(metadata.durationMs).toEqual(expect.any(Number));

    const diagnosticOutput = errorLog.mock.calls.flat().join(' ');
    const publicResponse = JSON.stringify(res.mock.body);
    for (const privateValue of [
      privateText,
      privateVoiceId,
      privateApiKey,
      privateProviderBody,
      unexpected.message,
      unexpected.stack ?? '',
    ]) {
      if (!privateValue) continue;
      expect(diagnosticOutput).not.toContain(privateValue);
      expect(publicResponse).not.toContain(privateValue);
    }
  });

  it('enforces the 25 MiB timed-audio ceiling before decoding provider audio', async () => {
    expect(MAX_SPEECH_AUDIO_BYTES).toBe(25 * 1024 * 1024);
    const maximumBase64Length =
      Math.ceil(MAX_SPEECH_AUDIO_BYTES / 3) * 4;
    const oversizedAudioBase64 = 'A'.repeat(maximumBase64Length + 4);
    const text = 'Bounded audio.';
    const upstream = timedUpstream(text);
    upstream.audio_base64 = oversizedAudioBase64;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handlers = createSpeechHandlers({
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => upstream,
      }) as unknown as Response),
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesizeWithTimestamps(
      request({ body: { voiceId: 'voice_1', text, speed: 1 } }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(502);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs returned an invalid timed speech response',
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('aborts the provider request when the browser disconnects', async () => {
    let providerSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) => {
        providerSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          providerSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const req = request({
      body: { voiceId: 'voice_1', text: 'Disconnect safely.' },
    });
    const res = response();

    const pending = handlers.synthesizeWithTimestamps(req, res.express);
    await Promise.resolve();
    (req as unknown as EventEmitter).emit('aborted');
    await pending;

    expect(providerSignal?.aborted).toBe(true);
    expect(res.mock.headersSent).toBe(false);
    expect(res.mock.writableEnded).toBe(false);
  });
});
