import { useStorage } from '../../hooks/useStorage';

export function EntryActions() {
  const { createEntry, createDirectory } = useStorage();

  return (
    <div className="flex gap-1.5 p-3 border-b border-border">
      <button
        onClick={() => createDirectory(null)}
        className="flex-1 text-[10px] tracking-wider uppercase px-2 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-focus transition-colors rounded-sm"
        title="New folder"
      >
        + folder
      </button>
      <button
        onClick={() => createEntry(null)}
        className="flex-1 text-[10px] tracking-wider uppercase px-2 py-1.5 bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 hover:border-accent/50 transition-colors rounded-sm"
        title="New entry"
      >
        + entry
      </button>
    </div>
  );
}
