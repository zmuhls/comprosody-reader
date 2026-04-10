import { useRef, useEffect } from 'react';

interface Props {
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
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

function drawIdle(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas.getBoundingClientRect();
  const center = height / 2;

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(238, 242, 246, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, center);
  ctx.lineTo(width, center);
  ctx.stroke();

  ctx.fillStyle = 'rgba(217, 138, 84, 0.28)';
  const bars = 42;
  const gap = width / bars;
  for (let i = 0; i < bars; i++) {
    const heightMod = i % 6 === 0 ? 18 : i % 3 === 0 ? 12 : 8;
    const x = i * gap;
    ctx.fillRect(x, center - heightMod / 2, Math.max(1.5, gap * 0.38), heightMod);
  }
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

    const observer = new ResizeObserver(() => {
      resizeCanvas(canvas);
      if (!isRecording) {
        drawIdle(canvas);
      }
    });
    observer.observe(canvas);

    if (isRecording) {
      drawWaveform(canvas, color);
    } else {
      drawIdle(canvas);
    }

    return () => observer.disconnect();
  }, [isRecording, drawWaveform, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'h-20 w-full'}
    />
  );
}
