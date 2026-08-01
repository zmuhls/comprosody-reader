import {
  normalizeForm,
  consonantSkeleton,
  phoneticSimilarity,
  extractCandidates,
  applyLexicon,
  rankForHint,
  mergeCandidate,
  isSubstitutionActive,
  encodeLexiconHint,
  PHONETIC_MATCH_THRESHOLD,
} from './lexicon';
import type { LexiconTerm } from '../types/lexicon';

function term(overrides: Partial<LexiconTerm> & { canonical: string }): LexiconTerm {
  return {
    id: overrides.canonical,
    heard: [],
    confirmations: 1,
    misfires: 0,
    createdAt: 0,
    lastUsedAt: 0,
    ...overrides,
  };
}

function asRecord(terms: LexiconTerm[]): Record<string, LexiconTerm> {
  return Object.fromEntries(terms.map((t) => [t.id, t]));
}

describe('normalizeForm', () => {
  it('strips spaces so word-boundary errors compare equal', () => {
    expect(normalizeForm('com prosody')).toBe('comprosody');
    expect(normalizeForm('Comprosody')).toBe('comprosody');
  });

  it('strips punctuation and digits', () => {
    expect(normalizeForm("Kimi-K2's")).toBe('kimiks');
  });
});

describe('consonantSkeleton', () => {
  it('folds phonetically equivalent consonants', () => {
    expect(consonantSkeleton('smulls')).toBe(consonantSkeleton('zmuhls'));
  });

  it('drops vowels and collapses runs', () => {
    expect(consonantSkeleton('smulls')).toBe('smls');
  });

  it('keeps unrelated words distinct', () => {
    expect(consonantSkeleton('whisper')).not.toBe(consonantSkeleton('gemini'));
  });
});

describe('phoneticSimilarity', () => {
  it('scores a word-boundary mishearing as identical', () => {
    expect(phoneticSimilarity('com prosody', 'comprosody')).toBe(1);
  });

  it('scores a vowel-level mishearing above threshold', () => {
    expect(phoneticSimilarity('smulls', 'zmuhls')).toBeGreaterThanOrEqual(
      PHONETIC_MATCH_THRESHOLD
    );
    expect(phoneticSimilarity('prosaic', 'prosodic')).toBeGreaterThanOrEqual(
      PHONETIC_MATCH_THRESHOLD
    );
  });

  it('scores an unrelated content edit below threshold', () => {
    expect(phoneticSimilarity('Whisper', 'Gemini')).toBeLessThan(
      PHONETIC_MATCH_THRESHOLD
    );
    expect(phoneticSimilarity('morning', 'evening')).toBeLessThan(
      PHONETIC_MATCH_THRESHOLD
    );
  });

  it('returns 0 for empty input', () => {
    expect(phoneticSimilarity('', 'comprosody')).toBe(0);
    expect(phoneticSimilarity('...', 'comprosody')).toBe(0);
  });
});

describe('extractCandidates', () => {
  it('proposes a phonetically similar substitution', () => {
    const candidates = extractCandidates(
      'the com prosody reader is live',
      'the comprosody reader is live'
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      heard: 'com prosody',
      canonical: 'comprosody',
    });
  });

  it('rejects a content edit that is not a mishearing', () => {
    const candidates = extractCandidates(
      'the reader uses Whisper for transcription',
      'the reader uses Gemini for transcription'
    );
    expect(candidates).toEqual([]);
  });

  it('rejects a full sentence rewrite', () => {
    const candidates = extractCandidates(
      'I think the thing about this is that it matters',
      'This matters because of how the system behaves'
    );
    expect(candidates).toEqual([]);
  });

  it('rejects a capitalization-only change', () => {
    const candidates = extractCandidates('we met mark today', 'we met Mark today');
    expect(candidates).toEqual([]);
  });

  it('rejects heard forms shorter than the minimum', () => {
    const candidates = extractCandidates('the cat sat', 'the bat sat');
    expect(candidates).toEqual([]);
  });

  it('deduplicates repeated corrections of the same term', () => {
    const candidates = extractCandidates(
      'com prosody is good and com prosody is fast',
      'comprosody is good and comprosody is fast'
    );
    expect(candidates).toHaveLength(1);
  });

  it('returns nothing for empty input or an unedited transcript', () => {
    expect(extractCandidates('', 'anything')).toEqual([]);
    expect(extractCandidates('unchanged text', 'unchanged text')).toEqual([]);
  });
});

describe('applyLexicon', () => {
  const lexicon = asRecord([
    term({ id: 'a', canonical: 'comprosody', heard: ['com prosody'] }),
    term({ id: 'b', canonical: 'zmuhls', heard: ['smulls'] }),
  ]);

  it('substitutes confirmed heard forms', () => {
    const result = applyLexicon('the com prosody reader by smulls', lexicon);
    expect(result.text).toBe('the comprosody reader by zmuhls');
    expect(result.applied).toHaveLength(2);
  });

  it('reports how many times each rule fired', () => {
    const result = applyLexicon('com prosody and com prosody', lexicon);
    expect(result.applied[0]).toMatchObject({ canonical: 'comprosody', count: 2 });
  });

  it('is case-sensitive so a taught proper noun never rewrites the common word', () => {
    const marked = asRecord([term({ id: 'm', canonical: 'Mark', heard: ['Marc'] })]);
    const result = applyLexicon('please marc the marc as Marc', marked);
    // Only the capitalized instance is a mishearing of the name; the lowercase
    // common word is left alone.
    expect(result.text).toBe('please marc the marc as Mark');
    expect(result.applied).toEqual([
      { termId: 'm', heard: 'Marc', canonical: 'Mark', count: 1 },
    ]);
  });

  it('never applies a rule that only changes capitalization', () => {
    const caseOnly = asRecord([term({ id: 'c', canonical: 'Mark', heard: ['mark'] })]);
    const result = applyLexicon('please mark the mark', caseOnly);
    expect(result.text).toBe('please mark the mark');
    expect(result.applied).toEqual([]);
  });

  it('respects word boundaries', () => {
    const result = applyLexicon('uncomprosodylike', lexicon);
    expect(result.text).toBe('uncomprosodylike');
  });

  it('skips demoted terms where misfires have caught up to confirmations', () => {
    const demoted = asRecord([
      term({ id: 'd', canonical: 'comprosody', heard: ['com prosody'], confirmations: 1, misfires: 1 }),
    ]);
    const result = applyLexicon('the com prosody reader', demoted);
    expect(result.text).toBe('the com prosody reader');
    expect(result.applied).toEqual([]);
  });

  it('prefers the longest matching heard form', () => {
    const overlapping = asRecord([
      term({ id: 'long', canonical: 'comprosody', heard: ['com prosody'] }),
      term({ id: 'short', canonical: 'communication', heard: ['com'] }),
    ]);
    const result = applyLexicon('com prosody', overlapping);
    expect(result.text).toBe('comprosody');
  });

  it('returns empty text untouched', () => {
    expect(applyLexicon('', lexicon)).toEqual({ text: '', applied: [] });
  });
});

describe('isSubstitutionActive', () => {
  it('is active while confirmations lead misfires', () => {
    expect(isSubstitutionActive(term({ canonical: 'x', confirmations: 2, misfires: 1 }))).toBe(true);
  });

  it('is inactive once misfires catch up', () => {
    expect(isSubstitutionActive(term({ canonical: 'x', confirmations: 1, misfires: 1 }))).toBe(false);
  });
});

describe('rankForHint', () => {
  const terms = asRecord([
    term({ id: 'a', canonical: 'alpha', confirmations: 1, lastUsedAt: 100 }),
    term({ id: 'b', canonical: 'bravo', confirmations: 5, lastUsedAt: 50 }),
    term({ id: 'c', canonical: 'charlie', confirmations: 1, lastUsedAt: 900 }),
  ]);

  it('orders by confirmations, then recency', () => {
    expect(rankForHint(terms, 10, 64)).toEqual(['bravo', 'charlie', 'alpha']);
  });

  it('caps the list', () => {
    expect(rankForHint(terms, 2, 64)).toEqual(['bravo', 'charlie']);
  });

  it('drops terms longer than the max length', () => {
    expect(rankForHint(terms, 10, 5)).toEqual(['bravo', 'alpha']);
  });

  it('keeps demoted terms, since demotion only disables the find/replace', () => {
    const demoted = asRecord([
      term({ id: 'd', canonical: 'delta', confirmations: 1, misfires: 3 }),
    ]);
    expect(rankForHint(demoted, 10, 64)).toEqual(['delta']);
  });

  it('excludes unconfirmed terms', () => {
    const unconfirmed = asRecord([
      term({ id: 'u', canonical: 'unconfirmed', confirmations: 0 }),
    ]);
    expect(rankForHint(unconfirmed, 10, 64)).toEqual([]);
  });
});

describe('encodeLexiconHint', () => {
  // Mirrors optHeaderStringArray in server/lib/validate.ts — if these two ever
  // disagree the hint silently decodes to nothing and the loop goes inert.
  function decodeAsServerWould(header: string): unknown {
    return JSON.parse(
      Uint8Array.from(atob(header), (c) => c.charCodeAt(0)).reduce(
        (text, byte) => text + String.fromCharCode(byte),
        ''
      )
    );
  }

  it('round-trips through the server decoder', () => {
    const encoded = encodeLexiconHint(['comprosody', 'zmuhls'], 4096);
    expect(decodeAsServerWould(encoded)).toEqual(['comprosody', 'zmuhls']);
  });

  // Pinned literal, asserted identically in server/lib/validate.test.ts. If
  // either side changes its encoding this breaks loudly, instead of the hint
  // quietly decoding to nothing and the whole loop going inert.
  it('produces the exact wire format the server expects', () => {
    expect(encodeLexiconHint(['comprosody', 'zmuhls', 'naïve'], 4096)).toBe(
      'WyJjb21wcm9zb2R5Iiwiem11aGxzIiwibmHDr3ZlIl0='
    );
  });

  it('encodes non-ASCII terms without throwing', () => {
    const encoded = encodeLexiconHint(['naïve'], 4096);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('drops the least-established terms until the payload fits', () => {
    const terms = Array.from({ length: 50 }, (_, i) => `term-number-${i}`);
    const encoded = encodeLexiconHint(terms, 200);
    expect(encoded.length).toBeLessThanOrEqual(200);
    const decoded = decodeAsServerWould(encoded) as string[];
    expect(decoded.length).toBeLessThan(terms.length);
    // Keeps a prefix, so the highest-ranked terms survive.
    expect(decoded[0]).toBe('term-number-0');
  });

  it('returns an empty string when nothing fits or there is nothing to send', () => {
    expect(encodeLexiconHint([], 4096)).toBe('');
    expect(encodeLexiconHint(['anything'], 4)).toBe('');
  });
});

describe('mergeCandidate', () => {
  const candidate = {
    id: 'com prosody→comprosody',
    heard: 'com prosody',
    canonical: 'comprosody',
    similarity: 1,
  };

  it('creates a new term when the canonical form is unknown', () => {
    const merged = mergeCandidate({}, candidate, 1000);
    const created = Object.values(merged)[0];
    expect(created).toMatchObject({
      canonical: 'comprosody',
      heard: ['com prosody'],
      confirmations: 1,
      misfires: 0,
      lastUsedAt: 1000,
    });
  });

  it('folds a new mishearing into an existing term', () => {
    const existing = asRecord([
      term({ id: 'a', canonical: 'comprosody', heard: ['comm prosody'], confirmations: 2 }),
    ]);
    const merged = mergeCandidate(existing, candidate, 2000);
    expect(Object.keys(merged)).toHaveLength(1);
    expect(merged.a).toMatchObject({
      heard: ['comm prosody', 'com prosody'],
      confirmations: 3,
      lastUsedAt: 2000,
    });
  });

  // Hand-added from the lexicon panel: a word the model has not yet misheard,
  // taught as an upstream hint only.
  it('creates a hint-only term when no heard form is given', () => {
    const merged = mergeCandidate(
      {},
      { id: 'x', heard: '', canonical: 'comprosody', similarity: 1 },
      1000
    );
    const created = Object.values(merged)[0];
    expect(created.heard).toEqual([]);
    expect(created.confirmations).toBe(1);
    // Reaches the upstream hint but never drives a find/replace.
    expect(rankForHint(merged, 10, 64)).toEqual(['comprosody']);
    expect(applyLexicon('com prosody', merged).applied).toEqual([]);
  });

  it('does not duplicate a heard form already recorded', () => {
    const existing = asRecord([
      term({ id: 'a', canonical: 'comprosody', heard: ['com prosody'] }),
    ]);
    const merged = mergeCandidate(existing, candidate, 2000);
    expect(merged.a.heard).toEqual(['com prosody']);
    expect(merged.a.confirmations).toBe(2);
  });
});
