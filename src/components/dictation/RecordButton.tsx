interface Props {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({ isRecording, onStart, onStop }: Props) {
  return (
    <button
      onClick={isRecording ? onStop : onStart}
      className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border transition-all duration-300 ${
        isRecording
          ? 'border-recording bg-recording/18 shadow-[0_0_0_1px_rgba(220,101,89,0.25),0_18px_40px_rgba(220,101,89,0.18)] hover:bg-recording/24'
          : 'border-accent bg-accent/16 shadow-[0_0_0_1px_rgba(217,138,84,0.18),0_18px_40px_rgba(0,0,0,0.24)] hover:bg-accent/24 hover:border-accent-hover'
      }`}
      title={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isRecording ? (
        <div className="h-4 w-4 rounded-[4px] bg-recording" />
      ) : (
        <div className="h-5 w-5 rounded-full border border-accent-hover bg-accent" />
      )}
      {isRecording && (
        <span className="absolute inset-0 rounded-2xl border border-recording animate-ping opacity-25" />
      )}
    </button>
  );
}
