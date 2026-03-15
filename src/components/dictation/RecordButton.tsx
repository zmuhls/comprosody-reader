interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ isRecording, onStart, onStop }: Props) {
  return (
    <button
      onClick={isRecording ? onStop : onStart}
      className={`relative w-12 h-12 rounded-full border-2 transition-all duration-300 flex items-center justify-center ${
        isRecording
          ? 'border-hot bg-hot/20 hover:bg-hot/30'
          : 'border-accent bg-accent/10 hover:bg-accent/20'
      }`}
      title={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isRecording ? (
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
