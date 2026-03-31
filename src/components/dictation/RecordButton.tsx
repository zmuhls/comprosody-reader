interface Props {
  isRecording: boolean;
  isTranscribing: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ isRecording, isTranscribing, onStart, onStop }: Props) {
  const disabled = isTranscribing;

  return (
    <button
      onClick={isRecording ? onStop : onStart}
      disabled={disabled}
      className={`relative w-12 h-12 rounded-full border-2 transition-all duration-300 flex items-center justify-center ${
        isTranscribing
          ? 'border-border bg-surface-overlay cursor-wait'
          : isRecording
            ? 'border-hot bg-hot/20 hover:bg-hot/30'
            : 'border-accent bg-accent/10 hover:bg-accent/20'
      }`}
      title={
        isTranscribing
          ? 'Transcribing...'
          : isRecording
            ? 'Stop recording'
            : 'Start recording'
      }
    >
      {isTranscribing ? (
        <div className="w-4 h-4 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
      ) : isRecording ? (
        <div className="w-4 h-4 bg-hot rounded-sm" />
      ) : (
        <div className="w-4 h-4 bg-accent rounded-full" />
      )}
      {isRecording && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-hot rounded-full animate-pulse" />
      )}
    </button>
  );
}
