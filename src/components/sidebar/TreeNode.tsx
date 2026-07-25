import { memo, useState } from 'react';
import type { TreeNode as TreeNodeType } from '../../hooks/useDirectoryTree';
import { useStorage } from '../../hooks/useStorage';
import { Icon } from '../ui/Icon';

interface Props {
  node: TreeNodeType;
  depth: number;
  onSelectEntry?: () => void;
}

export const TreeNode = memo(function TreeNode({
  node,
  depth,
  onSelectEntry,
}: Props) {
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
    const nextName = editName.trim();
    if (nextName) {
      if (node.type === 'entry') renameEntry(node.id, nextName);
      else renameDirectory(node.id, nextName);
    }
    setIsEditing(false);
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!window.confirm(`Delete “${node.name}”?`)) return;
    if (node.type === 'entry') deleteEntry(node.id);
    else deleteDirectory(node.id);
  };

  const handleActivate = () => {
    if (node.type === 'entry') {
      setActiveEntry(node.id);
      onSelectEntry?.();
    } else {
      setIsOpen((current) => !current);
    }
  };

  return (
    <div className="tree-branch">
      <div
        className={`tree-row tree-row-${node.type} ${isActive ? 'is-active' : ''}`}
        onClick={handleActivate}
        onDoubleClick={() => {
          setEditName(node.name);
          setIsEditing(true);
        }}
        role="treeitem"
        aria-expanded={node.type === 'directory' ? isOpen : undefined}
        aria-selected={node.type === 'entry' ? isActive : undefined}
        style={{ paddingLeft: `${depth * 14 + 18}px` }}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleActivate();
          }
        }}
      >
        <span className="tree-leading-icon">
          {node.type === 'directory' ? (
            <Icon
              name={isOpen ? 'chevron-down' : 'chevron-right'}
              size={13}
            />
          ) : (
            <Icon name="file" size={13} />
          )}
        </span>

        {isEditing ? (
          <input
            aria-label={`Rename ${node.type}`}
            className="tree-rename-input"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onBlur={handleRename}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') handleRename();
              if (event.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}

        <button
          aria-label={`Delete ${node.type} ${node.name}`}
          className="tree-delete"
          onClick={handleDelete}
          title={`Delete ${node.name}`}
          type="button"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>

      {node.type === 'directory' && isOpen && node.children.length > 0 ? (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onSelectEntry={onSelectEntry}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
