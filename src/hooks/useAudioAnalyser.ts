import { useRef, useCallback, useEffect } from 'react';

export function useAudioAnalyser() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animFrameRef = useRef<number>(0);

  const start = useCallback(async (stream?: MediaStream) => {
    const mediaStream = stream ?? await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = mediaStream;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(mediaStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
  }, []);

  const stop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    // Don't stop stream tracks here — the caller may still need the stream
    // (e.g., MediaRecorder). The caller is responsible for stopping tracks.
    streamRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const getTimeDomainData = useCallback((): Uint8Array<ArrayBuffer> | null => {
    if (!analyserRef.current || !dataArrayRef.current) return null;
    analyserRef.current.getByteTimeDomainData(dataArrayRef.current);
    return dataArrayRef.current;
  }, []);

  const drawWaveform = useCallback(
    (canvas: HTMLCanvasElement, color: string = '#6366f1') => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !analyserRef.current || !dataArrayRef.current) return;

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);

        const analyser = analyserRef.current;
        const dataArray = dataArrayRef.current;
        if (!analyser || !dataArray) return;

        analyser.getByteTimeDomainData(dataArray);

        const { width, height } = canvas;
        ctx.fillStyle = 'rgba(10, 10, 15, 0.3)';
        ctx.fillRect(0, 0, width, height);

        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.beginPath();

        const sliceWidth = width / dataArray.length;
        let x = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
      };

      draw();
    },
    []
  );

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return { start, stop, getTimeDomainData, drawWaveform };
}
