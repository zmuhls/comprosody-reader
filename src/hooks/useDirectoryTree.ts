import { useMemo } from 'react';
import type { Entry, Directory, DirectoryKind } from '../types/editor';

export interface TreeNode {
  type: 'directory' | 'entry';
  id: string;
  name: string;
  parentId: string | null;
  /** Directories: child nodes. Entries: attached margin notes. */
  children: TreeNode[];
  entry?: Entry;
  directoryKind?: DirectoryKind;
  /** 1-based position among a book's unattached writing entries. */
  chapterNumber?: number;
}

export function useDirectoryTree(
  directories: Record<string, Directory>,
  entries: Record<string, Entry>,
  query = ''
): TreeNode[] {
  return useMemo(() => {
    return buildTree(null, directories, entries, query);
  }, [directories, entries, query]);
}

function entryMatches(entry: Entry, needle: string): boolean {
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.rawTranscript.toLowerCase().includes(needle) ||
    entry.refinedText.toLowerCase().includes(needle)
  );
}

function noteNode(note: Entry): TreeNode {
  return {
    type: 'entry',
    id: note.id,
    name: note.name,
    parentId: note.parentId,
    children: [],
    entry: note,
  };
}

export function buildTree(
  parentId: string | null,
  directories: Record<string, Directory>,
  entries: Record<string, Entry>,
  query = ''
): TreeNode[] {
  const needle = query.trim().toLowerCase();
  const parentKind: DirectoryKind | null =
    parentId !== null ? (directories[parentId]?.kind ?? 'folder') : null;

  // Directories at this level, alphabetical; when filtering keep only
  // subtrees that still contain a match.
  const dirNodes: TreeNode[] = [];
  for (const dir of Object.values(directories)) {
    if (dir.parentId !== parentId) continue;
    const children = buildTree(dir.id, directories, entries, query);
    if (needle !== '' && children.length === 0) continue;
    dirNodes.push({
      type: 'directory',
      id: dir.id,
      name: dir.name,
      parentId: dir.parentId,
      children,
      directoryKind: dir.kind,
    });
  }
  dirNodes.sort((a, b) => a.name.localeCompare(b.name));

  // Entries at this level: attached notes nest under their target when the
  // target renders here too; anything else (including orphaned notes) is a row.
  const level = Object.values(entries).filter((e) => e.parentId === parentId);
  const attachedByTarget = new Map<string, Entry[]>();
  const placed: Entry[] = [];
  for (const entry of level) {
    const target =
      entry.kind === 'note' && entry.attachedToId !== undefined
        ? entries[entry.attachedToId]
        : undefined;
    if (target && target.parentId === parentId) {
      const group = attachedByTarget.get(target.id) ?? [];
      group.push(entry);
      attachedByTarget.set(target.id, group);
    } else {
      placed.push(entry);
    }
  }

  placed.sort(
    parentKind === 'book'
      ? (a, b) => a.order - b.order || a.name.localeCompare(b.name)
      : (a, b) => a.name.localeCompare(b.name)
  );

  const entryNodes: TreeNode[] = [];
  let chapter = 0;
  for (const entry of placed) {
    // Chapter numbers come from the unfiltered sequence so a search never
    // renumbers the book.
    const isChapter = parentKind === 'book' && entry.kind === 'writing';
    if (isChapter) chapter += 1;

    const notes = (attachedByTarget.get(entry.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const matchesSelf = needle === '' || entryMatches(entry, needle);
    const matchingNotes =
      needle === '' ? notes : notes.filter((n) => entryMatches(n, needle));
    if (needle !== '' && !matchesSelf && matchingNotes.length === 0) continue;

    const visibleNotes = needle === '' || matchesSelf ? notes : matchingNotes;
    const node: TreeNode = {
      type: 'entry',
      id: entry.id,
      name: entry.name,
      parentId: entry.parentId,
      children: visibleNotes.map(noteNode),
      entry,
    };
    if (isChapter) node.chapterNumber = chapter;
    entryNodes.push(node);
  }

  return [...dirNodes, ...entryNodes];
}
