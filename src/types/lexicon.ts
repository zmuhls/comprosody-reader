/**
 * A term the user has taught the transcription pipeline.
 *
 * `canonical` is the correct spelling; `heard` collects the mishearings the
 * model has produced for it. Canonical forms go upstream as a vocabulary hint;
 * the heard forms drive the client-side deterministic substitution pass.
 */
export interface LexiconTerm {
  id: string;
  canonical: string;
  heard: string[];
  /** Times the user approved this term. */
  confirmations: number;
  /** Times a deterministic substitution was reverted by the user. */
  misfires: number;
  createdAt: number;
  /** Last time the term fired or was confirmed. */
  lastUsedAt: number;
}

/** A proposed correction, extracted from the diff and awaiting confirmation. */
export interface CorrectionCandidate {
  /** Stable across recomputes so dismissals stick: `${heard}→${canonical}`. */
  id: string;
  heard: string;
  canonical: string;
  similarity: number;
}

/** A substitution the deterministic pass actually performed. */
export interface AppliedSubstitution {
  termId: string;
  heard: string;
  canonical: string;
  count: number;
}
