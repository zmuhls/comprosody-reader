import type { TreeNode } from '../../hooks/useDirectoryTree';
import type { Directory } from '../../types/editor';
import { isDescendantDirectory } from '../../context/AppContext';

export const DRAG_MIME = 'application/x-comprosody';

export interface DragPayload {
  nodeType: 'entry' | 'directory';
  id: string;
}

export type DropIntent =
  | { kind: 'into'; parentId: string | null }
  | { kind: 'before'; beforeId: string; parentId: string }
  | { kind: 'none' };

// dataTransfer.getData() is empty during dragover by spec; drags never leave
// this window, so a module-scoped mirror carries the payload for hover checks.
let currentDrag: DragPayload | null = null;

export function setCurrentDrag(payload: DragPayload | null): void {
  currentDrag = payload;
}

export function getCurrentDrag(): DragPayload | null {
  return currentDrag;
}

export function encodeDrag(payload: DragPayload): string {
  return JSON.stringify(payload);
}

export function decodeDrag(dt: DataTransfer): DragPayload | null {
  try {
    const raw = dt.getData(DRAG_MIME);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as DragPayload).id === 'string' &&
      ((parsed as DragPayload).nodeType === 'entry' ||
        (parsed as DragPayload).nodeType === 'directory')
    ) {
      return { nodeType: (parsed as DragPayload).nodeType, id: (parsed as DragPayload).id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Translate a hover position over a row into what dropping there would mean.
 * Zones divide the row into vertical thirds; only book chapters use the
 * top/bottom zones (folders sort themselves, so position is meaningless).
 */
export function resolveDropIntent(
  payload: DragPayload,
  target: TreeNode,
  zone: 'top' | 'middle' | 'bottom',
  directories: Record<string, Directory>
): DropIntent {
  if (payload.id === target.id) return { kind: 'none' };

  if (target.type === 'directory') {
    if (payload.nodeType === 'directory') {
      if (
        target.id === payload.id ||
        isDescendantDirectory(directories, target.id, payload.id)
      ) {
        return { kind: 'none' };
      }
    }
    return { kind: 'into', parentId: target.id };
  }

  // Entry rows.
  if (target.entry?.kind === 'note') return { kind: 'none' };

  const parentIsBook =
    target.parentId !== null && directories[target.parentId]?.kind === 'book';

  if (parentIsBook && payload.nodeType === 'entry' && target.parentId !== null) {
    if (zone === 'top') {
      return { kind: 'before', beforeId: target.id, parentId: target.parentId };
    }
    if (zone === 'bottom') {
      return target.nextSiblingId !== undefined
        ? { kind: 'before', beforeId: target.nextSiblingId, parentId: target.parentId }
        : { kind: 'into', parentId: target.parentId };
    }
    return { kind: 'into', parentId: target.parentId };
  }

  if (payload.nodeType === 'directory') {
    // Dropping a folder onto a chapter row has no sensible meaning.
    if (parentIsBook) return { kind: 'none' };
    return { kind: 'into', parentId: target.parentId };
  }

  return { kind: 'into', parentId: target.parentId };
}
