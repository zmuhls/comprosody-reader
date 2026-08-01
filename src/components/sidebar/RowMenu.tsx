import { useState, useRef, useEffect } from 'react';
import type { TreeNode as TreeNodeType } from '../../hooks/useDirectoryTree';
import { useStorage } from '../../hooks/useStorage';
import { isDescendantDirectory } from '../../context/AppContext';

interface Props {
  node: TreeNodeType;
  onClose: () => void;
}

const ITEM =
  'block w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:bg-surface-writing hover:text-text-primary';

export function RowMenu({ node, onClose }: Props) {
  const {
    entries,
    directories,
    moveNode,
    setDirectoryKind,
    attachNote,
    detachNote,
    deleteEntry,
    deleteDirectory,
  } = useStorage();
  const [panel, setPanel] = useState<'main' | 'move' | 'attach'>('main');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const isDirectory = node.type === 'directory';
  const entry = node.entry;
  const isNote = entry?.kind === 'note';
  const isAttached = isNote && entry?.attachedToId !== undefined;
  const currentParent = isDirectory
    ? (directories[node.id]?.parentId ?? null)
    : (entry?.parentId ?? null);

  const moveTargets = Object.values(directories)
    .filter((dir) => {
      if (dir.id === currentParent) return false;
      if (isDirectory) {
        if (dir.id === node.id) return false;
        if (isDescendantDirectory(directories, dir.id, node.id)) return false;
      }
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const attachTargets = isNote
    ? Object.values(entries)
        .filter(
          (e) =>
            e.kind === 'writing' &&
            e.parentId === (entry?.parentId ?? null) &&
            e.id !== node.id
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const handleDelete = () => {
    const message = isDirectory
      ? `delete "${node.name}" and everything in it?`
      : `delete "${node.name}"?`;
    if (!window.confirm(message)) return;
    if (isDirectory) deleteDirectory(node.id);
    else deleteEntry(node.id);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute right-2 top-full z-20 min-w-44 border border-border bg-surface-overlay py-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
      onClick={(e) => e.stopPropagation()}
      role="menu"
      aria-label={`actions for ${node.name}`}
    >
      {panel === 'main' && (
        <>
          <button className={ITEM} onClick={() => setPanel('move')} role="menuitem">
            move to…
          </button>
          {isDirectory && node.directoryKind === 'folder' && (
            <button
              className={ITEM}
              onClick={() => {
                setDirectoryKind(node.id, 'book');
                onClose();
              }}
              role="menuitem"
            >
              make book
            </button>
          )}
          {isDirectory && node.directoryKind === 'book' && (
            <button
              className={ITEM}
              onClick={() => {
                setDirectoryKind(node.id, 'folder');
                onClose();
              }}
              role="menuitem"
            >
              make folder
            </button>
          )}
          {isNote && attachTargets.length > 0 && (
            <button className={ITEM} onClick={() => setPanel('attach')} role="menuitem">
              attach to entry…
            </button>
          )}
          {isAttached && (
            <button
              className={ITEM}
              onClick={() => {
                detachNote(node.id);
                onClose();
              }}
              role="menuitem"
            >
              detach
            </button>
          )}
          <button
            className={`${ITEM} hover:text-hot`}
            onClick={handleDelete}
            role="menuitem"
          >
            delete
          </button>
        </>
      )}

      {panel === 'move' && (
        <>
          <div className="px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-text-muted">
            move to
          </div>
          {currentParent !== null && (
            <button
              className={ITEM}
              onClick={() => {
                moveNode(isDirectory ? 'directory' : 'entry', node.id, null);
                onClose();
              }}
              role="menuitem"
            >
              library root
            </button>
          )}
          {moveTargets.map((dir) => (
            <button
              key={dir.id}
              className={ITEM}
              onClick={() => {
                moveNode(isDirectory ? 'directory' : 'entry', node.id, dir.id);
                onClose();
              }}
              role="menuitem"
            >
              {dir.kind === 'book' ? '𝄃 ' : ''}
              {dir.name}
            </button>
          ))}
          {moveTargets.length === 0 && currentParent === null && (
            <div className="px-3 py-1.5 text-[10px] text-text-muted">
              no other containers yet
            </div>
          )}
        </>
      )}

      {panel === 'attach' && (
        <>
          <div className="px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-text-muted">
            attach to
          </div>
          {attachTargets.map((target) => (
            <button
              key={target.id}
              className={ITEM}
              onClick={() => {
                attachNote(node.id, target.id);
                onClose();
              }}
              role="menuitem"
            >
              {target.name}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
