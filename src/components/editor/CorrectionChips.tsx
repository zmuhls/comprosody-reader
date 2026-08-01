import type { CorrectionCandidate } from '../../types/lexicon';

interface Props {
  candidates: CorrectionCandidate[];
  onConfirm: (candidate: CorrectionCandidate) => void;
  onDismiss: (id: string) => void;
}

/**
 * Proposed corrections awaiting confirmation. Confirming teaches the term to
 * the transcription pipeline; dismissing hides it for the session.
 */
export function CorrectionChips({ candidates, onConfirm, onDismiss }: Props) {
  if (candidates.length === 0) return null;

  return (
    <div className="border-b border-border bg-surface px-5 py-3">
      <div className="text-[10px] uppercase tracking-[0.28em] text-text-muted">
        remember these?
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            className="flex items-center gap-2 border border-border px-3 py-1.5"
          >
            <span className="text-[11px] text-text-secondary">
              <span className="text-text-muted line-through">{candidate.heard}</span>
              <span className="mx-1.5 text-text-muted">→</span>
              <span className="text-accent">{candidate.canonical}</span>
            </span>
            <button
              onClick={() => onConfirm(candidate)}
              title={`Always transcribe as "${candidate.canonical}"`}
              aria-label={`Remember ${candidate.canonical}`}
              className="px-1 text-[11px] text-text-muted transition-colors hover:text-success"
            >
              ✓
            </button>
            <button
              onClick={() => onDismiss(candidate.id)}
              title="Not a mishearing"
              aria-label={`Dismiss ${candidate.canonical}`}
              className="px-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
