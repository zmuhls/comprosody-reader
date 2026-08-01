import { buildTree } from './useDirectoryTree';
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
    wordCount: 0,
    recordedDurationMs: 0,
    audioTakes: 0,
    draftHistory: [],
    ...overrides,
  };
}

function makeDirectory(
  id: string,
  parentId: string | null,
  kind: Directory['kind'] = 'folder'
): Directory {
  return { id, name: id, parentId, kind };
}

describe('buildTree with books', () => {
  it('orders book children by order, not name', () => {
    const directories = { book: makeDirectory('book', null, 'book') };
    const entries = {
      za: makeEntry('za', 'book', { name: 'Aardvark', order: 2 }),
      zb: makeEntry('zb', 'book', { name: 'Zebra', order: 0 }),
      zc: makeEntry('zc', 'book', { name: 'Meerkat', order: 1 }),
    };
    const [bookNode] = buildTree(null, directories, entries);
    expect(bookNode.children.map((c) => c.id)).toEqual(['zb', 'zc', 'za']);
  });

  it('keeps folder children alphabetical regardless of order', () => {
    const directories = { folder: makeDirectory('folder', null, 'folder') };
    const entries = {
      za: makeEntry('za', 'folder', { name: 'Aardvark', order: 2 }),
      zb: makeEntry('zb', 'folder', { name: 'Zebra', order: 0 }),
    };
    const [folderNode] = buildTree(null, directories, entries);
    expect(folderNode.children.map((c) => c.id)).toEqual(['za', 'zb']);
  });

  it('numbers unattached writing chapters inside books only', () => {
    const directories = {
      book: makeDirectory('book', null, 'book'),
      folder: makeDirectory('folder', null, 'folder'),
    };
    const entries = {
      ch1: makeEntry('ch1', 'book', { order: 0 }),
      note: makeEntry('note', 'book', { kind: 'note', order: 1 }),
      ch2: makeEntry('ch2', 'book', { order: 2 }),
      loose: makeEntry('loose', 'folder'),
    };
    const [bookNode, folderNode] = buildTree(null, directories, entries);
    const numbers = new Map(bookNode.children.map((c) => [c.id, c.chapterNumber]));
    expect(numbers.get('ch1')).toBe(1);
    expect(numbers.get('ch2')).toBe(2);
    expect(numbers.get('note')).toBeUndefined();
    expect(folderNode.children[0].chapterNumber).toBeUndefined();
  });

  it('nests attached notes under their entry, not as siblings', () => {
    const directories = { book: makeDirectory('book', null, 'book') };
    const entries = {
      ch1: makeEntry('ch1', 'book', { order: 0 }),
      note: makeEntry('note', 'book', {
        kind: 'note',
        order: 1,
        attachedToId: 'ch1',
      }),
    };
    const [bookNode] = buildTree(null, directories, entries);
    expect(bookNode.children.map((c) => c.id)).toEqual(['ch1']);
    expect(bookNode.children[0].children.map((c) => c.id)).toEqual(['note']);
  });

  it('renders a note with a missing target as a plain sibling', () => {
    const entries = {
      note: makeEntry('note', null, { kind: 'note', attachedToId: 'gone' }),
    };
    const nodes = buildTree(null, {}, entries);
    expect(nodes.map((n) => n.id)).toEqual(['note']);
  });

  it('keeps the parent entry visible when the query only matches an attached note', () => {
    const entries = {
      host: makeEntry('host', null, { name: 'Host entry' }),
      note: makeEntry('note', null, {
        kind: 'note',
        name: 'unique-needle',
        attachedToId: 'host',
      }),
    };
    const nodes = buildTree(null, {}, entries, 'unique-needle');
    expect(nodes.map((n) => n.id)).toEqual(['host']);
    expect(nodes[0].children.map((c) => c.id)).toEqual(['note']);
  });

  it('exposes directory kind on directory nodes', () => {
    const directories = { book: makeDirectory('book', null, 'book') };
    const [node] = buildTree(null, directories, {});
    expect(node.directoryKind).toBe('book');
  });
});
