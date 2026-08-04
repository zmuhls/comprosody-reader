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
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '#d2d2ce';
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
      height={42}
      className="record-waveform"
      aria-label={isRecording ? 'Live microphone waveform' : 'Microphone idle'}
      role="img"
    />
  );
}
