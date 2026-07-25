import {
  fetchSpeechVoices,
  synthesizeSpeech,
} from './speechApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchSpeechVoices', () => {
  it('requests a large searchable page without sending credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          voices: [
            {
              id: 'voice-1',
              name: 'Narrator',
              category: 'premade',
              labels: { accent: 'American' },
              description: null,
              previewUrl: null,
            },
          ],
          hasMore: true,
          nextPageToken: 'next-page',
        }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSpeechVoices({
      pageSize: 100,
      search: 'narrative',
    });

    expect(result.voices[0]?.name).toBe('Narrator');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/speech/voices?pageSize=100&search=narrative',
      {
        headers: { Accept: 'application/json' },
        signal: undefined,
      },
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('xi-api-key');
  });

  it('preserves the server error rather than hiding missing configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'ELEVENLABS_API_KEY is required for ElevenLabs read-aloud',
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 503,
          },
        ),
      ),
    );

    await expect(fetchSpeechVoices()).rejects.toThrow(
      'ELEVENLABS_API_KEY is required',
    );
  });
});

describe('synthesizeSpeech', () => {
  it('sends only the voice choice, text, and generation speed to Cadence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new TextEncoder().encode('audio'), {
        headers: { 'Content-Type': 'audio/mpeg' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await synthesizeSpeech({
      voiceId: 'voice-1',
      text: 'Read this thought.',
      speed: 0.85,
    });

    expect(result.type).toBe('audio/mpeg');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/speech/synthesize',
      expect.objectContaining({
        body: JSON.stringify({
          voiceId: 'voice-1',
          text: 'Read this thought.',
          speed: 0.85,
        }),
        method: 'POST',
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      voiceId: 'voice-1',
      text: 'Read this thought.',
      speed: 0.85,
    });
  });
});
