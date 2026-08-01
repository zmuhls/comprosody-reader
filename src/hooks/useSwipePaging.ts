import { useEffect, type RefObject } from 'react';
import type { Entry, Directory } from '../types/editor';

/**
 * The paging sequence is unattached writing entries sharing a container:
 * book chapters in their manual order, folder/root siblings alphabetically.
 * Notes never page — they are margins, not pages.
 */
export function getPagingSiblings(
  entryId: string,
  entries: Record<string, Entry>,
  directories: Record<string, Directory>
): { prev: string | null; next: string | null } {
  const entry = entries[entryId];
  if (!entry || entry.kind !== 'writing' || entry.attachedToId !== undefined) {
    return { prev: null, next: null };
  }

  const parent =
    entry.parentId !== null ? directories[entry.parentId] : undefined;
  const siblings = Object.values(entries)
    .filter(
      (e) =>
        e.parentId === entry.parentId &&
        e.kind === 'writing' &&
        e.attachedToId === undefined
    )
    .sort(
      parent?.kind === 'book'
        ? (a, b) => a.order - b.order || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name)
    );

  const index = siblings.findIndex((e) => e.id === entryId);
  return {
    prev: index > 0 ? siblings[index - 1].id : null,
    next:
      index !== -1 && index < siblings.length - 1
        ? siblings[index + 1].id
        : null,
  };
}

interface SwipeOptions {
  onPrev: () => void;
  onNext: () => void;
  enabled: boolean;
}

/**
 * Horizontal swipe paging on touch pointers only: 60px threshold, mostly
 * horizontal (|dx| > 2|dy|), and never while text is selected.
 */
export function useSwipePaging(
  ref: RefObject<HTMLElement | null>,
  { onPrev, onNext, enabled }: SwipeOptions
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking || e.pointerType !== 'touch') return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (dx > 0) onPrev();
      else onNext();
    };

    const onPointerCancel = () => {
      tracking = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [ref, onPrev, onNext, enabled]);
}
