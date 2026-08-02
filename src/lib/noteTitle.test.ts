import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';
import {
  automaticTitleCandidate,
  fallbackNoteTitle,
  hasManualNoteTitle,
  normalizeAutomaticNoteTitle,
  noteTitleBasis,
} from './noteTitle';

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'note-1',
    name: 'Untitled',
    parentId: null,
    rawTranscript: '',
    refinedText: 'Public memory is shaped by archival absence and return.',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('automatic note titles', () => {
  it('normalizes a model response into a compact title', () => {
    expect(
      normalizeAutomaticNoteTitle('Title: “Archival Absence and Public Memory.”\nExplanation'),
    ).toBe('Archival Absence and Public Memory');
    expect(
      normalizeAutomaticNoteTitle(
        'This title contains far too many words to remain useful in the note directory',
      ).split(' '),
    ).toHaveLength(8);
  });

  it('creates a deterministic local fallback before the agent responds', () => {
    const source = '**Public memory** changes through archival return. More follows.';
    expect(fallbackNoteTitle(source)).toBe(
      'Public memory changes through archival return',
    );
    expect(noteTitleBasis(source)).toBe(noteTitleBasis(source));
  });

  it('retries only when an automatically titled note changes materially', () => {
    const source = entry().refinedText;
    const basis = noteTitleBasis(source);
    expect(
      automaticTitleCandidate(entry({ titleSource: 'agent', titleBasis: basis })),
    ).toBeNull();
    expect(
      automaticTitleCandidate(
        entry({
          refinedText: `${source} A new section changes its subject.`,
          titleSource: 'agent',
          titleBasis: basis,
        }),
      ),
    ).not.toBeNull();
  });

  it('never overwrites a title the reader chose', () => {
    const manuallyNamed = entry({ name: 'My archive claim', titleSource: 'manual' });
    expect(hasManualNoteTitle(manuallyNamed)).toBe(true);
    expect(automaticTitleCandidate(manuallyNamed)).toBeNull();
  });
});
