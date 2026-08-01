import { useRef, useEffect } from 'react';

interface Props {
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => () => void;
  isRecording: boolean;
  className?: string;
  color?: string;
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(width * ratio));
  canvas.height = Math.max(1, Math.floor(height * ratio));

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(ratio, ratio);
}

/**
 * Idle state of the breath line: a faint ember filament with one slow pulse
 * drifting along it. Under prefers-reduced-motion the pulse is skipped and
 * only the static line renders. Returns a cancel function like drawWaveform.
 */
function drawBreathLine(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  const startedAt = performance.now();

  const drawFrame = (now: number) => {
    const { width, height } = canvas.getBoundingClientRect();
    const center = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(217, 138, 84, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();

    if (reduced) return;

    // One ember drifting the filament, ~18s per crossing.
    const period = 18_000;
    const phase = ((now - startedAt) % period) / period;
    const pulseX = phase * (width + 160) - 80;
    const gradient = ctx.createLinearGradient(pulseX - 80, 0, pulseX + 80, 0);
    gradient.addColorStop(0, 'rgba(217, 138, 84, 0)');
    gradient.addColorStop(0.5, 'rgba(231, 154, 101, 0.6)');
    gradient.addColorStop(1, 'rgba(217, 138, 84, 0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, pulseX - 80), center);
    ctx.lineTo(Math.min(width, pulseX + 80), center);
    ctx.stroke();

    raf = requestAnimationFrame(drawFrame);
  };

  drawFrame(performance.now());

  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}

export function Waveform({
  drawWaveform,
  isRecording,
  className,
  color = '#d98a54',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    resizeCanvas(canvas);

    let cancelDraw = isRecording
      ? drawWaveform(canvas, color)
      : drawBreathLine(canvas);

    const observer = new ResizeObserver(() => {
      resizeCanvas(canvas);
      if (!isRecording) {
        // The idle loop may be a single static frame; restart it so the
        // line redraws at the new size.
        cancelDraw();
        cancelDraw = drawBreathLine(canvas);
      }
    });
    observer.observe(canvas);

    return () => {
      cancelDraw();
      observer.disconnect();
    };
  }, [isRecording, drawWaveform, color]);

  return <canvas ref={canvasRef} className={className ?? 'h-20 w-full'} />;
}
