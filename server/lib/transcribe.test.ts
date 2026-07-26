import { audioFormatFromContentType } from './transcribe.js';

describe('audioFormatFromContentType', () => {
  it('maps webm content types to webm', () => {
    expect(audioFormatFromContentType('audio/webm')).toBe('webm');
    expect(audioFormatFromContentType('audio/webm;codecs=opus')).toBe('webm');
  });

  it('maps mp4 and m4a content types to mp4', () => {
    expect(audioFormatFromContentType('audio/mp4')).toBe('mp4');
    expect(audioFormatFromContentType('audio/mp4;codecs=mp4a.40.2')).toBe('mp4');
    expect(audioFormatFromContentType('audio/x-m4a')).toBe('mp4');
  });

  it('maps ogg content types to ogg', () => {
    expect(audioFormatFromContentType('audio/ogg')).toBe('ogg');
    expect(audioFormatFromContentType('audio/ogg;codecs=opus')).toBe('ogg');
  });

  it('maps wav content types to wav', () => {
    expect(audioFormatFromContentType('audio/wav')).toBe('wav');
    expect(audioFormatFromContentType('audio/x-wav')).toBe('wav');
    expect(audioFormatFromContentType('audio/wave')).toBe('wav');
  });

  it('defaults to webm for missing or unknown content types', () => {
    expect(audioFormatFromContentType(undefined)).toBe('webm');
    expect(audioFormatFromContentType('')).toBe('webm');
    expect(audioFormatFromContentType('application/octet-stream')).toBe('webm');
    expect(audioFormatFromContentType('audio/mpeg')).toBe('webm');
  });

  it('is case-insensitive', () => {
    expect(audioFormatFromContentType('Audio/MP4')).toBe('mp4');
    expect(audioFormatFromContentType('AUDIO/OGG; CODECS=OPUS')).toBe('ogg');
  });
});
