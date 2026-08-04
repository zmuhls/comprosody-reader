import { resolveDropIntent, encodeDrag, decodeDrag, DRAG_MIME } from './dnd';
import { defaultProsody, defaultVoiceConfig } from '../../types/audio';
import type { TreeNode } from '../../hooks/useDirectoryTree';
import type { Entry, Directory } from '../../types/editor';

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

const directories: Record<string, Directory> = {
  book: { id: 'book', name: 'book', parentId: null, kind: 'book' },
  folder: { id: 'folder', name: 'folder', parentId: null, kind: 'folder' },
  nested: { id: 'nested', name: 'nested', parentId: 'folder', kind: 'folder' },
};

function dirNode(id: string, kind: Directory['kind']): TreeNode {
  return {
    type: 'directory',
    id,
    name: id,
    parentId: directories[id]?.parentId ?? null,
    children: [],
    directoryKind: kind,
  };
}

function entryNode(entry: Entry, extras: Partial<TreeNode> = {}): TreeNode {
  return {
    type: 'entry',
    id: entry.id,
    name: entry.name,
    parentId: entry.parentId,
    children: [],
    entry,
    ...extras,
  };
}

describe('resolveDropIntent', () => {
  it('drops into a container from its middle zone', () => {
    const intent = resolveDropIntent(
      { nodeType: 'entry', id: 'e1' },
      dirNode('folder', 'folder'),
      'middle',
      directories
    );
    expect(intent).toEqual({ kind: 'into', parentId: 'folder' });
  });

  it('refuses a directory dropped into its own descendant', () => {
    const intent = resolveDropIntent(
      { nodeType: 'directory', id: 'folder' },
      dirNode('nested', 'folder'),
      'middle',
      directories
    );
    expect(intent).toEqual({ kind: 'none' });
  });

  it('orders before a chapter from its top zone inside a book', () => {
    const target = entryNode(makeEntry('ch2', 'book', { order: 1 }), { chapterNumber: 2 });
    const intent = resolveDropIntent(
      { nodeType: 'entry', id: 'ch9' },
      target,
      'top',
      directories
    );
    expect(intent).toEqual({ kind: 'before', beforeId: 'ch2', parentId: 'book' });
  });

  it('bottom zone inside a book means before the next sibling (into parent when last)', () => {
    const target = entryNode(makeEntry('ch2', 'book', { order: 1 }), {
      chapterNumber: 2,
      nextSiblingId: 'ch3',
    });
    expect(
      resolveDropIntent({ nodeType: 'entry', id: 'ch9' }, target, 'bottom', directories)
    ).toEqual({ kind: 'before', beforeId: 'ch3', parentId: 'book' });

    const last = entryNode(makeEntry('ch4', 'book', { order: 3 }), { chapterNumber: 4 });
    expect(
      resolveDropIntent({ nodeType: 'entry', id: 'ch9' }, last, 'bottom', directories)
    ).toEqual({ kind: 'into', parentId: 'book' });
  });

  it('an entry row outside a book resolves to its parent container', () => {
    const target = entryNode(makeEntry('loose', 'folder'));
    expect(
      resolveDropIntent({ nodeType: 'entry', id: 'e9' }, target, 'middle', directories)
    ).toEqual({ kind: 'into', parentId: 'folder' });
  });

  it('rejects self-drops and drops onto note rows', () => {
    const noteTarget = entryNode(makeEntry('n1', 'folder', { kind: 'note' }));
    expect(
      resolveDropIntent({ nodeType: 'entry', id: 'e1' }, noteTarget, 'middle', directories)
    ).toEqual({ kind: 'none' });
    expect(
      resolveDropIntent(
        { nodeType: 'entry', id: 'same' },
        entryNode(makeEntry('same', null)),
        'middle',
        directories
      )
    ).toEqual({ kind: 'none' });
  });

  it('directories dropped onto book chapters resolve to none', () => {
    const target = entryNode(makeEntry('ch1', 'book', { order: 0 }), { chapterNumber: 1 });
    expect(
      resolveDropIntent({ nodeType: 'directory', id: 'folder' }, target, 'top', directories)
    ).toEqual({ kind: 'none' });
  });
});

// jsdom has no DataTransfer constructor; decodeDrag only reads getData.
function fakeDataTransfer(data: Record<string, string>): DataTransfer {
  return { getData: (type: string) => data[type] ?? '' } as unknown as DataTransfer;
}

describe('drag payload encoding', () => {
  it('round-trips through a DataTransfer', () => {
    const dt = fakeDataTransfer({
      [DRAG_MIME]: encodeDrag({ nodeType: 'entry', id: 'e1' }),
    });
    expect(decodeDrag(dt)).toEqual({ nodeType: 'entry', id: 'e1' });
  });

  it('returns null for garbage payloads', () => {
    expect(decodeDrag(fakeDataTransfer({ [DRAG_MIME]: 'not json{' }))).toBeNull();
    expect(decodeDrag(fakeDataTransfer({}))).toBeNull();
    expect(
      decodeDrag(fakeDataTransfer({ [DRAG_MIME]: '{"nodeType":"zebra","id":"x"}' }))
    ).toBeNull();
  });
});
