import { diffWords } from 'diff';
import type {
  LexiconTerm,
  CorrectionCandidate,
  AppliedSubstitution,
} from '../types/lexicon';

/** Below this combined score a diff pair is treated as a content edit, not a mishearing. */
export const PHONETIC_MATCH_THRESHOLD = 0.7;
/** Substitutions longer than this on either side are rewrites, not corrections. */
export const MAX_CANDIDATE_WORDS = 3;
/** Short heard forms collide with common words too easily to be worth proposing. */
export const MIN_HEARD_LENGTH = 4;

/**
 * Consonant equivalence classes for the skeleton comparison. Deliberately
 * conservative: k/g and m/n stay distinct because folding them produces false
 * positives on unrelated words. A missed proposal costs the user one manual
 * lexicon entry; a false positive poisons every future transcript.
 */
const CONSONANT_FOLD: Record<string, string> = {
  z: 's',
  c: 'k',
  q: 'k',
  v: 'f',
  d: 't',
  j: 'g',
  b: 'p',
};

const DROPPED_LETTERS = new Set(['a', 'e', 'i', 'o', 'u', 'h', 'y']);

/** Lowercase and strip everything but letters, collapsing word boundaries. */
export function normalizeForm(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Vowel-free, phonetically folded consonant skeleton with runs collapsed.
 * "zmuhls" and "smulls" both reduce to "smls".
 */
export function consonantSkeleton(value: string): string {
  let out = '';
  for (const char of normalizeForm(value)) {
    if (DROPPED_LETTERS.has(char)) continue;
    const folded = CONSONANT_FOLD[char] ?? char;
    if (folded !== out[out.length - 1]) out += folded;
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * How plausibly `heard` is a mishearing of `canonical`, in [0, 1].
 *
 * Normalization strips spaces first, so word-boundary errors ("com prosody" for
 * "comprosody") — the most common failure on novel compound terms — score 1.
 * An identical consonant skeleton is treated as strong evidence on its own,
 * since vowels are what transcription models most often get wrong.
 */
export function phoneticSimilarity(heard: string, canonical: string): number {
  const a = normalizeForm(heard);
  const b = normalizeForm(canonical);
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;

  const skeletonA = consonantSkeleton(heard);
  const skeletonB = consonantSkeleton(canonical);
  const editRatio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);

  if (skeletonA.length > 0 && skeletonA === skeletonB) {
    return Math.max(editRatio, 0.9);
  }
  return Math.max(0, editRatio);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** A pair differing only in capitalization is a style preference, not a mishearing. */
function differsOnlyByCase(a: string, b: string): boolean {
  return a !== b && a.toLowerCase() === b.toLowerCase();
}

function isPlausibleCorrection(heard: string, canonical: string): boolean {
  if (!heard || !canonical || heard === canonical) return false;
  if (normalizeForm(heard).length < MIN_HEARD_LENGTH) return false;
  if (wordCount(heard) > MAX_CANDIDATE_WORDS) return false;
  if (wordCount(canonical) > MAX_CANDIDATE_WORDS) return false;
  // Case-only changes are handled far more safely by refinement than by a
  // global find/replace, which would rewrite every occurrence of a common word.
  if (differsOnlyByCase(heard, canonical)) return false;
  return true;
}

/**
 * Extract candidate corrections by diffing the model's transcript against the
 * user's edited version.
 *
 * The raw transcript pane serves two purposes that look identical to a diff:
 * fixing what the model misheard, and revising what was actually said. The
 * phonetic filter is what separates them — without it the lexicon fills with
 * content edits and then biases future transcripts toward them.
 */
export function extractCandidates(
  baseline: string,
  edited: string
): CorrectionCandidate[] {
  if (!baseline.trim() || !edited.trim()) return [];

  const parts = diffWords(baseline, edited);
  const seen = new Set<string>();
  const candidates: CorrectionCandidate[] = [];

  for (let i = 0; i < parts.length - 1; i++) {
    const first = parts[i];
    const second = parts[i + 1];

    // A substitution surfaces as an adjacent removed/added pair.
    const removed = first.removed ? first : second.removed ? second : null;
    const added = first.added ? first : second.added ? second : null;
    if (!removed || !added || removed === added) continue;

    const heard = removed.value.trim();
    const canonical = added.value.trim();
    if (!isPlausibleCorrection(heard, canonical)) continue;

    const similarity = phoneticSimilarity(heard, canonical);
    if (similarity < PHONETIC_MATCH_THRESHOLD) continue;

    const id = `${heard}→${canonical}`;
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, heard, canonical, similarity });
  }

  return candidates;
}

/**
 * A demoted term still contributes to the upstream hint — demotion means the
 * blunt find/replace was unsafe, not that the vocabulary is wrong.
 */
export function isSubstitutionActive(term: LexiconTerm): boolean {
  return term.misfires < term.confirmations;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply confirmed substitutions to a transcript. Case-sensitive and
 * word-bounded: teaching "Mark" must never rewrite "mark".
 */
export function applyLexicon(
  text: string,
  terms: Record<string, LexiconTerm>
): { text: string; applied: AppliedSubstitution[] } {
  if (!text) return { text, applied: [] };

  const rules: Array<{ term: LexiconTerm; heard: string }> = [];
  for (const term of Object.values(terms)) {
    if (!isSubstitutionActive(term)) continue;
    for (const heard of term.heard) {
      if (!heard || heard === term.canonical) continue;
      if (differsOnlyByCase(heard, term.canonical)) continue;
      rules.push({ term, heard });
    }
  }
  // Longest first, so "com prosody" wins over a bare "com".
  rules.sort((a, b) => b.heard.length - a.heard.length);

  let out = text;
  const applied: AppliedSubstitution[] = [];

  for (const { term, heard } of rules) {
    const pattern = new RegExp(`\\b${escapeRegExp(heard)}\\b`, 'g');
    const matches = out.match(pattern);
    if (!matches || matches.length === 0) continue;
    out = out.replace(pattern, term.canonical);
    applied.push({
      termId: term.id,
      heard,
      canonical: term.canonical,
      count: matches.length,
    });
  }

  return { text: out, applied };
}

/**
 * Canonical forms for the upstream vocabulary hint, most-established first.
 * Includes demoted terms — see isSubstitutionActive.
 */
export function rankForHint(
  terms: Record<string, LexiconTerm>,
  cap: number,
  maxTermLength: number
): string[] {
  return Object.values(terms)
    .filter((term) => term.confirmations > 0 && term.canonical.length <= maxTermLength)
    .sort(
      (a, b) => b.confirmations - a.confirmations || b.lastUsedAt - a.lastUsedAt
    )
    .slice(0, cap)
    .map((term) => term.canonical);
}

/** btoa() only accepts latin-1, so encode UTF-8 bytes explicitly. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Encode canonical terms for the `X-Lexicon` request header, dropping the
 * least-established terms until the payload fits. The transcribe route takes a
 * raw audio body, so the hint has no JSON envelope to travel in.
 */
export function encodeLexiconHint(terms: string[], maxEncodedChars: number): string {
  let list = terms;
  while (list.length > 0) {
    const encoded = toBase64(JSON.stringify(list));
    if (encoded.length <= maxEncodedChars) return encoded;
    list = list.slice(0, -1);
  }
  return '';
}

/** Merge a confirmed candidate into the lexicon, folding into an existing term. */
export function mergeCandidate(
  terms: Record<string, LexiconTerm>,
  candidate: CorrectionCandidate,
  now: number
): Record<string, LexiconTerm> {
  const existing = Object.values(terms).find(
    (term) => term.canonical === candidate.canonical
  );

  // An empty heard form is a hint-only term: it biases decoding upstream but
  // never drives a find/replace. That is how a word the model has not yet
  // misheard gets taught.
  const isNewHeard = candidate.heard.length > 0;

  if (existing) {
    return {
      ...terms,
      [existing.id]: {
        ...existing,
        heard:
          isNewHeard && !existing.heard.includes(candidate.heard)
            ? [...existing.heard, candidate.heard]
            : existing.heard,
        confirmations: existing.confirmations + 1,
        lastUsedAt: now,
      },
    };
  }

  const id = crypto.randomUUID();
  return {
    ...terms,
    [id]: {
      id,
      canonical: candidate.canonical,
      heard: isNewHeard ? [candidate.heard] : [],
      confirmations: 1,
      misfires: 0,
      createdAt: now,
      lastUsedAt: now,
    },
  };
}
