import { getPagingSiblings } from './useSwipePaging';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { Entry, Directory } from '../types/editor';

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

describe('getPagingSiblings', () => {
  it('pages book chapters in order, not name order', () => {
    const entries = {
      za: makeEntry('za', 'book', { name: 'Aardvark', order: 2 }),
      zb: makeEntry('zb', 'book', { name: 'Zebra', order: 0 }),
      zc: makeEntry('zc', 'book', { name: 'Meerkat', order: 1 }),
    };
    expect(getPagingSiblings('zc', entries, book)).toEqual({ prev: 'zb', next: 'za' });
  });

  it('pages folder siblings alphabetically', () => {
    const entries = {
      a: makeEntry('a', null, { name: 'Alpha', order: 9 }),
      b: makeEntry('b', null, { name: 'Beta', order: 0 }),
    };
    expect(getPagingSiblings('a', entries, {})).toEqual({ prev: null, next: 'b' });
  });

  it('skips notes and attached entries in the sequence', () => {
    const entries = {
      ch1: makeEntry('ch1', 'book', { order: 0 }),
      note: makeEntry('note', 'book', { kind: 'note', order: 1 }),
      pinned: makeEntry('pinned', 'book', {
        kind: 'note',
        order: 2,
        attachedToId: 'ch1',
      }),
      ch2: makeEntry('ch2', 'book', { order: 3 }),
    };
    expect(getPagingSiblings('ch1', entries, book)).toEqual({ prev: null, next: 'ch2' });
  });

  it('returns nulls at the ends and for notes themselves', () => {
    const entries = {
      solo: makeEntry('solo', null),
      note: makeEntry('note', null, { kind: 'note' }),
    };
    expect(getPagingSiblings('solo', entries, {})).toEqual({ prev: null, next: null });
    expect(getPagingSiblings('note', entries, {})).toEqual({ prev: null, next: null });
  });
});
