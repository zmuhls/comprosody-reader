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
  entries: Record<string, Entry>
): TreeNode[] {
  return useMemo(() => {
    return buildTree(null, directories, entries);
  }, [directories, entries]);
}

export function buildTree(
  parentId: string | null,
  directories: Record<string, Directory>,
  entries: Record<string, Entry>
): TreeNode[] {
  const nodes: TreeNode[] = [];

  // Add directories at this level
  for (const dir of Object.values(directories)) {
    if (dir.parentId === parentId) {
      nodes.push({
        type: 'directory',
        id: dir.id,
        name: dir.name,
        parentId: dir.parentId,
        children: buildTree(dir.id, directories, entries),
      });
    }
  }

  // Add entries at this level
  for (const entry of Object.values(entries)) {
    if (entry.parentId === parentId) {
      nodes.push({
        type: 'entry',
        id: entry.id,
        name: entry.name,
        parentId: entry.parentId,
        children: [],
        entry,
      });
    }
  }

  // Sort: directories first, then entries, alphabetically within each group
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}
