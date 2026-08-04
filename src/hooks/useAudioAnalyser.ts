import { useRef, useCallback, useEffect } from 'react';

export function useAudioAnalyser() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeDomainDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const animFrameRef = useRef<number>(0);

  const start = useCallback(async (stream?: MediaStream) => {
    const mediaStream =
      stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
    streamRef.current = mediaStream;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(mediaStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    analyserRef.current = analyser;
    timeDomainDataRef.current = new Uint8Array(analyser.frequencyBinCount);
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
    if (!analyserRef.current || !timeDomainDataRef.current) return null;
    analyserRef.current.getByteTimeDomainData(timeDomainDataRef.current);
    return timeDomainDataRef.current;
  }, []);

  const drawWaveform = useCallback(
    (canvas: HTMLCanvasElement, color: string = '#d98a54'): (() => void) => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !analyserRef.current || !timeDomainDataRef.current) {
        return () => {};
      }

      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }

      const strokePath = (
        timeDomainData: Uint8Array,
        width: number,
        height: number,
        mirror: boolean
      ) => {
        const midline = height / 2;
        ctx.beginPath();
        const sliceWidth = width / timeDomainData.length;
        let x = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          const v = timeDomainData[i] / 128.0;
          const raw = (v * height) / 2;
          const y = mirror ? 2 * midline - raw : raw;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(width, midline);
        ctx.stroke();
      };

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);

        const analyser = analyserRef.current;
        const timeDomainData = timeDomainDataRef.current;
        if (!analyser || !timeDomainData) return;

        analyser.getByteTimeDomainData(timeDomainData);

        // CSS-pixel coordinates: the context is pre-scaled by devicePixelRatio
        // in Waveform's resizeCanvas, so canvas.width/height (device px) would
        // draw ratio-times too large on HiDPI displays.
        const { width, height } = canvas.getBoundingClientRect();

        ctx.clearRect(0, 0, width, height);

        // The breath line, live: a calligraphic stroke along the filament
        // with a faint mirrored ghost beneath it.
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = 'rgba(217, 138, 84, 0.5)';
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = color;
        strokePath(timeDomainData, width, height, false);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.strokeStyle = color;
        strokePath(timeDomainData, width, height, true);
        ctx.restore();
      };

      draw();

      return () => {
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = 0;
        }
      };
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
