import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import MiniSearch from 'minisearch';
import { useStorage } from '../../hooks/useStorage';
import { Icon } from '../ui/Icon';

interface IndexedNote {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const {
    entries,
    createDirectory,
    createEntry,
    setActiveEntry,
  } = useStorage();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((open) => !open);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createEntry(null);
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createEntry]);

  const indexedNotes = useMemo<IndexedNote[]>(
    () =>
      Object.values(entries).map((entry) => ({
        id: entry.id,
        name: entry.name,
        text: `${entry.rawTranscript} ${entry.refinedText}`,
        updatedAt: entry.updatedAt,
      })),
    [entries],
  );

  const search = useMemo(() => {
    const miniSearch = new MiniSearch<IndexedNote>({
      fields: ['name', 'text'],
      storeFields: ['id', 'name', 'updatedAt'],
      searchOptions: { boost: { name: 3 }, fuzzy: 0.2, prefix: true },
    });
    miniSearch.addAll(indexedNotes);
    return miniSearch;
  }, [indexedNotes]);

  const visibleNotes = useMemo(() => {
    if (!query.trim()) {
      return indexedNotes.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    }
    return search.search(query).slice(0, 10).map((result) => ({
      id: String(result.id),
      name: String(result.name),
      text: '',
      updatedAt: Number(result.updatedAt),
    }));
  }, [indexedNotes, query, search]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  return (
    <Command.Dialog
      className="command-palette"
      label="Cadence commands and note search"
      onOpenChange={setIsOpen}
      open={isOpen}
      shouldFilter={false}
    >
      <div className="command-input-row">
        <Icon name="search" size={15} />
        <Command.Input
          autoFocus
          onValueChange={setQuery}
          placeholder="Open a note or run a command…"
          value={query}
        />
        <kbd>esc</kbd>
      </div>
      <Command.List className="command-list">
        <Command.Empty>No note or command found.</Command.Empty>
        <Command.Group heading="Create">
          <Command.Item
            onSelect={() => {
              createEntry(null);
              close();
            }}
          >
            <Icon name="plus" size={14} />
            New note
            <span>⌘N</span>
          </Command.Item>
          <Command.Item
            onSelect={() => {
              createDirectory(null);
              close();
            }}
          >
            <Icon name="folder" size={14} />
            New folder
          </Command.Item>
        </Command.Group>

        {visibleNotes.length > 0 ? (
          <Command.Group heading={query ? 'Notes' : 'Recent notes'}>
            {visibleNotes.map((entry) => (
              <Command.Item
                key={entry.id}
                onSelect={() => {
                  setActiveEntry(entry.id);
                  close();
                }}
                value={`${entry.name} ${entry.id}`}
              >
                <Icon name="file" size={14} />
                {entry.name}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
      <footer>
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>⌘K close</span>
      </footer>
    </Command.Dialog>
  );
}
