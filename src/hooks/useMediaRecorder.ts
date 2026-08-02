import { useRef, useCallback, useMemo } from 'react';
import { selectMediaRecorderMimeType } from '../lib/mediaRecorder';

export function useMediaRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('application/octet-stream');

  const start = useCallback((stream: MediaStream) => {
    chunksRef.current = [];

    const selectedMimeType = selectMediaRecorderMimeType(
      MediaRecorder.isTypeSupported.bind(MediaRecorder),
    );
    const recorder = selectedMimeType
      ? new MediaRecorder(stream, { mimeType: selectedMimeType })
      : new MediaRecorder(stream);
    mimeTypeRef.current = recorder.mimeType || selectedMimeType || 'application/octet-stream';

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorderRef.current = recorder;
    recorder.start(1000); // collect chunks every second
  }, []);

  const stop = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(chunksRef.current, { type: mimeTypeRef.current }));
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        recorderRef.current = null;
        chunksRef.current = [];
        resolve(blob);
      };

      recorder.stop();
    });
  }, []);

  const checkpoint = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    try {
      recorder.requestData();
    } catch {
      // Some WebKit builds reject requestData while the page is transitioning.
    }
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    chunksRef.current = [];
    if (!recorder || recorder.state === 'inactive') return;

    recorder.ondataavailable = null;
    recorder.onstop = null;
    try {
      recorder.stop();
    } catch {
      // The MediaStream tracks are stopped by the caller as a second boundary.
    }
  }, []);

  return useMemo(
    () => ({ cancel, checkpoint, start, stop }),
    [cancel, checkpoint, start, stop],
  );
}
