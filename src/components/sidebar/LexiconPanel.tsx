import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { isSubstitutionActive } from '../../lib/lexicon';

/**
 * Inspect and edit everything the transcription pipeline has been taught.
 *
 * A lexicon that silently rewrites transcripts needs somewhere the user can
 * see and undo what it knows — otherwise a single bad entry is invisible and
 * permanent. Also the escape hatch for terms the phonetic filter never
 * proposes, which it will not when a mishearing is not phonetically close.
 */
export function LexiconPanel() {
  const { state, dispatch } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [canonical, setCanonical] = useState('');
  const [heard, setHeard] = useState('');

  const terms = Object.values(state.lexicon).sort((a, b) =>
    a.canonical.localeCompare(b.canonical)
  );

  const trimmedCanonical = canonical.trim();
  const trimmedHeard = heard.trim();
  const canAdd = trimmedCanonical.length > 0 && trimmedCanonical !== trimmedHeard;

  const handleAdd = () => {
    if (!canAdd) return;
    dispatch({
      type: 'CONFIRM_LEXICON_TERM',
      candidate: {
        id: `${trimmedHeard}→${trimmedCanonical}`,
        heard: trimmedHeard,
        canonical: trimmedCanonical,
        similarity: 1,
      },
    });
    setCanonical('');
    setHeard('');
  };

  return (
    <div className="lexicon-panel border-t border-border">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between px-5 py-3 text-[10px] uppercase tracking-[0.28em] text-text-muted transition-colors hover:text-text-secondary"
      >
        <span>lexicon</span>
        <span className="tabular-nums">
          {terms.length} {isOpen ? '−' : '+'}
        </span>
      </button>

      {isOpen && (
        <div className="px-4 pb-4">
          <div className="mb-3 flex flex-col gap-1.5">
            <input
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              placeholder="correct spelling"
              className="w-full border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-border-focus"
            />
            <input
              value={heard}
              onChange={(e) => setHeard(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="heard as (optional)"
              className="w-full border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-border-focus"
            />
            <button
              onClick={handleAdd}
              disabled={!canAdd}
              className="border border-border px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
            >
              add term
            </button>
          </div>

          {terms.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-text-muted">
              Corrections you confirm in the transcript appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {terms.map((term) => {
                const demoted = term.heard.length > 0 && !isSubstitutionActive(term);
                return (
                  <div key={term.id} className="border border-border px-2 py-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs text-accent">
                        {term.canonical}
                      </span>
                      <button
                        onClick={() =>
                          dispatch({ type: 'DELETE_LEXICON_TERM', id: term.id })
                        }
                        aria-label={`Delete ${term.canonical}`}
                        className="text-[11px] text-text-muted transition-colors hover:text-hot"
                      >
                        ✕
                      </button>
                    </div>
                    {term.heard.length > 0 && (
                      <div className="mt-0.5 truncate text-[10px] text-text-muted">
                        heard as {term.heard.join(', ')}
                      </div>
                    )}
                    {demoted && (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-[9px] uppercase tracking-[0.18em] text-hot">
                          demoted
                        </span>
                        <button
                          onClick={() =>
                            dispatch({
                              type: 'CONFIRM_LEXICON_TERM',
                              candidate: {
                                id: term.id,
                                heard: term.heard[0],
                                canonical: term.canonical,
                                similarity: 1,
                              },
                            })
                          }
                          className="text-[9px] uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-text-primary"
                        >
                          re-enable
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
