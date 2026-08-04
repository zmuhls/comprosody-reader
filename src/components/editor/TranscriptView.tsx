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
    // flex-none: in the mobile scroll column the pane must size to its
    // content (flex-1's zero basis would let it compress and spill); at xl
    // it's a grid item and flex properties are inert.
    <div className="flex min-h-[60%] min-w-0 flex-none flex-col bg-surface-writing xl:min-h-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 truncate text-[10px] uppercase tracking-[0.28em] text-text-muted">
          transcript
        </div>
        {isRecording && (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-recording">
            live
          </span>
        )}
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
          placeholder={isRecording ? 'listening…' : 'record or paste text'}
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
