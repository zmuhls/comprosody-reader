import { STORAGE_KEYS } from '../constants';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';
import {
  VOICE_PROFILE_ALGORITHM_VERSION,
  VOICE_PROFILE_SCHEMA_VERSION,
  buildVoiceProfile,
  hasObservedProsody,
  isVoiceProfile,
  migrateVoiceProfile,
  removeVoiceProfileEntry,
  selectTranscriptionHints,
  tokenizeVoiceVocabulary,
  upsertVoiceProfileEntry,
} from './voiceProfile';
import {
  clearVoiceProfile,
  loadVoiceProfile,
  saveVoiceProfile,
} from './storage';

function makeEntry(
  id: string,
  rawTranscript: string,
  updatedAt: number,
  overrides: Partial<Entry> = {}
): Entry {
  return {
    id,
    name: id,
    parentId: null,
    rawTranscript,
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

describe('tokenizeVoiceVocabulary', () => {
  it('normalizes Unicode apostrophes/dashes while preserving useful surface forms', () => {
    expect(tokenizeVoiceVocabulary("Édouard’s media–archaeology, AI")).toEqual([
      { canonical: "édouard's", surface: "Édouard's" },
      { canonical: 'media-archaeology', surface: 'media-archaeology' },
      { canonical: 'ai', surface: 'AI' },
    ]);
  });
});

describe('buildVoiceProfile', () => {
  it('learns vocabulary and contiguous phrases from raw transcripts only', () => {
    const entries = {
      first: makeEntry('first', 'Foucault archive Foucault', 10, {
        refinedText: 'Synthetic prose must not enter the vocabulary.',
      }),
      second: makeEntry('second', 'foucault archive', 20),
    };

    const profile = buildVoiceProfile(entries);
    expect(profile.source).toEqual({
      entryCount: 2,
      transcriptEntryCount: 2,
      prosodyEntryCount: 0,
    });
    expect(profile.vocabulary.tokenCount).toBe(5);
    expect(profile.vocabulary.uniqueTermCount).toBe(2);
    expect(profile.vocabulary.terms).toEqual([
      { canonical: 'foucault', preferred: 'Foucault', count: 3, documentCount: 2 },
      { canonical: 'archive', preferred: 'archive', count: 2, documentCount: 2 },
    ]);
    expect(profile.vocabulary.phraseCount).toBe(4);
    expect(profile.vocabulary.phrases).toContainEqual({
      canonical: 'foucault archive',
      preferred: 'Foucault archive',
      size: 2,
      count: 2,
      documentCount: 2,
    });
    expect(profile.vocabulary.terms.some((term) => term.canonical === 'synthetic')).toBe(false);
  });

  it('is independent of record insertion order and wall-clock time', () => {
    const early = makeEntry('early', 'archive dialectic', 100);
    const late = makeEntry('late', 'dialectic archive', 200);

    const left = buildVoiceProfile({ late, early });
    const right = buildVoiceProfile({ early, late });

    expect(left).toEqual(right);
    expect(left.updatedAt).toBe(200);
  });

  it('uses stable ranking and reports bounded-list truncation', () => {
    const profile = buildVoiceProfile(
      { one: makeEntry('one', 'beta alpha gamma', 1) },
      { maxVocabularyTerms: 2, maxPhrases: 1, phraseSizes: [2] }
    );

    expect(profile.vocabulary.terms.map((term) => term.canonical)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(profile.vocabulary.uniqueTermCount).toBe(3);
    expect(profile.vocabulary.termsTruncated).toBe(true);
    expect(profile.vocabulary.phrases.map((phrase) => phrase.canonical)).toEqual([
      'alpha gamma',
    ]);
    expect(profile.vocabulary.phrasesTruncated).toBe(true);
  });

  it('computes lifetime and rolling prosody descriptors chronologically', () => {
    const entries = {
      newest: makeEntry('newest', 'third thought', 300, {
        prosody: { pace: 180, energy: 0.8, fluency: 0.9, lexicalDensity: 0.7 },
      }),
      oldest: makeEntry('oldest', 'first thought', 100, {
        prosody: { pace: 100, energy: 0.2, fluency: 0.5, lexicalDensity: 0.3 },
      }),
      middle: makeEntry('middle', 'second thought', 200, {
        prosody: { pace: 140, energy: 0.5, fluency: 0.7, lexicalDensity: 0.5 },
      }),
    };

    const profile = buildVoiceProfile(entries, { rollingWindowEntries: 2 });
    const lifetime = profile.prosody.lifetime;
    const rolling = profile.prosody.rolling;

    expect(lifetime?.sampleCount).toBe(3);
    expect(lifetime?.pace.mean).toBe(140);
    expect(lifetime?.pace.standardDeviation).toBeCloseTo(32.66, 2);
    expect(lifetime?.pace).toMatchObject({ min: 100, max: 180, latest: 180 });
    expect(rolling?.sampleCount).toBe(2);
    expect(rolling?.pace.mean).toBe(160);
    expect(rolling?.energy.mean).toBeCloseTo(0.65);
    expect(profile.prosody.trend?.pace).toBe(20);
    expect(profile.prosody.trend?.energy).toBeCloseTo(0.15);
  });

  it('counts bounded recording observations rather than treating a note as one session', () => {
    const profile = buildVoiceProfile({
      note: makeEntry('note', 'two recorded passages', 300, {
        prosody: { pace: 160, energy: 0.7, fluency: 0.8, lexicalDensity: 0.6 },
        prosodyHistory: [
          {
            capturedAt: 100,
            metrics: { pace: 100, energy: 0.3, fluency: 0.6, lexicalDensity: 0.4 },
          },
          {
            capturedAt: 200,
            metrics: { pace: 180, energy: 0.7, fluency: 0.8, lexicalDensity: 0.6 },
          },
        ],
      }),
    });

    expect(profile.source.prosodyEntryCount).toBe(2);
    expect(profile.prosody.lifetime?.sampleCount).toBe(2);
    expect(profile.prosody.lifetime?.pace).toMatchObject({
      mean: 140,
      latest: 180,
    });
  });

  it('does not treat placeholder, invalid, or transcript-less prosody as observations', () => {
    const profile = buildVoiceProfile({
      placeholder: makeEntry('placeholder', 'not recorded yet', 1),
      invalid: makeEntry('invalid', 'corrupt metrics', 2, {
        prosody: { pace: 140, energy: 4, fluency: 0.8, lexicalDensity: 0.5 },
      }),
      noTranscript: makeEntry('noTranscript', '', 3, {
        prosody: { pace: 140, energy: 0.4, fluency: 0.8, lexicalDensity: 0.5 },
      }),
    });

    expect(profile.source.prosodyEntryCount).toBe(0);
    expect(profile.prosody).toEqual({ lifetime: null, rolling: null, trend: null });
    expect(hasObservedProsody(defaultProsody)).toBe(false);
  });

  it('does not copy unexpected audio fields into the persisted shape', () => {
    const entryWithAudio = {
      ...makeEntry('one', 'private spoken thought with full context', 1),
      audioBlob: 'RAW_AUDIO_SENTINEL',
    } as Entry & { audioBlob: string };

    const serialized = JSON.stringify(buildVoiceProfile({ one: entryWithAudio }));
    expect(serialized).not.toContain('RAW_AUDIO_SENTINEL');
    expect(serialized).not.toContain('private spoken thought with full context');
  });

  it('returns an explicit, versioned local-only profile when empty', () => {
    const profile = buildVoiceProfile({});
    expect(profile.schemaVersion).toBe(VOICE_PROFILE_SCHEMA_VERSION);
    expect(profile.algorithmVersion).toBe(VOICE_PROFILE_ALGORITHM_VERSION);
    expect(profile.privacy).toEqual({
      storageScope: 'device-local',
      networkAccess: 'none',
      rawAudioStored: false,
      derivedTextStored: true,
    });
    expect(profile.updatedAt).toBe(0);
  });
});

describe('profile updates and queries', () => {
  it('rebuilds safely for entry upserts and removals', () => {
    const existing = makeEntry('existing', 'archive', 1);
    const replacement = makeEntry('existing', 'genealogy genealogy', 2);
    const other = makeEntry('other', 'archive', 3);

    const upserted = upsertVoiceProfileEntry(
      { existing, other },
      replacement,
      { phraseSizes: [2] }
    );
    expect(upserted.source.entryCount).toBe(2);
    expect(upserted.vocabulary.terms).toContainEqual({
      canonical: 'genealogy',
      preferred: 'genealogy',
      count: 2,
      documentCount: 1,
    });
    expect(upserted.vocabulary.terms.find((term) => term.canonical === 'archive')?.count).toBe(1);

    const removed = removeVoiceProfileEntry({ existing, other }, 'existing');
    expect(removed.source.entryCount).toBe(1);
    expect(removed.vocabulary.terms).toEqual([
      { canonical: 'archive', preferred: 'archive', count: 1, documentCount: 1 },
    ]);
  });

  it('selects compact transcription hints and excludes common words by default', () => {
    const profile = buildVoiceProfile({
      one: makeEntry(
        'one',
        'the archive fever archive fever heteroglossia heteroglossia',
        1
      ),
    });

    expect(selectTranscriptionHints(profile, { minPhraseCount: 2 })).toEqual({
      terms: ['archive', 'fever', 'heteroglossia'],
      phrases: ['archive fever'],
    });
    expect(selectTranscriptionHints(profile, {
      maxTerms: 1,
      maxPhrases: 0,
      minTermCount: 1,
      excludeCommonWords: false,
    })).toEqual({ terms: ['archive'], phrases: [] });
  });
});

describe('voice profile persistence', () => {
  afterEach(() => {
    clearVoiceProfile();
  });

  it('round-trips a valid profile through the dedicated localStorage key', () => {
    const profile = buildVoiceProfile({
      one: makeEntry('one', 'media archaeology', 10),
    });

    saveVoiceProfile(profile);
    expect(loadVoiceProfile()).toEqual(profile);
    expect(localStorage.getItem(STORAGE_KEYS.voiceProfile)).not.toBeNull();
    expect(isVoiceProfile(profile)).toBe(true);
    expect(migrateVoiceProfile(profile)).toEqual(profile);
  });

  it('rejects malformed and unknown future versions so they can be rebuilt', () => {
    localStorage.setItem(STORAGE_KEYS.voiceProfile, '{not-json');
    expect(loadVoiceProfile()).toBeNull();

    localStorage.setItem(
      STORAGE_KEYS.voiceProfile,
      JSON.stringify({ schemaVersion: 999, algorithmVersion: 'future' })
    );
    expect(loadVoiceProfile()).toBeNull();
    expect(migrateVoiceProfile({ schemaVersion: 999 })).toBeNull();

    const malformed = buildVoiceProfile({
      one: makeEntry('one', 'archive', 1),
    }) as unknown as { vocabulary: { terms: unknown[] } };
    malformed.vocabulary.terms = [null];
    localStorage.setItem(STORAGE_KEYS.voiceProfile, JSON.stringify(malformed));
    expect(loadVoiceProfile()).toBeNull();
  });
});
