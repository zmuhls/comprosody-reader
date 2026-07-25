import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_KEYTERM_CHARACTERS,
  MAX_TRANSCRIPTION_KEYTERMS,
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
  const response = {
    status(code: number) {
      result.status = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  } as unknown as Response;

  await handleTranscription(req, response);
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
