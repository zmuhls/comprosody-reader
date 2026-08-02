import { selectMediaRecorderMimeType } from './mediaRecorder';

describe('selectMediaRecorderMimeType', () => {
  it('prefers Opus WebM for Chromium and Firefox', () => {
    expect(
      selectMediaRecorderMimeType((value) => value.startsWith('audio/webm')),
    ).toBe('audio/webm;codecs=opus');
  });

  it('falls back to AAC MP4 for iOS WebKit', () => {
    expect(
      selectMediaRecorderMimeType((value) => value === 'audio/mp4;codecs=mp4a.40.2'),
    ).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  it('lets the browser choose when support probing is unavailable', () => {
    expect(selectMediaRecorderMimeType(() => false)).toBeUndefined();
    expect(
      selectMediaRecorderMimeType(() => {
        throw new Error('unsupported probe');
      }),
    ).toBeUndefined();
  });
});
