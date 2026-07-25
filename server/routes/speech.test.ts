import { EventEmitter } from 'node:events';
import type { Request, Response as ExpressResponse } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SPEECH_TEXT_CHARACTERS,
  createSpeechHandlers,
} from './speech.js';

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

describe('GET /api/speech/voices', () => {
  it('uses ElevenLabs v2 search pagination and normalizes voice metadata', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        voices: [
          {
            voice_id: 'voice-alpha',
            name: 'Alpha',
            category: 'premade',
            labels: {
              accent: 'American',
              age: 'middle-aged',
              ignored: 42,
            },
            description: 'Clear and composed.',
            preview_url: 'https://example.test/alpha.mp3',
            samples: [{ sample_id: 'not-forwarded' }],
          },
          {
            voice_id: 'voice-beta',
            name: 'Beta',
            labels: null,
            description: null,
            preview_url: null,
          },
          { malformed: true },
        ],
        has_more: true,
        next_page_token: 'opaque-token',
        total_count: 250,
      }),
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.listVoices(
      request({
        query: {
          pageSize: '100',
          search: '  academic narrator  ',
          nextPageToken: 'previous-token',
        },
      }),
      res.express,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.elevenlabs.io/v2/voices',
    );
    expect(url.searchParams.get('page_size')).toBe('100');
    expect(url.searchParams.get('search')).toBe('academic narrator');
    expect(url.searchParams.get('next_page_token')).toBe('previous-token');
    expect(new Headers(init.headers).get('xi-api-key')).toBe('server-only-key');

    expect(res.mock.statusCode).toBe(200);
    expect(res.mock.body).toEqual({
      voices: [
        {
          id: 'voice-alpha',
          name: 'Alpha',
          category: 'premade',
          labels: {
            accent: 'American',
            age: 'middle-aged',
          },
          description: 'Clear and composed.',
          previewUrl: 'https://example.test/alpha.mp3',
        },
        {
          id: 'voice-beta',
          name: 'Beta',
          category: null,
          labels: {},
          description: null,
          previewUrl: null,
        },
      ],
      hasMore: true,
      nextPageToken: 'opaque-token',
    });
  });

  it('defaults to a broad page and preserves a terminal null token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ voices: [], has_more: false, next_page_token: null }),
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.listVoices(request(), res.express);

    const [input] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(new URL(String(input)).searchParams.get('page_size')).toBe('100');
    expect(res.mock.body).toEqual({
      voices: [],
      hasMore: false,
      nextPageToken: null,
    });
  });

  it('returns 503 without making an upstream request when unconfigured', async () => {
    const fetchMock = vi.fn();
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => undefined,
    });
    const res = response();

    await handlers.listVoices(request(), res.express);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.mock.statusCode).toBe(503);
    expect(res.mock.body).toEqual({
      error: 'ELEVENLABS_API_KEY is required for ElevenLabs read-aloud',
    });
  });

  it.each(['0', '101', '1.5', 'many'])(
    'rejects invalid pageSize %s',
    async (pageSize) => {
      const fetchMock = vi.fn();
      const handlers = createSpeechHandlers({
        fetchImpl: fetchMock as unknown as typeof fetch,
        getApiKey: () => 'server-only-key',
      });
      const res = response();

      await handlers.listVoices(
        request({ query: { pageSize } }),
        res.express,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.mock.statusCode).toBe(400);
    },
  );
});

describe('POST /api/speech/synthesize', () => {
  it('streams MPEG audio with the long-form model and request speed', async () => {
    const audio = new Uint8Array([73, 68, 51, 4, 5, 6]);
    const fetchMock = vi.fn(async () =>
      new Response(audio, {
        headers: {
          'content-type': 'audio/mpeg',
          'content-length': String(audio.byteLength),
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
          voiceId: 'JBFqnCBsd6RMkjVDRZzb',
          text: 'A sentence for careful listening.',
          speed: 0.85,
        },
      }),
      res.express,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(String(input)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128',
    );
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('xi-api-key')).toBe('server-only-key');
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'A sentence for careful listening.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { speed: 0.85 },
    });

    expect(res.mock.statusCode).toBe(200);
    expect(res.mock.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.mock.headers.get('content-length')).toBe(String(audio.byteLength));
    expect(res.mock.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.concat(res.mock.chunks)).toEqual(Buffer.from(audio));
    expect(res.mock.writableEnded).toBe(true);
  });

  it('defaults speed to 1.0', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1])));
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesize(
      request({
        body: {
          voiceId: 'voice_123',
          text: 'Normal speed.',
        },
      }),
      res.express,
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      voice_settings: { speed: 1 },
    });
  });

  it.each([
    {
      name: 'path-like voice ID',
      body: { voiceId: '../voice', text: 'Hello', speed: 1 },
      error: 'Invalid ElevenLabs voice ID',
    },
    {
      name: 'empty text',
      body: { voiceId: 'voice-id', text: '  ', speed: 1 },
      error: 'Speech text must not be empty',
    },
    {
      name: 'overlong text',
      body: {
        voiceId: 'voice-id',
        text: 'x'.repeat(MAX_SPEECH_TEXT_CHARACTERS + 1),
        speed: 1,
      },
      error: `Speech text must not exceed ${MAX_SPEECH_TEXT_CHARACTERS} characters`,
    },
    {
      name: 'slow speed',
      body: { voiceId: 'voice-id', text: 'Hello', speed: 0.69 },
      error: 'Speech speed must be from 0.7 to 1.2',
    },
    {
      name: 'fast speed',
      body: { voiceId: 'voice-id', text: 'Hello', speed: 1.21 },
      error: 'Speech speed must be from 0.7 to 1.2',
    },
  ])('rejects $name before contacting ElevenLabs', async ({ body, error }) => {
    const fetchMock = vi.fn();
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesize(request({ body }), res.express);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.mock.statusCode).toBe(400);
    expect(res.mock.body).toEqual({ error });
  });

  it('maps an upstream rejection to a value-free gateway error', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ detail: 'account-specific detail' }, 429),
    );
    const handlers = createSpeechHandlers({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'server-only-key',
    });
    const res = response();

    await handlers.synthesize(
      request({
        body: { voiceId: 'voice-id', text: 'Hello', speed: 1.2 },
      }),
      res.express,
    );

    expect(res.mock.statusCode).toBe(502);
    expect(res.mock.body).toEqual({
      error: 'ElevenLabs text-to-speech failed (429)',
    });
  });
});
