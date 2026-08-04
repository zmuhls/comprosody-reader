import {
  DEFAULT_BACKGROUND_RECORDING_LIMIT_MS,
  formatBackgroundRecordingLimit,
  normalizeBackgroundRecordingLimit,
} from './backgroundRecording';

describe('background recording limits', () => {
  it('accepts only the bounded choices exposed by the recording dock', () => {
    expect(normalizeBackgroundRecordingLimit('30000')).toBe(30_000);
    expect(normalizeBackgroundRecordingLimit(300_000)).toBe(300_000);
    expect(normalizeBackgroundRecordingLimit('999999')).toBe(
      DEFAULT_BACKGROUND_RECORDING_LIMIT_MS,
    );
  });

  it('formats compact labels for the dock', () => {
    expect(formatBackgroundRecordingLimit(30_000)).toBe('30 sec');
    expect(formatBackgroundRecordingLimit(120_000)).toBe('2 min');
  });
});
