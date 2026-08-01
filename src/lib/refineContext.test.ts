import { buildRefineContext, REFINE_CONTEXT_CAP } from './refineContext';
import { buildSystemPrompt } from './prompts';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry, Directory } from '../types/editor';
import type { RefinementSettings } from '../types/llm';

function makeEntry(id: string, parentId: string | null, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    name: id,
    parentId,
    kind: 'writing',
    order: 0,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const book: Record<string, Directory> = {
  book: { id: 'book', name: 'Field Book', parentId: null, kind: 'book' },
};

describe('buildRefineContext', () => {
  it('returns empty for a rootless entry with no notes', () => {
    const entries = { solo: makeEntry('solo', null) };
    expect(buildRefineContext('solo', entries, {})).toBe('');
  });

  it('describes book position and both neighbors with first sentences', () => {
    const entries = {
      ch1: makeEntry('ch1', 'book', {
        name: 'Morning walk',
        order: 0,
        refinedText: 'The hedgerow was rimed with frost. More text follows.',
      }),
      ch2: makeEntry('ch2', 'book', { name: 'On hedgerows', order: 1 }),
      ch3: makeEntry('ch3', 'book', {
        name: 'Riverbank draft',
        order: 2,
        rawTranscript: 'Water ran high after the rain! And on and on.',
      }),
    };
    const context = buildRefineContext('ch2', entries, book);
    expect(context).toContain('chapter 2 of 3 in "Field Book"');
    expect(context).toContain('1. "Morning walk" — The hedgerow was rimed with frost.');
    expect(context).toContain('3. "Riverbank draft" — Water ran high after the rain!');
    expect(context).toContain('guidance, not text to reproduce');
  });

  it('includes attached notes but skips excluded ones', () => {
    const entries = {
      host: makeEntry('host', null),
      keep: makeEntry('keep', null, {
        kind: 'note',
        name: 'tone note',
        attachedToId: 'host',
        refinedText: 'Keep it wry.',
      }),
      skip: makeEntry('skip', null, {
        kind: 'note',
        name: 'private',
        attachedToId: 'host',
        refinedText: 'Do not use this.',
        includeInRefinement: false,
      }),
    };
    const context = buildRefineContext('host', entries, {});
    expect(context).toContain('"tone note": Keep it wry.');
    expect(context).not.toContain('Do not use this.');
  });

  it('caps output, truncating notes before the book line', () => {
    const entries = {
      ch1: makeEntry('ch1', 'book', { name: 'Alpha', order: 0 }),
      ch2: makeEntry('ch2', 'book', { name: 'Beta', order: 1 }),
      note: makeEntry('note', 'book', {
        kind: 'note',
        name: 'sprawl',
        attachedToId: 'ch2',
        refinedText: 'x'.repeat(3000),
      }),
    };
    const context = buildRefineContext('ch2', entries, book);
    expect(context.length).toBeLessThanOrEqual(REFINE_CONTEXT_CAP);
    expect(context).toContain('chapter 2 of 2 in "Field Book"');
  });
});

describe('buildSystemPrompt context parameter', () => {
  const settings: RefinementSettings = {
    genre: 'freewrite',
    scale: 'sentence',
    temperature: 0.5,
  };

  it('is byte-identical without context', () => {
    const bare = buildSystemPrompt(settings, defaultProsody, defaultVoiceConfig);
    expect(buildSystemPrompt(settings, defaultProsody, defaultVoiceConfig, '')).toBe(bare);
    expect(
      buildSystemPrompt(settings, defaultProsody, defaultVoiceConfig, undefined)
    ).toBe(bare);
  });

  it('keeps the output-format instruction last when context is present', () => {
    const withContext = buildSystemPrompt(
      settings,
      defaultProsody,
      defaultVoiceConfig,
      'SURROUNDING WORK (guidance, not text to reproduce):\nThis passage is chapter 1 of 2 in "Field Book".'
    );
    expect(withContext).toContain('SURROUNDING WORK');
    const lastLine = withContext.trimEnd().split('\n').at(-1);
    expect(lastLine).toContain('Return only the refined text');
  });
});
