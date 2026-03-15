import { useRef, useEffect } from 'react';

interface Props {
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
  isRecording: boolean;
}

export function Waveform({ drawWaveform, isRecording }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isRecording && canvasRef.current) {
      drawWaveform(canvasRef.current, '#6366f1');
    }
  }, [isRecording, drawWaveform]);

  // Draw flat line when idle
  useEffect(() => {
    if (!isRecording && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      const { width, height } = canvasRef.current;
      ctx.fillStyle = 'rgba(10, 10, 15, 1)';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#2a2a3a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }
  }, [isRecording]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={80}
      className="w-full h-20 rounded border border-border bg-surface"
    />
  );
}
