import { defaultProsody } from '../types/audio';
import {
  appendProsodySnapshot,
  appendRecordingTranscript,
  PROSODY_HISTORY_LIMIT,
} from './recordingDocument';

describe('appendRecordingTranscript', () => {
  it('keeps the raw speech record separate from the latest edited document', () => {
    const result = appendRecordingTranscript(
      {
        rawTranscript: 'Original spoken wording.',
        refinedText: 'The writer has substantially revised this paragraph.',
      },
      'A newly dictated thought.',
    );

    expect(result).toEqual({
      rawTranscript: 'Original spoken wording.\n\nA newly dictated thought.',
      documentText:
        'The writer has substantially revised this paragraph.\n\nA newly dictated thought.',
    });
  });

  it('uses the raw transcript as the document base before the first edit', () => {
    const result = appendRecordingTranscript(
      { rawTranscript: 'Existing speech.', refinedText: '' },
      'More speech.',
    );

    expect(result.documentText).toBe('Existing speech.\n\nMore speech.');
    expect(result.rawTranscript).toBe('Existing speech.\n\nMore speech.');
  });
});

describe('appendProsodySnapshot', () => {
  it('retains only the latest bounded set of per-recording metrics', () => {
    const history = Array.from({ length: PROSODY_HISTORY_LIMIT }, (_, index) => ({
      capturedAt: index,
      metrics: { ...defaultProsody, pace: index },
    }));
    const metrics = { ...defaultProsody, pace: 144 };

    const result = appendProsodySnapshot(history, metrics, 10_000);

    expect(result).toHaveLength(PROSODY_HISTORY_LIMIT);
    expect(result[0].capturedAt).toBe(1);
    expect(result.at(-1)).toEqual({ capturedAt: 10_000, metrics });
    expect(result.at(-1)?.metrics).not.toBe(metrics);
  });
});
