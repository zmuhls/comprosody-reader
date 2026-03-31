import { useRef, useCallback } from 'react';

export function useMediaRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback((stream: MediaStream) => {
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

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
        resolve(new Blob(chunksRef.current, { type: 'audio/webm' }));
        return;
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        recorderRef.current = null;
        chunksRef.current = [];
        resolve(blob);
      };

      recorder.stop();
    });
  }, []);

  return { start, stop };
}
