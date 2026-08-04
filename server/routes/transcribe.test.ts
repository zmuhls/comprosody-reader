import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TranscriptionConfigurationError,
  TranscriptionUpstreamError,
} from '../lib/transcribe.js';
import {
  MAX_KEYTERM_CHARACTERS,
  MAX_TRANSCRIPTION_KEYTERMS,
  createRealtimeTranscriptionTokenHandler,
  handleTranscription,
  parseTranscriptionKeytermHeader,
  parseTranscriptionKeyterms,
} from './transcribe.js';

const originalElevenLabsKey = process.env.ELEVENLABS_API_KEY;

afterEach(() => {
  if (originalElevenLabsKey === undefined) {
    delete process.env.ELEVENLABS_API_KEY;
  } else {
    process.env.ELEVENLABS_API_KEY = originalElevenLabsKey;
  }
});

interface TestResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

async function requestTranscription(
  query: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<TestResponse> {
  const req = Readable.from([Buffer.from('audio')]) as unknown as Request;
  req.query = query as Request['query'];
  req.get = ((name: string) => {
    const normalizedName = name.toLowerCase();
    if (normalizedName === 'content-type') return 'application/octet-stream';
    return headers[normalizedName];
  }) as Request['get'];

  const result: TestResponse = { status: 200, body: undefined };
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    status(code: number) {
      result.status = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  }) as unknown as Response;

  await handleTranscription(req, response);
  return result;
}

async function requestRealtimeToken(
  createToken: Parameters<typeof createRealtimeTranscriptionTokenHandler>[0],
  onRequest?: (request: Request) => void
): Promise<TestResponse> {
  const req = Readable.from([]) as unknown as Request;
  const result: TestResponse = { status: 200, body: undefined, headers: {} };
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    set(name: string, value: string) {
      result.headers![name.toLowerCase()] = value;
      return response;
    },
    status(code: number) {
      result.status = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  }) as unknown as Response;

  const pending = createRealtimeTranscriptionTokenHandler(createToken)(
    req,
    response
  );
  onRequest?.(req);
  await pending;
  return result;
}

describe('transcription keyterm query parsing', () => {
  it('accepts a bounded JSON header without placing vocabulary in the URL', () => {
    expect(
      parseTranscriptionKeyterms(
        parseTranscriptionKeytermHeader(
          JSON.stringify(['Glissant', '  Black   Mountain  ', 'GLISSANT']),
        ),
      ),
    ).toEqual(['Glissant', 'Black Mountain']);

    expect(parseTranscriptionKeytermHeader('not-json')).toEqual([]);
    expect(parseTranscriptionKeytermHeader(JSON.stringify({ term: 'ignored' }))).toEqual([]);
  });

  it('sanitizes repeated values and removes empty or duplicate hints', () => {
    expect(
      parseTranscriptionKeyterms([
        '  Black   Mountain  ',
        'post[human]\\thought',
        'BLACK MOUNTAIN',
        '',
        { nested: 'ignored' },
      ])
    ).toEqual(['Black Mountain', 'posthumanthought']);
  });

  it('caps keyterm words, characters, and total count', () => {
    const characterBounded = parseTranscriptionKeyterms('x'.repeat(80));
    expect(characterBounded).toEqual(['x'.repeat(MAX_KEYTERM_CHARACTERS)]);

    expect(
      parseTranscriptionKeyterms('one two three four five six seven')
    ).toEqual(['one two three four five']);

    const countBounded = parseTranscriptionKeyterms(
      Array.from(
        { length: MAX_TRANSCRIPTION_KEYTERMS + 10 },
        (_, index) => `term ${index}`
      )
    );
    expect(countBounded).toHaveLength(MAX_TRANSCRIPTION_KEYTERMS);
    expect(countBounded.at(-1)).toBe(`term ${MAX_TRANSCRIPTION_KEYTERMS - 1}`);
  });
});

describe('POST /api/transcribe/realtime-token', () => {
  it('returns a bounded single-use token with an explicit no-store policy', async () => {
    let signal: AbortSignal | undefined;
    const response = await requestRealtimeToken(async (options) => {
      signal = options?.signal;
      return 'test-realtime-single-use-token';
    });

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(response).toEqual({
      status: 200,
      body: {
        token: 'test-realtime-single-use-token',
        expiresInSeconds: 900,
      },
      headers: {
        'cache-control': 'private, no-store',
        pragma: 'no-cache',
      },
    });
  });

  it.each([
    {
      error: new TranscriptionConfigurationError(
        'ELEVENLABS_API_KEY is required for realtime transcription'
      ),
      status: 503,
    },
    {
      error: new TranscriptionUpstreamError(
        504,
        'ElevenLabs realtime transcription token service timed out'
      ),
      status: 504,
    },
    {
      error: new TranscriptionUpstreamError(
        401,
        'ElevenLabs realtime transcription token request failed (401)'
      ),
      status: 502,
    },
  ])('maps a safe token error to status $status', async ({ error, status }) => {
    const response = await requestRealtimeToken(async () => {
      throw error;
    });

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ error: error.message });
    expect(response.headers?.['cache-control']).toBe('private, no-store');
  });

  it('does not reflect an unexpected internal error', async () => {
    const response = await requestRealtimeToken(async () => {
      throw new Error('secret internal diagnostic');
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Realtime transcription is unavailable',
    });
  });

  it('aborts upstream token work when the browser request disconnects', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const response = await requestRealtimeToken(
      async (options) => {
        upstreamSignal = options?.signal;
        return await new Promise<string>((_resolve, reject) => {
          upstreamSignal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true }
          );
        });
      },
      (request) => request.emit('aborted')
    );

    expect(upstreamSignal?.aborted).toBe(true);
    expect(response.status).toBe(200);
    expect(response.body).toBeUndefined();
  });
});

describe('POST /api/transcribe provider selection', () => {
  it('rejects an unknown provider with a client error', async () => {
    const response = await requestTranscription({ provider: 'unknown' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Unsupported transcription provider: unknown',
    });
  });

  it('selects ElevenLabs and reports missing server configuration', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const response = await requestTranscription({ provider: 'elevenlabs' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error:
        'ELEVENLABS_API_KEY is required for the ElevenLabs transcription provider',
    });
  });

  it('preserves local model validation', async () => {
    const response = await requestTranscription({
      provider: 'local',
      model: 'not-a-whisper-model',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid model size: not-a-whisper-model',
    });
  });
});
