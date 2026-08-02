import { memo, useState, type DragEvent } from 'react';
import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode, type TreeMoveItem } from './TreeNode';

interface DirectoryTreeProps {
  onSelectEntry?: () => void;
}

export const DirectoryTree = memo(function DirectoryTree({
  onSelectEntry,
}: DirectoryTreeProps) {
  const {
    directories,
    entries,
    moveDirectory,
    moveEntry,
  } = useStorage();
  const tree = useDirectoryTree(directories, entries);
  const [pickedItem, setPickedItem] = useState<TreeMoveItem | null>(null);
  const [draggedItem, setDraggedItem] = useState<TreeMoveItem | null>(null);
  const [moveStatus, setMoveStatus] = useState('');
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
    <div
      className={`directory-tree ${movingItem ? 'is-move-mode' : ''}`}
      onDragOver={(event) => {
        if (!movingItem || !canPlace(movingItem, null)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={handleRootDrop}
      role="tree"
    >
      {movingItem ? (
        <div className="tree-move-banner">
          <span>moving {movingItem.name}</span>
          <button onClick={() => setPickedItem(null)} type="button">cancel</button>
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
      ) : tree.map((node) => (
        <TreeNode
          canPlace={canPlace}
          depth={0}
          key={node.id}
          movingItem={movingItem}
          node={node}
          onDragEnd={() => setDraggedItem(null)}
          onDragStart={(item) => setDraggedItem(item)}
          onPick={(item) => {
            setPickedItem((current) => (
              current?.id === item.id && current.type === item.type ? null : item
            ));
            setMoveStatus('');
          }}
          onPlace={place}
          onSelectEntry={onSelectEntry}
        />
      ))}
      <p aria-live="polite" className="tree-move-status" role="status">
        {moveStatus}
      </p>
    </div>
  );
});
