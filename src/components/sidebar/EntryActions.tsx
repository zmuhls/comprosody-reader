import { useEffect, useRef, useState } from 'react';
import { useStorage } from '../../hooks/useStorage';
import { Icon } from '../ui/Icon';

interface EntryActionsProps {
  /** Tags anything created here to a publication; omit for free-standing work. */
  publicationId?: string | null;
}

/**
 * Creating writing is the common case, so it leads with a labelled control.
 * Folder and book creation are rare and structural, so they stay folded behind
 * a disclosure rather than occupying the row permanently.
 */
export function EntryActions({ publicationId = null }: EntryActionsProps) {
  const { createEntry, createDirectory } = useStorage();
  const [isStructureOpen, setIsStructureOpen] = useState(false);
  const structureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isStructureOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!structureRef.current?.contains(event.target as Node)) {
        setIsStructureOpen(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [isStructureOpen]);

  return (
    <div className="entry-actions">
      <button
        className="entry-primary-action"
        onClick={() => createEntry(null, 'writing', publicationId)}
        title="New writing"
        type="button"
      >
        <Icon name="plus" size={13} />
        <span>New Writing</span>
      </button>
      <button
        className="entry-primary-action is-secondary"
        onClick={() => createEntry(null, 'note', publicationId)}
        title="New note"
        type="button"
      >
        <Icon name="plus" size={13} />
        <span>New Note</span>
      </button>
      <div className="entry-structure" ref={structureRef}>
        <button
          aria-expanded={isStructureOpen}
          aria-label="Folder and book actions"
          className="icon-button entry-folder-action"
          onClick={() => setIsStructureOpen((open) => !open)}
          title="Folders and books"
          type="button"
        >
          <Icon name="more" size={14} />
        </button>
        {isStructureOpen ? (
          <div className="entry-structure-menu" role="menu">
            <button
              onClick={() => {
                createDirectory(null);
                setIsStructureOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="folder" size={13} />
              <span>New folder</span>
            </button>
            <button
              onClick={() => {
                createDirectory(null, 'New Book', 'book');
                setIsStructureOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="book" size={13} />
              <span>New book</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
