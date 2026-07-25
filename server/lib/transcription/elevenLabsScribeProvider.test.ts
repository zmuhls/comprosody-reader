import { describe, expect, it, vi } from 'vitest';
import { TranscriptionConfigurationError } from './types.js';
import { createElevenLabsScribeProvider } from './elevenLabsScribeProvider.js';

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
