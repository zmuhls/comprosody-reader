import { useState } from 'react';
import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode } from './TreeNode';
import { decodeDrag, getCurrentDrag, setCurrentDrag } from './dnd';

interface Props {
  query?: string;
}

export function DirectoryTree({ query = '' }: Props) {
  const { directories, entries, moveNode } = useStorage();
  const tree = useDirectoryTree(directories, entries, query);
  const [rootActive, setRootActive] = useState(false);

  const handleRootDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setRootActive(false);
    const payload = decodeDrag(e.dataTransfer) ?? getCurrentDrag();
    if (!payload) return;
    e.preventDefault();
    moveNode(payload.nodeType, payload.id, null);
    setCurrentDrag(null);
  };

  if (tree.length === 0) {
    const hasAny =
      Object.keys(entries).length > 0 || Object.keys(directories).length > 0;
    return (
      <div className="px-5 py-8 text-sm text-text-muted">
        {query.trim() !== '' && hasAny
          ? 'no matches'
          : 'No entries yet. Start a take or create a folder to begin organizing the draft space.'}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col py-2">
      <div>
        {tree.map((node) => (
          <TreeNode key={node.id} node={node} depth={0} />
        ))}
      </div>
      {/* Trailing space doubles as the move-to-root drop zone. */}
      <div
        className={`min-h-10 flex-1 ${rootActive ? 'bg-accent/6 outline outline-1 -outline-offset-2 outline-accent/40' : ''}`}
        onDragOver={(e) => {
          if (!getCurrentDrag()) return;
          e.preventDefault();
          setRootActive(true);
        }}
        onDragLeave={() => setRootActive(false)}
        onDrop={handleRootDrop}
        aria-hidden="true"
      />
    </div>
  );
}
