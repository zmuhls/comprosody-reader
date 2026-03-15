import { useState } from 'react';
import type { TreeNode as TreeNodeType } from '../../hooks/useDirectoryTree';
import { useStorage } from '../../hooks/useStorage';

interface Props {
  node: TreeNodeType;
  depth: number;
}

export function TreeNode({ node, depth }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const {
    activeEntryId,
    setActiveEntry,
    renameEntry,
    deleteEntry,
    renameDirectory,
    deleteDirectory,
  } = useStorage();

  const isActive = node.type === 'entry' && node.id === activeEntryId;

  const handleRename = () => {
    if (editName.trim()) {
      if (node.type === 'entry') renameEntry(node.id, editName.trim());
      else renameDirectory(node.id, editName.trim());
    }
    setIsEditing(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'entry') deleteEntry(node.id);
    else deleteDirectory(node.id);
  };

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 cursor-pointer text-xs hover:bg-surface-overlay transition-colors ${
          isActive ? 'bg-surface-overlay text-accent' : 'text-text-secondary'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.type === 'entry') setActiveEntry(node.id);
          else setIsOpen(!isOpen);
        }}
        onDoubleClick={() => {
          setEditName(node.name);
          setIsEditing(true);
        }}
      >
        {node.type === 'directory' ? (
          <span className="w-4 text-center text-text-muted">
            {isOpen ? '\u25BE' : '\u25B8'}
          </span>
        ) : (
          <span className="w-4 text-center text-text-muted">\u25C7</span>
        )}

        {isEditing ? (
          <input
            className="flex-1 bg-surface-raised border border-border-focus text-text-primary text-xs px-1 py-0.5 outline-none"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}

        <button
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-hot text-xs px-1 transition-opacity"
          onClick={handleDelete}
          title="Delete"
        >
          \u00D7
        </button>
      </div>

      {node.type === 'directory' && isOpen && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
