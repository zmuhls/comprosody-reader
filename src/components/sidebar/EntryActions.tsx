import { useStorage } from '../../hooks/useStorage';

export function EntryActions() {
  const { createEntry, createDirectory } = useStorage();

  return (
    <div className="flex gap-2 border-b border-border p-4">
      <button
        onClick={() => createDirectory(null)}
        className="flex-1 border border-border px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
        title="New folder"
      >
        + folder
      </button>
      <button
        onClick={() => createEntry(null)}
        className="flex-1 border border-accent bg-accent/10 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-accent transition-colors hover:bg-accent/16 hover:border-accent"
        title="New entry"
      >
        + entry
      </button>
    </div>
  );
}
