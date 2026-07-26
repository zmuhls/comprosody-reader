import { useMemo } from 'react';
import type { Entry, Directory } from '../types/editor';

export interface TreeNode {
  type: 'directory' | 'entry';
  id: string;
  name: string;
  parentId: string | null;
  children: TreeNode[];
  entry?: Entry;
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

export function buildTree(
  parentId: string | null,
  directories: Record<string, Directory>,
  entries: Record<string, Entry>,
  query = ''
): TreeNode[] {
  const needle = query.trim().toLowerCase();
  const nodes: TreeNode[] = [];

  // Add directories at this level; when filtering, keep only subtrees with matches
  for (const dir of Object.values(directories)) {
    if (dir.parentId !== parentId) continue;
    const children = buildTree(dir.id, directories, entries, query);
    if (needle !== '' && children.length === 0) continue;
    nodes.push({
      type: 'directory',
      id: dir.id,
      name: dir.name,
      parentId: dir.parentId,
      children,
    });
  }

  // Add entries at this level
  for (const entry of Object.values(entries)) {
    if (entry.parentId !== parentId) continue;
    if (needle !== '' && !entryMatches(entry, needle)) continue;
    nodes.push({
      type: 'entry',
      id: entry.id,
      name: entry.name,
      parentId: entry.parentId,
      children: [],
      entry,
    });
  }

  // Sort: directories first, then entries, alphabetically within each group
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}
