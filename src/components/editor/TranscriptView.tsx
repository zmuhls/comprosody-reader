import { AudioTakes } from './AudioTakes';
import { CorrectionChips } from './CorrectionChips';
import { useApp } from '../../context/AppContext';
import { useCorrectionCandidates } from '../../hooks/useCorrectionCandidates';
import type { CorrectionCandidate } from '../../types/lexicon';

interface Props {
  entryId: string;
  rawTranscript: string;
  interimTranscript?: string;
  isRecording: boolean;
  audioTakes?: number;
  onChangeTranscript: (value: string) => void;
}

export function TranscriptView({
  entryId,
  rawTranscript,
  interimTranscript,
  isRecording,
  audioTakes,
  onChangeTranscript,
}: Props) {
  const { dispatch } = useApp();
  // Proposals are noise mid-recording; the transcript is still being appended.
  const { candidates, dismiss } = useCorrectionCandidates(
    isRecording ? null : entryId,
    rawTranscript
  );

  const handleConfirm = (candidate: CorrectionCandidate) => {
    dispatch({ type: 'CONFIRM_LEXICON_TERM', candidate });
    // The baseline still holds the misheard form, so the diff would keep
    // re-proposing this pair until the next take overwrites it.
    dismiss(candidate.id);
  };

  const composedTranscript =
    rawTranscript +
    (isRecording && interimTranscript ? ` ${interimTranscript}` : '');

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface-writing">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-text-muted">
            transcript
          </div>
          <div className="mt-1 text-[11px] text-text-secondary">
            {isRecording
              ? 'Speech appears here while the recorder is live.'
              : 'You can edit the transcript before refinement.'}
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-[0.22em] text-text-muted">
          {isRecording ? 'live input' : 'editable'}
        </span>
      </div>
      <CorrectionChips
        candidates={candidates}
        onConfirm={handleConfirm}
        onDismiss={dismiss}
      />
      <AudioTakes entryId={entryId} audioTakes={audioTakes} />
      <div className="relative flex-1">
        <textarea
          readOnly={isRecording}
          value={composedTranscript}
          onChange={(event) => onChangeTranscript(event.target.value)}
          placeholder={
            isRecording
              ? 'Listening...'
              : 'Record or paste speech here to build the transcript.'
          }
          className="h-full w-full resize-none bg-transparent px-5 py-5 text-[1rem] leading-relaxed text-text-primary outline-none placeholder:text-text-muted/50 font-writing"
        />
        {interimTranscript && isRecording && (
          <div className="absolute bottom-4 right-4 text-[9px] uppercase tracking-[0.28em] text-accent/80 animate-pulse">
            listening...
          </div>
        )}
      </div>
    </div>
  );
}
