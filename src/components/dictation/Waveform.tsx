import { useRef, useEffect } from 'react';

interface Props {
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
  isRecording: boolean;
}

export function Waveform({ drawWaveform, isRecording }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isRecording && canvasRef.current) {
      drawWaveform(canvasRef.current, '#c4935a');
    }
  }, [isRecording, drawWaveform]);

  useEffect(() => {
    if (!isRecording && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      const { width, height } = canvasRef.current;
      ctx.fillStyle = '#0e0d0b';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#2e2a24';
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
      height={64}
      className="w-full h-16 rounded border border-border bg-surface"
    />
  );
}
