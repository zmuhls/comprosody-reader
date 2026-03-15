import { useStorage } from '../../hooks/useStorage';

export function EntryActions() {
  const { createEntry, createDirectory } = useStorage();

  return (
    <div className="flex gap-1 p-2 border-b border-border">
      <button
        onClick={() => createDirectory(null)}
        className="flex-1 text-xs px-2 py-1.5 bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-border transition-colors"
        title="New folder"
      >
        + folder
      </button>
      <button
        onClick={() => createEntry(null)}
        className="flex-1 text-xs px-2 py-1.5 bg-surface-overlay text-text-secondary hover:text-text-primary hover:bg-border transition-colors"
        title="New entry"
      >
        + entry
      </button>
    </div>
  );
}
