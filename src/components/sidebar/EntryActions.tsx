import { useState, useRef, useEffect } from 'react';
import { useStorage } from '../../hooks/useStorage';

const TEXT_ACTION =
  'px-1 py-1 text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:text-accent';

export function EntryActions() {
  const { entries, activeEntryId, createEntry, createDirectory } = useStorage();
  const [containerMenuOpen, setContainerMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // New items land beside whatever the writer is working in.
  const parentId = activeEntryId
    ? (entries[activeEntryId]?.parentId ?? null)
    : null;

  useEffect(() => {
    if (!containerMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContainerMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [containerMenuOpen]);

  return (
    <div className="flex items-center border-b border-border px-3 py-2">
      <button
        onClick={() => createEntry(parentId)}
        className={`${TEXT_ACTION} text-accent`}
        title="New writing entry"
      >
        + entry
      </button>
      <span className="px-1 text-text-muted/40">·</span>
      <button
        onClick={() => createEntry(parentId, 'note')}
        className={TEXT_ACTION}
        title="New note"
      >
        + note
      </button>
      <span className="px-1 text-text-muted/40">·</span>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setContainerMenuOpen((open) => !open)}
          className={TEXT_ACTION}
          title="New container"
          aria-haspopup="menu"
          aria-expanded={containerMenuOpen}
        >
          +▾
        </button>
        {containerMenuOpen && (
          <div
            className="absolute left-0 top-full z-20 mt-1 min-w-32 border border-border bg-surface-overlay py-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
            role="menu"
          >
            <button
              className="block w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:bg-surface-writing hover:text-text-primary"
              onClick={() => {
                createDirectory(parentId, 'New Folder');
                setContainerMenuOpen(false);
              }}
              role="menuitem"
            >
              folder
            </button>
            <button
              className="block w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:bg-surface-writing hover:text-text-primary"
              onClick={() => {
                createDirectory(parentId, 'New Book', 'book');
                setContainerMenuOpen(false);
              }}
              role="menuitem"
            >
              𝄃 book
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
