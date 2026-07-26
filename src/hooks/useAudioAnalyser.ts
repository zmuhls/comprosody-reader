import { useRef, useCallback, useEffect } from 'react';

export function useAudioAnalyser() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeDomainDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
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
    frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);
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
      if (!ctx || !analyserRef.current || !timeDomainDataRef.current || !frequencyDataRef.current) {
        return () => {};
      }

      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);

        const analyser = analyserRef.current;
        const timeDomainData = timeDomainDataRef.current;
        const frequencyData = frequencyDataRef.current;
        if (!analyser || !timeDomainData || !frequencyData) return;

        analyser.getByteTimeDomainData(timeDomainData);
        analyser.getByteFrequencyData(frequencyData);

        // CSS-pixel coordinates: the context is pre-scaled by devicePixelRatio
        // in Waveform's resizeCanvas, so canvas.width/height (device px) would
        // draw ratio-times too large on HiDPI displays.
        const { width, height } = canvas.getBoundingClientRect();
        const midline = height / 2;
        const barCount = Math.min(96, frequencyData.length);
        const barWidth = width / barCount;

        ctx.clearRect(0, 0, width, height);

        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(217, 138, 84, 0)');
        gradient.addColorStop(0.22, 'rgba(217, 138, 84, 0.24)');
        gradient.addColorStop(0.5, 'rgba(244, 226, 206, 0.8)');
        gradient.addColorStop(0.78, 'rgba(217, 138, 84, 0.24)');
        gradient.addColorStop(1, 'rgba(217, 138, 84, 0)');

        ctx.fillStyle = gradient;
        for (let i = 0; i < barCount; i++) {
          const index = Math.floor((i / barCount) * frequencyData.length);
          const amplitude = frequencyData[index] / 255;
          const barHeight = Math.max(2, amplitude * height * 0.72);
          const x = i * barWidth;
          ctx.fillRect(x, midline - barHeight / 2, Math.max(1, barWidth * 0.58), barHeight);
        }

        ctx.lineWidth = 1.35;
        ctx.strokeStyle = color;
        ctx.beginPath();

        const sliceWidth = width / timeDomainData.length;
        let x = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          const v = timeDomainData[i] / 128.0;
          const y = (v * height) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }

        ctx.lineTo(width, midline);
        ctx.stroke();
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
