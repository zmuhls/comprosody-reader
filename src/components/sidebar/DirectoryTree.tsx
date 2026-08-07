import { memo, useMemo, useRef, useState, type DragEvent } from 'react';
import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode, type TreeMoveItem } from './TreeNode';

interface DirectoryTreeProps {
  onSelectEntry?: () => void;
  /**
   * Restricts the tree to entries written against this publication. `null`
   * shows only free-standing work, which is what keeps one book's writing from
   * following the reader into the next book.
   */
  publicationScope?: string | null;
}

export const DirectoryTree = memo(function DirectoryTree({
  onSelectEntry,
  publicationScope,
}: DirectoryTreeProps) {
  const {
    directories,
    entries,
    moveDirectory,
    moveEntry,
  } = useStorage();
  const scopedEntries = useMemo(() => {
    if (publicationScope === undefined) return entries;
    return Object.fromEntries(
      Object.entries(entries).filter(
        ([, entry]) => (entry.publicationId ?? null) === publicationScope,
      ),
    );
  }, [entries, publicationScope]);
  const tree = useDirectoryTree(directories, scopedEntries);
  const [pickedItem, setPickedItem] = useState<TreeMoveItem | null>(null);
  const [draggedItem, setDraggedItem] = useState<TreeMoveItem | null>(null);
  const [moveStatus, setMoveStatus] = useState('');
  const dragPlacementCommittedRef = useRef(false);
  const movingItem = pickedItem ?? draggedItem;

  const directoryContains = (rootId: string, targetId: string): boolean => {
    let current = directories[targetId] as typeof directories[string] | undefined;
    while (current) {
      if (current.id === rootId) return true;
      current = current.parentId ? directories[current.parentId] : undefined;
    }
    return false;
  };

  const canPlace = (item: TreeMoveItem, parentId: string | null): boolean => {
    if (item.type === 'entry') {
      return entries[item.id]?.parentId !== parentId;
    }
    const directory = directories[item.id];
    if (!directory || directory.parentId === parentId || item.id === parentId) return false;
    return parentId === null || !directoryContains(item.id, parentId);
  };

  const place = (item: TreeMoveItem, parentId: string | null) => {
    if (!canPlace(item, parentId)) return;
    if (draggedItem?.id === item.id && draggedItem.type === item.type) {
      dragPlacementCommittedRef.current = true;
    }
    if (item.type === 'entry') moveEntry(item.id, parentId);
    else moveDirectory(item.id, parentId);
    const destination = parentId ? directories[parentId]?.name : 'Notes';
    setMoveStatus(`${item.name} moved to ${destination || 'Notes'}.`);
    setPickedItem(null);
    setDraggedItem(null);
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!movingItem || !canPlace(movingItem, null)) return;
    event.preventDefault();
    event.stopPropagation();
    place(movingItem, null);
  };

  return (
    <>
      <div
        className={`directory-tree ${movingItem ? 'is-move-mode' : ''}`}
        onDragOver={(event) => {
          if (!movingItem || !canPlace(movingItem, null)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={handleRootDrop}
      >
        {movingItem ? (
          <div className="tree-move-banner">
            <span>moving {movingItem.name}</span>
            <button
              onClick={() => {
                setPickedItem(null);
                setDraggedItem(null);
                setMoveStatus(`Move cancelled for ${movingItem.name}.`);
              }}
              type="button"
            >
              cancel
            </button>
          </div>
        ) : null}
        <div className="tree-root-target">
          <span>Notes</span>
          {movingItem && canPlace(movingItem, null) ? (
            <button onClick={() => place(movingItem, null)} type="button">
              place at top level
            </button>
          ) : null}
        </div>
        {tree.length === 0 ? (
          <div className="directory-empty">Your notes will live here.</div>
        ) : (
          <ul className="directory-tree-list">
            {tree.map((node) => (
              <TreeNode
                canPlace={canPlace}
                depth={0}
                key={node.id}
                movingItem={movingItem}
                node={node}
                onDragEnd={() => {
                  if (draggedItem && !dragPlacementCommittedRef.current) {
                    setMoveStatus(`Move cancelled for ${draggedItem.name}.`);
                  }
                  dragPlacementCommittedRef.current = false;
                  setDraggedItem(null);
                }}
                onDragStart={(item) => {
                  dragPlacementCommittedRef.current = false;
                  setDraggedItem(item);
                  setMoveStatus(`Moving ${item.name}. Drop it on a destination.`);
                }}
                onPick={(item) => {
                  const cancelling = pickedItem?.id === item.id
                    && pickedItem.type === item.type;
                  setPickedItem(cancelling ? null : item);
                  setMoveStatus(cancelling
                    ? `Move cancelled for ${item.name}.`
                    : `Moving ${item.name}. Choose a destination.`);
                }}
                onPlace={place}
                onSelectEntry={onSelectEntry}
              />
            ))}
          </ul>
        )}
      </div>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="tree-move-status"
        role="status"
      >
        {moveStatus}
      </p>
    </>
  );
});
