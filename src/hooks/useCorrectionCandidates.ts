import { useState, useEffect, useCallback } from 'react';
import { loadTranscriptBaseline } from '../lib/audioStore';
import { extractCandidates } from '../lib/lexicon';
import type { CorrectionCandidate } from '../types/lexicon';

/** Long enough that mid-word typing does not thrash the diff. */
const RECOMPUTE_DELAY_MS = 700;

const NO_DISMISSALS: ReadonlySet<string> = new Set();

/**
 * Proposes corrections by diffing what the takes produced against what the
 * user now has in the transcript. Dismissals are session-scoped — a candidate
 * the user rejects stays hidden until the entry changes or the app reloads.
 *
 * Both pieces of state are tagged with the entry they belong to and derived on
 * read, matching AudioTakes; that resets them on entry change without a
 * cascading setState-in-effect.
 */
export function useCorrectionCandidates(
  entryId: string | null,
  rawTranscript: string
): {
  candidates: CorrectionCandidate[];
  dismiss: (id: string) => void;
} {
  const [found, setFound] = useState<{
    entryId: string;
    candidates: CorrectionCandidate[];
  } | null>(null);
  const [dismissed, setDismissed] = useState<{
    entryId: string;
    ids: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    if (!entryId) return;

    let alive = true;
    const timer = setTimeout(() => {
      loadTranscriptBaseline(entryId)
        .then((baseline) => {
          if (!alive) return;
          setFound({ entryId, candidates: extractCandidates(baseline, rawTranscript) });
        })
        .catch((err) => {
          console.error('Failed to load transcript baseline:', err);
          if (alive) setFound({ entryId, candidates: [] });
        });
    }, RECOMPUTE_DELAY_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [entryId, rawTranscript]);

  const dismiss = useCallback(
    (id: string) => {
      if (!entryId) return;
      setDismissed((prev) => ({
        entryId,
        ids:
          prev && prev.entryId === entryId
            ? new Set(prev.ids).add(id)
            : new Set([id]),
      }));
    },
    [entryId]
  );

  const candidates = found && found.entryId === entryId ? found.candidates : [];
  const hiddenIds =
    dismissed && dismissed.entryId === entryId ? dismissed.ids : NO_DISMISSALS;

  return {
    candidates: candidates.filter((c) => !hiddenIds.has(c.id)),
    dismiss,
  };
}
