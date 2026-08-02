import {
  memo,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import type { TreeNode as TreeNodeType } from '../../hooks/useDirectoryTree';
import { useStorage } from '../../hooks/useStorage';
import { Icon } from '../ui/Icon';

export interface TreeMoveItem {
  id: string;
  name: string;
  type: 'directory' | 'entry';
}

interface Props {
  canPlace: (item: TreeMoveItem, parentId: string | null) => boolean;
  depth: number;
  movingItem: TreeMoveItem | null;
  node: TreeNodeType;
  onDragEnd: () => void;
  onDragStart: (item: TreeMoveItem) => void;
  onPick: (item: TreeMoveItem) => void;
  onPlace: (item: TreeMoveItem, parentId: string | null) => void;
  onSelectEntry?: () => void;
}

export const TreeNode = memo(function TreeNode({
  canPlace,
  depth,
  movingItem,
  node,
  onDragEnd,
  onDragStart,
  onPick,
  onPlace,
  onSelectEntry,
}: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const lastTouchAtRef = useRef(Number.NEGATIVE_INFINITY);
  const touchActivationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const {
    activeEntryId,
    setActiveEntry,
    renameEntry,
    deleteEntry,
    renameDirectory,
    deleteDirectory,
  } = useStorage();

  useEffect(() => () => {
    if (touchActivationTimerRef.current) clearTimeout(touchActivationTimerRef.current);
  }, []);

  const item: TreeMoveItem = { id: node.id, name: node.name, type: node.type };
  const isActive = node.type === 'entry' && node.id === activeEntryId;
  const isPicked = movingItem?.id === node.id && movingItem.type === node.type;
  const canPlaceInside = node.type === 'directory'
    && Boolean(movingItem)
    && canPlace(movingItem!, node.id);

  const beginRename = () => {
    setEditName(node.name);
    setIsEditing(true);
  };

  const handleRename = () => {
    const nextName = editName.trim();
    if (nextName) {
      if (node.type === 'entry') renameEntry(node.id, nextName);
      else renameDirectory(node.id, nextName);
    }
    setIsEditing(false);
  };

  const handleDelete = (event: MouseEvent) => {
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

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!movingItem || node.type !== 'directory' || !canPlaceInside) return;
    event.preventDefault();
    event.stopPropagation();
    onPlace(movingItem, node.id);
  };

  return (
    <div className="tree-branch">
      <div
        aria-expanded={node.type === 'directory' ? isOpen : undefined}
        aria-selected={node.type === 'entry' ? isActive : undefined}
        className={`tree-row tree-row-${node.type} ${isActive ? 'is-active' : ''} ${isPicked ? 'is-moving' : ''} ${canPlaceInside ? 'is-drop-target' : ''}`}
        draggable={!isEditing}
        onClick={(event) => {
          if (suppressClickRef.current) {
            event.preventDefault();
            return;
          }
          handleActivate();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          beginRename();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          if (!canPlaceInside) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', `${node.type}:${node.id}`);
          onDragStart(item);
        }}
        onDrop={handleDrop}
        onKeyDown={(event) => {
          if (event.key === 'F2') {
            event.preventDefault();
            beginRename();
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleActivate();
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = true;
          const now = performance.now();
          if (now - lastTouchAtRef.current <= 460) {
            if (touchActivationTimerRef.current) {
              clearTimeout(touchActivationTimerRef.current);
              touchActivationTimerRef.current = null;
            }
            lastTouchAtRef.current = Number.NEGATIVE_INFINITY;
            beginRename();
            window.setTimeout(() => { suppressClickRef.current = false; }, 0);
            return;
          }
          lastTouchAtRef.current = now;
          touchActivationTimerRef.current = setTimeout(() => {
            suppressClickRef.current = false;
            touchActivationTimerRef.current = null;
            handleActivate();
          }, 460);
        }}
        role="treeitem"
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        tabIndex={0}
      >
        <button
          aria-label={`${isPicked ? 'Cancel moving' : 'Move'} ${node.name}`}
          aria-pressed={isPicked}
          className="tree-move-handle"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPick(item);
          }}
          onPointerUp={(event) => event.stopPropagation()}
          type="button"
        >
          <span aria-hidden="true">⠿</span>
        </button>

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
            autoFocus
            className="tree-rename-input"
            onBlur={handleRename}
            onChange={(event) => setEditName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') handleRename();
              if (event.key === 'Escape') setIsEditing(false);
            }}
            value={editName}
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}

        {canPlaceInside ? (
          <button
            className="tree-place-target"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPlace(movingItem!, node.id);
            }}
            onPointerUp={(event) => event.stopPropagation()}
            type="button"
          >
            place here
          </button>
        ) : null}

        <button
          aria-label={`Delete ${node.type} ${node.name}`}
          className="tree-delete"
          onClick={handleDelete}
          onPointerUp={(event) => event.stopPropagation()}
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
              canPlace={canPlace}
              depth={depth + 1}
              key={child.id}
              movingItem={movingItem}
              node={child}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onPick={onPick}
              onPlace={onPlace}
              onSelectEntry={onSelectEntry}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
