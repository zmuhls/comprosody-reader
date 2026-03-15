interface Props {
  rawTranscript: string;
  interimTranscript?: string;
  isRecording: boolean;
}

export function TranscriptView({
  rawTranscript,
  interimTranscript,
  isRecording,
}: Props) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="text-[10px] text-text-muted px-3 py-1.5 border-b border-border uppercase tracking-wider">
        raw transcript
      </div>
      <div className="flex-1 relative">
        <textarea
          readOnly
          value={
            rawTranscript +
            (interimTranscript ? ' ' + interimTranscript : '')
          }
          placeholder={
            isRecording
              ? 'Listening...'
              : 'Start recording to capture speech.'
          }
          className="w-full h-full resize-none bg-transparent text-text-primary text-xs p-3 outline-none placeholder:text-text-muted"
        />
        {interimTranscript && isRecording && (
          <div className="absolute bottom-2 right-2 text-[9px] text-accent animate-pulse">
            transcribing...
          </div>
        )}
      </div>
    </div>
  );
}
