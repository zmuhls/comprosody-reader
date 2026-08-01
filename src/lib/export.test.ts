import { entryToMarkdown, entryToPlainText, slugifyName } from './export';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry } from '../types/editor';

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    name: 'Morning pages',
    parentId: null,
    kind: 'writing',
    order: 0,
    rawTranscript: 'one two three four',
    refinedText: 'One, two, three, four.',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...overrides,
  };
}

describe('slugifyName', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugifyName('Morning Pages!')).toBe('morning-pages');
  });

  it('collapses runs and trims edge hyphens', () => {
    expect(slugifyName('  a -- b  ')).toBe('a-b');
  });

  it('falls back to untitled when nothing survives', () => {
    expect(slugifyName('***')).toBe('untitled');
    expect(slugifyName('')).toBe('untitled');
  });
});

describe('entryToMarkdown', () => {
  it('renders heading, metadata, draft, and transcript sections', () => {
    const md = entryToMarkdown(makeEntry());

    expect(md.startsWith('# Morning pages\n\n')).toBe(true);
    expect(md).toContain('created ');
    expect(md).toContain('4 words');
    expect(md).toContain('## draft\n\nOne, two, three, four.');
    expect(md).toContain('## transcript\n\none two three four');
  });

  it('includes recorded duration only when present', () => {
    const withDuration = entryToMarkdown(
      makeEntry({ recordedDurationMs: 83000 })
    );
    expect(withDuration).toContain('recorded 1:23');

    const without = entryToMarkdown(makeEntry({ recordedDurationMs: 0 }));
    expect(without).not.toContain('recorded ');
  });

  it('omits the draft section when refined text is empty', () => {
    const md = entryToMarkdown(makeEntry({ refinedText: '   ' }));
    expect(md).not.toContain('## draft');
    expect(md).toContain('## transcript');
  });

  it('omits the transcript section when the transcript is empty', () => {
    const md = entryToMarkdown(makeEntry({ rawTranscript: '' }));
    expect(md).not.toContain('## transcript');
    expect(md).toContain('0 words');
  });

  it('keeps only heading and metadata when the entry is empty', () => {
    const md = entryToMarkdown(
      makeEntry({ rawTranscript: '', refinedText: '' })
    );
    expect(md).not.toContain('##');
    expect(md.startsWith('# Morning pages')).toBe(true);
  });
});

describe('entryToPlainText', () => {
  it('uses the refined draft as the body', () => {
    expect(entryToPlainText(makeEntry())).toBe(
      'Morning pages\n\nOne, two, three, four.\n'
    );
  });

  it('falls back to the raw transcript when the draft is empty', () => {
    expect(entryToPlainText(makeEntry({ refinedText: '' }))).toBe(
      'Morning pages\n\none two three four\n'
    );
  });

  it('returns just the name when there is no content', () => {
    expect(
      entryToPlainText(makeEntry({ refinedText: '', rawTranscript: '' }))
    ).toBe('Morning pages\n');
  });
});
