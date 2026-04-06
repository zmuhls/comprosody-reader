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
        className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs transition-colors ${
          isActive
            ? 'bg-accent/10 text-accent border-r-2 border-accent'
            : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
        }`}
        style={{ paddingLeft: `${depth * 14 + 12}px` }}
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
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="shrink-0 text-text-muted"
          >
            <path
              d={isOpen ? 'M2 3 L5 7 L8 3' : 'M3 2 L7 5 L3 8'}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
            <circle
              cx="5"
              cy="5"
              r="2.5"
              fill={isActive ? 'var(--color-accent)' : 'var(--color-text-muted)'}
            />
          </svg>
        )}

        {isEditing ? (
          <input
            className="flex-1 bg-surface border border-border-focus text-text-primary text-xs px-1.5 py-0.5 outline-none font-ui rounded-sm"
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
          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-hot text-xs px-0.5 transition-opacity"
          onClick={handleDelete}
          title="Delete"
        >
          &times;
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
