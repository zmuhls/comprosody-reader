interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  /** Live vocal energy 0–1; drives the recording glow so the seal breathes. */
  energy?: number;
}

export function RecordButton({
  isRecording,
  onStart,
  onStop,
  disabled,
  energy = 0,
}: Props) {
  const title = disabled
    ? 'Transcribing previous take'
    : isRecording
      ? 'Stop recording'
      : 'Start recording';

  // Double ring: a canvas-colored gap between the outer border and an inner
  // ring, like a seal. While recording the outer glow tracks vocal energy.
  const ringShadow = isRecording
    ? `inset 0 0 0 3px var(--color-canvas), inset 0 0 0 4px rgba(220, 101, 89, 0.55), 0 0 ${
        10 + energy * 26
      }px rgba(220, 101, 89, ${(0.25 + energy * 0.4).toFixed(3)})`
    : 'inset 0 0 0 3px var(--color-canvas), inset 0 0 0 4px rgba(217, 138, 84, 0.45), 0 10px 30px rgba(0, 0, 0, 0.3)';

  return (
    <button
      onClick={isRecording ? onStop : onStart}
      disabled={disabled}
      aria-label={title}
      aria-pressed={isRecording}
      className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-35 ${
        isRecording
          ? 'border-recording bg-recording/12'
          : 'border-accent/70 bg-accent/10 hover:border-accent hover:bg-accent/18'
      }`}
      style={{ boxShadow: ringShadow }}
      title={title}
    >
      <div
        className={`transition-all duration-300 ${
          isRecording
            ? 'h-4 w-4 rounded-[3px] bg-recording'
            : 'h-5 w-5 rounded-full bg-accent'
        }`}
      />
      {isRecording && (
        <span className="absolute inset-0 rounded-full border border-recording opacity-25 motion-safe:animate-ping" />
      )}
    </button>
  );
}
