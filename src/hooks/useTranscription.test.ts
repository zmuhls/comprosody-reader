import {
  buildTranscriptionRequestMetadata,
  MAX_KEYTERMS_HEADER_BYTES,
  MAX_TRANSCRIPTION_KEYTERMS,
  serializeKeytermsHeader,
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
