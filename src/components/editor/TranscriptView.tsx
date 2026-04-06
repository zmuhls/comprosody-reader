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
      <div className="text-[10px] text-text-muted px-4 py-2 border-b border-border uppercase tracking-widest">
        transcript
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
          className="w-full h-full resize-none bg-transparent text-text-primary text-base leading-relaxed p-4 outline-none placeholder:text-text-muted/50 font-writing"
        />
        {interimTranscript && isRecording && (
          <div className="absolute bottom-3 right-3 text-[9px] text-accent/70 animate-pulse tracking-wider uppercase">
            listening...
          </div>
        )}
      </div>
    </div>
  );
}
