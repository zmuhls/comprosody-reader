export const MEDIA_RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const;

export function selectMediaRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | undefined {
  return MEDIA_RECORDER_MIME_TYPES.find((mimeType) => {
    try {
      return isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });
}
