interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ isRecording, onStart, onStop }: Props) {
  return (
    <button
      onClick={isRecording ? onStop : onStart}
      className={`relative flex h-14 w-14 shrink-0 items-center justify-center border transition-all duration-300 ${
        isRecording
          ? 'border-recording bg-recording/10 hover:bg-recording/16'
          : 'border-border-strong bg-surface-writing hover:border-accent hover:bg-accent/6'
      }`}
      title={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isRecording ? (
        <div className="h-3.5 w-3.5 bg-recording" />
      ) : (
        <div className="h-4 w-4 rounded-full border border-accent bg-accent/85" />
      )}
      {isRecording && (
        <span className="absolute inset-0 border border-recording animate-ping opacity-20" />
      )}
    </button>
  );
}
