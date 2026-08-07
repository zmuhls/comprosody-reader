import { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useLibrary } from '../../context/LibraryContext';
import { useStorage } from '../../hooks/useStorage';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';
import { Icon } from '../ui/Icon';
import { readingShelfUrl } from '../../lib/libraryApi';
import type { Entry } from '../../types/editor';

interface WorkspaceNavigatorProps {
  /** Dismisses the drawer once a destination is chosen on mobile. */
  onNavigate: () => void;
}

function byRecency(left: Entry, right: Entry): number {
  return right.updatedAt - left.updatedAt;
}

/**
 * One navigator for both halves of the workspace. Books and the writing they
 * hold live in a single scroll container so a growing shelf no longer competes
 * with the note tree for vertical space, and every book carries its own
 * writing rather than sharing one globally-active entry.
 */
export function WorkspaceNavigator({ onNavigate }: WorkspaceNavigatorProps) {
  const { state } = useApp();
  const { setActiveEntry, createEntry } = useStorage();
  const {
    activePublication,
    catalog,
    error,
    isLoading,
    openPublication,
    refresh,
  } = useLibrary();
  const [expandedId, setExpandedId] = useState<string | null>(
    activePublication?.id ?? null,
  );
  const [lastPublicationId, setLastPublicationId] = useState<string | null>(
    activePublication?.id ?? null,
  );

  // Opening a book reveals its writing without burying the rest of the shelf.
  // Adjusted during render rather than in an effect so the disclosure never
  // paints closed for a frame before snapping open.
  if (activePublication && activePublication.id !== lastPublicationId) {
    setLastPublicationId(activePublication.id);
    setExpandedId(activePublication.id);
  }

  const scopedEntries = useMemo(() => {
    const grouped = new Map<string, Entry[]>();
    for (const entry of Object.values(state.entries)) {
      if (!entry.publicationId) continue;
      const group = grouped.get(entry.publicationId) ?? [];
      group.push(entry);
      grouped.set(entry.publicationId, group);
    }
    for (const group of grouped.values()) group.sort(byRecency);
    return grouped;
  }, [state.entries]);

  const openEntry = (id: string) => {
    setActiveEntry(id);
    onNavigate();
  };

  return (
    <div className="workspace-navigator">
      <section
        aria-busy={isLoading}
        aria-labelledby="library-section-label"
        className="library-section"
      >
        <div className="sidebar-section-heading">
          <h2 id="library-section-label">Books</h2>
          <a href={readingShelfUrl()} title="Open the full reading shelf">
            Shelf
          </a>
        </div>

        {isLoading ? (
          <p aria-live="polite" className="library-status" role="status">
            Opening shelf…
          </p>
        ) : error ? (
          <div className="library-status">
            <p role="alert">{error}</p>
            <button onClick={() => void refresh()} type="button">
              Retry
            </button>
          </div>
        ) : catalog.length > 0 ? (
          <div className="library-list">
            {catalog.map((publication) => {
              const isActive = activePublication?.id === publication.id;
              const isExpanded = expandedId === publication.id;
              const writing = scopedEntries.get(publication.id) ?? [];

              return (
                <div className="library-group" key={publication.id}>
                  <div className="library-row-shell">
                    <button
                      aria-current={isActive ? 'page' : undefined}
                      className={`library-row ${isActive ? 'is-active' : ''}`}
                      onClick={() => {
                        openPublication(publication.id);
                        onNavigate();
                      }}
                      type="button"
                    >
                      <Icon name="book" size={14} />
                      <span>
                        <strong>{publication.title}</strong>
                        <small>{publication.author}</small>
                      </span>
                    </button>
                    <button
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Hide' : 'Show'} writing in ${publication.title}`}
                      className={`icon-button library-disclosure ${
                        isExpanded ? 'is-expanded' : ''
                      }`}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : publication.id)
                      }
                      type="button"
                    >
                      <Icon name="chevron-down" size={14} />
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="library-group-body">
                      {writing.length > 0 ? (
                        <ul className="library-entry-list">
                          {writing.map((entry) => (
                            <li key={entry.id}>
                              <button
                                aria-current={
                                  state.activeEntryId === entry.id
                                    ? 'true'
                                    : undefined
                                }
                                className={`library-entry-row ${
                                  state.activeEntryId === entry.id
                                    ? 'is-active'
                                    : ''
                                }`}
                                data-kind={entry.kind}
                                onClick={() => openEntry(entry.id)}
                                type="button"
                              >
                                <Icon
                                  name={entry.kind === 'note' ? 'more' : 'file'}
                                  size={13}
                                />
                                <span>{entry.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="library-group-empty">
                          Nothing written against this book yet.
                        </p>
                      )}
                      <div className="library-group-actions">
                        <button
                          className="library-group-action"
                          onClick={() => {
                            const entry = createEntry(
                              null,
                              'writing',
                              publication.id,
                            );
                            openPublication(publication.id);
                            openEntry(entry.id);
                          }}
                          type="button"
                        >
                          <Icon name="plus" size={12} />
                          <span>New writing</span>
                        </button>
                        <button
                          className="library-group-action"
                          onClick={() => {
                            const entry = createEntry(
                              null,
                              'note',
                              publication.id,
                            );
                            openPublication(publication.id);
                            openEntry(entry.id);
                          }}
                          type="button"
                        >
                          <Icon name="plus" size={12} />
                          <span>New note</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="library-status" role="status">The shelf is empty.</p>
        )}
      </section>

      <div className="notes-section">
        <div className="sidebar-section-heading">
          <span>Writing &amp; notes</span>
        </div>
        <EntryActions />
        <nav aria-label="Writing directory" className="sidebar-tree">
          <DirectoryTree onSelectEntry={onNavigate} publicationScope={null} />
        </nav>
      </div>
    </div>
  );
}
