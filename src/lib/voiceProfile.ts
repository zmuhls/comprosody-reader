import type { ProsodyDiagnostics } from '../types/audio';
import type { Entry } from '../types/editor';

export const VOICE_PROFILE_SCHEMA_VERSION = 1 as const;
export const VOICE_PROFILE_ALGORITHM_VERSION = 'voice-profile-v1' as const;

export type VoiceProfilePhraseSize = 2 | 3;

export interface VoiceProfileOptions {
  /** Maximum number of ranked vocabulary terms retained in local storage. */
  maxVocabularyTerms?: number;
  /** Maximum number of ranked phrases retained in local storage. */
  maxPhrases?: number;
  /** Contiguous phrase lengths to learn. */
  phraseSizes?: readonly VoiceProfilePhraseSize[];
  /** Number of most-recent entries included in the rolling prosody baseline. */
  rollingWindowEntries?: number;
}

export interface VoiceProfileSettings {
  maxVocabularyTerms: number;
  maxPhrases: number;
  phraseSizes: readonly VoiceProfilePhraseSize[];
  rollingWindowEntries: number;
}

export interface LearnedVocabularyTerm {
  /** Case-folded form used to combine equivalent spellings. */
  canonical: string;
  /** Most frequently observed casing/spelling, suitable for transcription hints. */
  preferred: string;
  count: number;
  documentCount: number;
}

export interface LearnedPhrase {
  /** Case-folded, whitespace-normalized phrase. */
  canonical: string;
  /** Most frequently observed surface form. */
  preferred: string;
  size: VoiceProfilePhraseSize;
  count: number;
  documentCount: number;
}

export interface NumericProsodyDescriptor {
  mean: number;
  standardDeviation: number;
  min: number;
  max: number;
  /** Value from the chronologically latest contributing entry. */
  latest: number;
}

export interface ProsodyDescriptor {
  sampleCount: number;
  pace: NumericProsodyDescriptor;
  energy: NumericProsodyDescriptor;
  fluency: NumericProsodyDescriptor;
  lexicalDensity: NumericProsodyDescriptor;
}

export interface ProsodyTrend {
  /** Rolling mean minus lifetime mean for each metric. */
  pace: number;
  energy: number;
  fluency: number;
  lexicalDensity: number;
}

export interface VoiceProfile {
  schemaVersion: typeof VOICE_PROFILE_SCHEMA_VERSION;
  algorithmVersion: typeof VOICE_PROFILE_ALGORITHM_VERSION;
  privacy: {
    storageScope: 'device-local';
    networkAccess: 'none';
    rawAudioStored: false;
    derivedTextStored: true;
  };
  /** Deterministically derived from the latest contributing entry, never Date.now(). */
  updatedAt: number;
  source: {
    entryCount: number;
    transcriptEntryCount: number;
    /** Legacy field name; counts bounded recording-level prosody observations. */
    prosodyEntryCount: number;
  };
  settings: VoiceProfileSettings;
  vocabulary: {
    tokenCount: number;
    uniqueTermCount: number;
    termsTruncated: boolean;
    terms: readonly LearnedVocabularyTerm[];
    phraseCount: number;
    uniquePhraseCount: number;
    phrasesTruncated: boolean;
    phrases: readonly LearnedPhrase[];
  };
  prosody: {
    lifetime: ProsodyDescriptor | null;
    rolling: ProsodyDescriptor | null;
    trend: ProsodyTrend | null;
  };
}

export interface TranscriptionHintOptions {
  maxTerms?: number;
  maxPhrases?: number;
  minTermCount?: number;
  minPhraseCount?: number;
  excludeCommonWords?: boolean;
}

export interface TranscriptionHints {
  terms: readonly string[];
  phrases: readonly string[];
}

export const DEFAULT_VOICE_PROFILE_OPTIONS: Readonly<VoiceProfileSettings> = {
  maxVocabularyTerms: 2_048,
  maxPhrases: 1_024,
  phraseSizes: [2, 3],
  rollingWindowEntries: 20,
};

const COMMON_TRANSCRIPTION_WORDS = new Set([
  'a', 'about', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his',
  'how', 'i', 'if', 'in', 'is', 'it', 'its', 'just', 'like', 'may', 'me',
  'more', 'most', 'my', 'no', 'not', 'of', 'on', 'one', 'or', 'our', 'she',
  'should', 'so', 'some', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'those', 'to', 'too', 'uh', 'um', 'up', 'us',
  'very', 'was', 'we', 'well', 'were', 'what', 'when', 'where', 'which',
  'who', 'will', 'with', 'would', 'you', 'your',
]);

const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:['’\-\u2010-\u2015][\p{L}\p{N}]+)*/gu;

export interface VoiceVocabularyToken {
  canonical: string;
  surface: string;
}

interface MutableLexeme {
  canonical: string;
  count: number;
  documents: Set<string>;
  surfaces: Map<string, number>;
}

interface ProsodySample extends ProsodyDiagnostics {
  entryId: string;
  updatedAt: number;
}

export type VoiceProfileEntryRecord = Readonly<Record<string, Entry>>;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function toBoundedInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.floor(value));
}

function resolveOptions(options: VoiceProfileOptions = {}): VoiceProfileSettings {
  const phraseSizes = [...new Set(options.phraseSizes ?? DEFAULT_VOICE_PROFILE_OPTIONS.phraseSizes)]
    .filter((size): size is VoiceProfilePhraseSize => size === 2 || size === 3)
    .sort((a, b) => a - b);

  return {
    maxVocabularyTerms: toBoundedInteger(
      options.maxVocabularyTerms,
      DEFAULT_VOICE_PROFILE_OPTIONS.maxVocabularyTerms,
      0
    ),
    maxPhrases: toBoundedInteger(
      options.maxPhrases,
      DEFAULT_VOICE_PROFILE_OPTIONS.maxPhrases,
      0
    ),
    phraseSizes,
    rollingWindowEntries: toBoundedInteger(
      options.rollingWindowEntries,
      DEFAULT_VOICE_PROFILE_OPTIONS.rollingWindowEntries,
      1
    ),
  };
}

/**
 * Tokenizes transcription text without retaining sentence- or audio-level data.
 * Unicode letters/numbers, contractions, and hyphenated compounds are preserved.
 */
export function tokenizeVoiceVocabulary(text: string): readonly VoiceVocabularyToken[] {
  const normalized = text.normalize('NFKC');
  const matches = normalized.match(TOKEN_PATTERN) ?? [];
  return matches.map((match) => {
    const surface = match
      .replace(/’/g, "'")
      .replace(/[\u2010-\u2015]/g, '-');
    return { canonical: surface.toLowerCase(), surface };
  });
}

function addLexeme(
  lexemes: Map<string, MutableLexeme>,
  canonical: string,
  surface: string,
  documentId: string
): void {
  const existing = lexemes.get(canonical);
  if (existing) {
    existing.count += 1;
    existing.documents.add(documentId);
    existing.surfaces.set(surface, (existing.surfaces.get(surface) ?? 0) + 1);
    return;
  }

  lexemes.set(canonical, {
    canonical,
    count: 1,
    documents: new Set([documentId]),
    surfaces: new Map([[surface, 1]]),
  });
}

function preferredSurface(lexeme: MutableLexeme): string {
  return [...lexeme.surfaces.entries()]
    .sort(([surfaceA, countA], [surfaceB, countB]) =>
      countB - countA || compareText(surfaceA, surfaceB)
    )[0]?.[0] ?? lexeme.canonical;
}

function compareLexemes(a: MutableLexeme, b: MutableLexeme): number {
  return (
    b.count - a.count ||
    b.documents.size - a.documents.size ||
    compareText(a.canonical, b.canonical)
  );
}

function chronologicalEntries(entries: VoiceProfileEntryRecord): readonly Entry[] {
  return Object.values(entries).sort(
    (a, b) => a.updatedAt - b.updatedAt || compareText(a.id, b.id)
  );
}

function finiteProsody(prosody: ProsodyDiagnostics): boolean {
  return (
    Number.isFinite(prosody.pace) &&
    Number.isFinite(prosody.energy) &&
    Number.isFinite(prosody.fluency) &&
    Number.isFinite(prosody.lexicalDensity) &&
    prosody.pace >= 0 &&
    prosody.energy >= 0 && prosody.energy <= 1 &&
    prosody.fluency >= 0 && prosody.fluency <= 1 &&
    prosody.lexicalDensity >= 0 && prosody.lexicalDensity <= 1
  );
}

/** Default all-zero/fully-fluent placeholders are not treated as observations. */
export function hasObservedProsody(prosody: ProsodyDiagnostics): boolean {
  return finiteProsody(prosody) && (
    prosody.pace > 0 ||
    prosody.energy > 0 ||
    prosody.fluency < 1 ||
    prosody.lexicalDensity > 0
  );
}

function describeNumbers(values: readonly number[]): NumericProsodyDescriptor {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0
  ) / values.length;

  return {
    mean,
    standardDeviation: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    latest: values[values.length - 1],
  };
}

function describeProsody(samples: readonly ProsodySample[]): ProsodyDescriptor | null {
  if (samples.length === 0) return null;
  return {
    sampleCount: samples.length,
    pace: describeNumbers(samples.map((sample) => sample.pace)),
    energy: describeNumbers(samples.map((sample) => sample.energy)),
    fluency: describeNumbers(samples.map((sample) => sample.fluency)),
    lexicalDensity: describeNumbers(samples.map((sample) => sample.lexicalDensity)),
  };
}

function prosodyTrend(
  lifetime: ProsodyDescriptor | null,
  rolling: ProsodyDescriptor | null
): ProsodyTrend | null {
  if (!lifetime || !rolling) return null;
  return {
    pace: rolling.pace.mean - lifetime.pace.mean,
    energy: rolling.energy.mean - lifetime.energy.mean,
    fluency: rolling.fluency.mean - lifetime.fluency.mean,
    lexicalDensity: rolling.lexicalDensity.mean - lifetime.lexicalDensity.mean,
  };
}

/**
 * Builds a deterministic, bounded profile from current local entries.
 *
 * Only `rawTranscript`, entry timestamps/ids, and aggregate entry prosody are read.
 * Refined model output and raw audio are never included in the profile.
 */
export function buildVoiceProfile(
  entries: VoiceProfileEntryRecord,
  options: VoiceProfileOptions = {}
): VoiceProfile {
  const settings = resolveOptions(options);
  const terms = new Map<string, MutableLexeme>();
  const phrases = new Map<string, MutableLexeme>();
  const prosodySamples: ProsodySample[] = [];
  let transcriptEntryCount = 0;
  let tokenCount = 0;
  let phraseCount = 0;

  const orderedEntries = chronologicalEntries(entries);
  for (const entry of orderedEntries) {
    const tokens = tokenizeVoiceVocabulary(entry.rawTranscript);
    if (tokens.length > 0) {
      transcriptEntryCount += 1;
      tokenCount += tokens.length;

      for (const token of tokens) {
        addLexeme(terms, token.canonical, token.surface, entry.id);
      }

      for (const size of settings.phraseSizes) {
        for (let index = 0; index <= tokens.length - size; index += 1) {
          const phraseTokens = tokens.slice(index, index + size);
          const canonical = phraseTokens.map((token) => token.canonical).join(' ');
          const surface = phraseTokens.map((token) => token.surface).join(' ');
          addLexeme(phrases, canonical, surface, entry.id);
          phraseCount += 1;
        }
      }

      const observedHistory = (entry.prosodyHistory ?? [])
        .filter(
          (observation) =>
            Number.isFinite(observation.capturedAt) &&
            observation.capturedAt >= 0 &&
            hasObservedProsody(observation.metrics),
        )
        .sort((left, right) => left.capturedAt - right.capturedAt);

      if (observedHistory.length > 0) {
        for (const [index, observation] of observedHistory.entries()) {
          prosodySamples.push({
            entryId: `${entry.id}:${index}`,
            updatedAt: observation.capturedAt,
            ...observation.metrics,
          });
        }
      } else if (hasObservedProsody(entry.prosody)) {
        // Entries created before recording-level history retain their latest
        // aggregate as one backwards-compatible observation.
        prosodySamples.push({
          entryId: entry.id,
          updatedAt: entry.updatedAt,
          ...entry.prosody,
        });
      }
    }
  }

  const rankedTerms = [...terms.values()].sort(compareLexemes);
  const rankedPhrases = [...phrases.values()].sort(compareLexemes);
  prosodySamples.sort(
    (left, right) =>
      left.updatedAt - right.updatedAt ||
      compareText(left.entryId, right.entryId),
  );
  const retainedTerms: LearnedVocabularyTerm[] = rankedTerms
    .slice(0, settings.maxVocabularyTerms)
    .map((term) => ({
      canonical: term.canonical,
      preferred: preferredSurface(term),
      count: term.count,
      documentCount: term.documents.size,
    }));
  const retainedPhrases: LearnedPhrase[] = rankedPhrases
    .slice(0, settings.maxPhrases)
    .map((phrase) => ({
      canonical: phrase.canonical,
      preferred: preferredSurface(phrase),
      size: phrase.canonical.split(' ').length as VoiceProfilePhraseSize,
      count: phrase.count,
      documentCount: phrase.documents.size,
    }));

  const lifetime = describeProsody(prosodySamples);
  const rolling = describeProsody(
    prosodySamples.slice(-settings.rollingWindowEntries)
  );
  const updatedAt = orderedEntries.reduce(
    (latest, entry) => Math.max(latest, entry.updatedAt),
    0
  );

  return {
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    algorithmVersion: VOICE_PROFILE_ALGORITHM_VERSION,
    privacy: {
      storageScope: 'device-local',
      networkAccess: 'none',
      rawAudioStored: false,
      derivedTextStored: true,
    },
    updatedAt,
    source: {
      entryCount: orderedEntries.length,
      transcriptEntryCount,
      prosodyEntryCount: prosodySamples.length,
    },
    settings,
    vocabulary: {
      tokenCount,
      uniqueTermCount: rankedTerms.length,
      termsTruncated: retainedTerms.length < rankedTerms.length,
      terms: retainedTerms,
      phraseCount,
      uniquePhraseCount: rankedPhrases.length,
      phrasesTruncated: retainedPhrases.length < rankedPhrases.length,
      phrases: retainedPhrases,
    },
    prosody: {
      lifetime,
      rolling,
      trend: prosodyTrend(lifetime, rolling),
    },
  };
}

/** Rebuilds a profile as though `entry` had been inserted or replaced in the store. */
export function upsertVoiceProfileEntry(
  entries: VoiceProfileEntryRecord,
  entry: Entry,
  options: VoiceProfileOptions = {}
): VoiceProfile {
  return buildVoiceProfile({ ...entries, [entry.id]: entry }, options);
}

/** Rebuilds a profile as though `entryId` had been removed from the store. */
export function removeVoiceProfileEntry(
  entries: VoiceProfileEntryRecord,
  entryId: string,
  options: VoiceProfileOptions = {}
): VoiceProfile {
  const remaining: Record<string, Entry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (id !== entryId) remaining[id] = entry;
  }
  return buildVoiceProfile(remaining, options);
}

/** Selects compact, high-frequency hints for a local or remote transcription engine. */
export function selectTranscriptionHints(
  profile: VoiceProfile,
  options: TranscriptionHintOptions = {}
): TranscriptionHints {
  const maxTerms = toBoundedInteger(options.maxTerms, 64, 0);
  const maxPhrases = toBoundedInteger(options.maxPhrases, 32, 0);
  const minTermCount = toBoundedInteger(options.minTermCount, 2, 1);
  const minPhraseCount = toBoundedInteger(options.minPhraseCount, 2, 1);
  const excludeCommonWords = options.excludeCommonWords ?? true;

  const terms = profile.vocabulary.terms
    .filter((term) => term.count >= minTermCount)
    .filter((term) => !excludeCommonWords || !COMMON_TRANSCRIPTION_WORDS.has(term.canonical))
    .slice(0, maxTerms)
    .map((term) => term.preferred);
  const phrases = profile.vocabulary.phrases
    .filter((phrase) => phrase.count >= minPhraseCount)
    .slice(0, maxPhrases)
    .map((phrase) => phrase.preferred);

  return { terms, phrases };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function isNumericDescriptor(value: unknown): value is NumericProsodyDescriptor {
  return (
    isRecord(value) &&
    isFiniteNumber(value.mean) &&
    isFiniteNumber(value.standardDeviation) && value.standardDeviation >= 0 &&
    isFiniteNumber(value.min) &&
    isFiniteNumber(value.max) &&
    isFiniteNumber(value.latest)
  );
}

function isProsodyDescriptor(value: unknown): value is ProsodyDescriptor {
  return (
    isRecord(value) &&
    isPositiveInteger(value.sampleCount) &&
    isNumericDescriptor(value.pace) &&
    isNumericDescriptor(value.energy) &&
    isNumericDescriptor(value.fluency) &&
    isNumericDescriptor(value.lexicalDensity)
  );
}

function isProsodyTrend(value: unknown): value is ProsodyTrend {
  return (
    isRecord(value) &&
    isFiniteNumber(value.pace) &&
    isFiniteNumber(value.energy) &&
    isFiniteNumber(value.fluency) &&
    isFiniteNumber(value.lexicalDensity)
  );
}

function isLearnedTerm(value: unknown): value is LearnedVocabularyTerm {
  return (
    isRecord(value) &&
    typeof value.canonical === 'string' && value.canonical.length > 0 &&
    typeof value.preferred === 'string' && value.preferred.length > 0 &&
    isPositiveInteger(value.count) &&
    isPositiveInteger(value.documentCount) &&
    value.documentCount <= value.count
  );
}

function isLearnedPhrase(value: unknown): value is LearnedPhrase {
  return (
    isRecord(value) &&
    (value.size === 2 || value.size === 3) &&
    isLearnedTerm(value)
  );
}

/** Runtime gate used by local persistence. Unknown future versions are rejected safely. */
export function isVoiceProfile(value: unknown): value is VoiceProfile {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== VOICE_PROFILE_SCHEMA_VERSION ||
    value.algorithmVersion !== VOICE_PROFILE_ALGORITHM_VERSION ||
    !isNonNegativeInteger(value.updatedAt)
  ) return false;

  const privacy = value.privacy;
  const source = value.source;
  const settings = value.settings;
  const vocabulary = value.vocabulary;
  const prosody = value.prosody;

  return (
    isRecord(privacy) &&
    privacy.storageScope === 'device-local' &&
    privacy.networkAccess === 'none' &&
    privacy.rawAudioStored === false &&
    privacy.derivedTextStored === true &&
    isRecord(source) &&
    isNonNegativeInteger(source.entryCount) &&
    isNonNegativeInteger(source.transcriptEntryCount) &&
    isNonNegativeInteger(source.prosodyEntryCount) &&
    source.transcriptEntryCount <= source.entryCount &&
    isRecord(settings) &&
    isNonNegativeInteger(settings.maxVocabularyTerms) &&
    isNonNegativeInteger(settings.maxPhrases) &&
    Array.isArray(settings.phraseSizes) &&
    settings.phraseSizes.every((size) => size === 2 || size === 3) &&
    isPositiveInteger(settings.rollingWindowEntries) &&
    isRecord(vocabulary) &&
    isNonNegativeInteger(vocabulary.tokenCount) &&
    isNonNegativeInteger(vocabulary.uniqueTermCount) &&
    typeof vocabulary.termsTruncated === 'boolean' &&
    Array.isArray(vocabulary.terms) &&
    vocabulary.terms.every(isLearnedTerm) &&
    isNonNegativeInteger(vocabulary.phraseCount) &&
    isNonNegativeInteger(vocabulary.uniquePhraseCount) &&
    typeof vocabulary.phrasesTruncated === 'boolean' &&
    Array.isArray(vocabulary.phrases) &&
    vocabulary.phrases.every(isLearnedPhrase) &&
    isRecord(prosody) &&
    (prosody.lifetime === null || isProsodyDescriptor(prosody.lifetime)) &&
    (prosody.rolling === null || isProsodyDescriptor(prosody.rolling)) &&
    (prosody.trend === null || isProsodyTrend(prosody.trend))
  );
}

/** Migration boundary for persisted profiles; add older-version transforms here. */
export function migrateVoiceProfile(value: unknown): VoiceProfile | null {
  return isVoiceProfile(value) ? value : null;
}
