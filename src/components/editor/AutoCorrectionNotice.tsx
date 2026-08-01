import type { AppliedSubstitution } from '../../types/lexicon';

interface Props {
  applied: AppliedSubstitution[];
  onRevert: (substitution: AppliedSubstitution) => void;
  onDismiss: () => void;
}

/**
 * Reports substitutions the lexicon made after transcription returned. The
 * transcript no longer matches the model's output, so saying so is the
 * baseline honesty requirement — and reverting here is what demotes a rule
 * that keeps getting it wrong.
 */
export function AutoCorrectionNotice({ applied, onRevert, onDismiss }: Props) {
  if (applied.length === 0) return null;

  const total = applied.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-surface px-5 py-2">
      <span className="text-[10px] uppercase tracking-[0.28em] text-text-muted">
        {total} {total === 1 ? 'term' : 'terms'} auto-corrected
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {applied.map((substitution) => (
          <button
            key={substitution.termId + substitution.heard}
            onClick={() => onRevert(substitution)}
            title={`Undo and stop correcting "${substitution.heard}"`}
            className="border border-border px-2 py-0.5 text-[10px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            <span className="text-accent">{substitution.canonical}</span>
            <span className="ml-1.5 text-text-muted">undo</span>
          </button>
        ))}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss auto-correction notice"
        className="ml-auto px-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
      >
        ✕
      </button>
    </div>
  );
}
