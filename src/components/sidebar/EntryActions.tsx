import { useStorage } from '../../hooks/useStorage';
import { Icon } from '../ui/Icon';

export function EntryActions() {
  const { createEntry, createDirectory } = useStorage();

  return (
    <div className="entry-actions">
      <button
        className="entry-primary-action"
        onClick={() => createEntry(null)}
        title="New note"
        type="button"
      >
        <Icon name="plus" size={16} />
        <span>New note</span>
      </button>
      <button
        aria-label="New folder"
        className="icon-button entry-folder-action"
        onClick={() => createDirectory(null)}
        title="New folder"
        type="button"
      >
        <Icon name="folder" size={15} />
      </button>
    </div>
  );
}
