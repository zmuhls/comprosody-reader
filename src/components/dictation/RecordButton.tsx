interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ isRecording, onStart, onStop }: Props) {
  return (
    <button
      onClick={isRecording ? onStop : onStart}
      className={`relative w-11 h-11 rounded-full transition-all duration-300 flex items-center justify-center shrink-0 ${
        isRecording
          ? 'bg-recording/15 border-2 border-recording hover:bg-recording/25'
          : 'bg-accent/10 border-2 border-accent/50 hover:border-accent hover:bg-accent/20'
      }`}
      title={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isRecording ? (
        <div className="w-3.5 h-3.5 bg-recording rounded-sm" />
      ) : (
        <div className="w-3.5 h-3.5 bg-accent rounded-full" />
      )}
      {isRecording && (
        <span className="absolute inset-0 rounded-full border-2 border-recording animate-ping opacity-20" />
      )}
    </button>
  );
}
