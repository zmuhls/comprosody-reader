import {
  buildImprovementEventPayload,
  improvementFormFactor,
  recordImprovementEvent,
  wordCount,
} from './improvementMetrics';

describe('privacy-bounded improvement metrics', () => {
  it('derives only a coarse viewport form factor', () => {
    expect(improvementFormFactor(390)).toBe('phone');
    expect(improvementFormFactor(600)).toBe('phone');
    expect(improvementFormFactor(601)).toBe('tablet');
    expect(improvementFormFactor(1_024)).toBe('tablet');
    expect(improvementFormFactor(1_025)).toBe('desktop');
  });

  it('builds operational payloads without text, audio, identity, or voice signatures', () => {
    const payload = buildImprovementEventPayload({
      eventType: 'transcription',
      outcome: 'succeeded',
      provider: 'local',
      durationMs: 1_234.6,
      outputUnits: wordCount('A short transcript without retained content.'),
      audioDurationMs: 9_876.4,
      keytermCount: 7,
    });

    expect(payload).toMatchObject({
      eventType: 'transcription',
      outcome: 'succeeded',
      provider: 'local',
      durationMs: 1_235,
      outputUnits: 6,
      audioDurationMs: 9_876,
      keytermCount: 7,
    });
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(payload)).not.toMatch(
      /rawTranscript|transcriptText|noteText|audioBlob|prompt|vocabulary|pace|energy|fluency|lexical|userId|sessionId|voiceId/i,
    );
  });

  it('runtime-allowlists transcription metrics even if a caller supplies private fields', () => {
    const privateTranscript = 'Unpublished archival interpretation.';
    const payload = buildImprovementEventPayload({
      eventType: 'transcription',
      outcome: 'succeeded',
      provider: 'local',
      outputUnits: wordCount(privateTranscript),
      audioDurationMs: 30_000,
      rawTranscript: privateTranscript,
      audioBlob: new Blob(['private recording bytes']),
      pace: 120,
      lexicalDensity: 0.75,
    } as never);
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      eventType: 'transcription',
      outcome: 'succeeded',
      provider: 'local',
      outputUnits: 3,
      audioDurationMs: 30_000,
    });
    expect(serialized).not.toContain(privateTranscript);
    expect(serialized).not.toContain('private recording bytes');
    expect(serialized).not.toMatch(
      /rawTranscript|audioBlob|pace|lexicalDensity/i,
    );
  });

  it('uses the authenticated same-origin endpoint and never exposes content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const originalBeacon = navigator.sendBeacon;
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: undefined,
    });

    await expect(
      recordImprovementEvent({
        eventType: 'refinement',
        outcome: 'succeeded',
        provider: 'anthropic',
        mode: 'faithful',
        autoTriggered: true,
        durationMs: 900,
        inputUnits: 80,
        outputUnits: 74,
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/improvement-events');
    expect(init.credentials).toBe('same-origin');
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(String(init.body));
    expect(body.events[0]).toMatchObject({
      eventType: 'refinement',
      provider: 'anthropic',
      mode: 'faithful',
      autoTriggered: true,
    });
    expect(body.events[0]).not.toHaveProperty('text');
    expect(body.events[0]).not.toHaveProperty('entryId');

    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: originalBeacon,
    });
    vi.unstubAllGlobals();
  });
});
