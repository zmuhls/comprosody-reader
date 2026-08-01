import { useState } from 'react';
import type { TreeNode as TreeNodeType } from '../../hooks/useDirectoryTree';
import { useStorage } from '../../hooks/useStorage';
import { countWords } from '../../lib/entries';
import { RowMenu } from './RowMenu';
import {
  DRAG_MIME,
  encodeDrag,
  decodeDrag,
  getCurrentDrag,
  setCurrentDrag,
  resolveDropIntent,
  type DragPayload,
  type DropIntent,
} from './dnd';

interface Props {
  node: TreeNodeType;
  depth: number;
}

function Glyph({ node, isOpen, isActive }: { node: TreeNodeType; isOpen: boolean; isActive: boolean }) {
  if (node.type === 'directory') {
    if (node.directoryKind === 'book') {
      return (
        <span className="w-3 shrink-0 text-center font-brand text-[13px] leading-none text-accent/80">
          𝄃
        </span>
      );
    }
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 text-text-muted">
        <path
          d={isOpen ? 'M2 3 L5 7 L8 3' : 'M3 2 L7 5 L3 8'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (node.entry?.kind === 'note') {
    return (
      <span className="w-3 shrink-0 text-center text-[11px] leading-none text-text-muted">
        ✎
      </span>
    );
  }

  if (node.chapterNumber !== undefined) {
    return (
      <span className="w-3 shrink-0 text-center text-[10px] tabular-nums leading-none text-accent/70">
        {node.chapterNumber}
      </span>
    );
  }

  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
      <circle
        cx="5"
        cy="5"
        r="2.5"
        fill={isActive ? 'var(--color-accent)' : 'var(--color-text-muted)'}
      />
    </svg>
  );
}

type Indicator = 'into' | 'before' | 'attach' | null;

export function TreeNode({ node, depth }: Props) {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [indicator, setIndicator] = useState<Indicator>(null);
  const {
    entries,
    directories,
    activeEntryId,
    setActiveEntry,
    renameEntry,
    renameDirectory,
    moveNode,
    reorderEntry,
    attachNote,
  } = useStorage();

  const isActive = node.type === 'entry' && node.id === activeEntryId;
  const isBook = node.type === 'directory' && node.directoryKind === 'book';

  const dragPayload: DragPayload = {
    nodeType: node.type === 'directory' ? 'directory' : 'entry',
    id: node.id,
  };

  const zoneFromEvent = (e: React.DragEvent<HTMLDivElement>): 'top' | 'middle' | 'bottom' => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height / 3) return 'top';
    if (y > (rect.height * 2) / 3) return 'bottom';
    return 'middle';
  };

  // Dropping a note on a writing row pins it there — the drag gesture mirror
  // of the row menu's "attach to entry…".
  const isAttachDrop = (payload: DragPayload, zone: 'top' | 'middle' | 'bottom') =>
    payload.nodeType === 'entry' &&
    entries[payload.id]?.kind === 'note' &&
    node.type === 'entry' &&
    node.entry?.kind === 'writing' &&
    payload.id !== node.id &&
    zone === 'middle';

  const intentFor = (
    payload: DragPayload,
    zone: 'top' | 'middle' | 'bottom'
  ): DropIntent | 'attach' => {
    if (isAttachDrop(payload, zone)) return 'attach';
    return resolveDropIntent(payload, node, zone, directories);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const payload = getCurrentDrag();
    if (!payload) return;
    const intent = intentFor(payload, zoneFromEvent(e));
    if (intent === 'attach') {
      e.preventDefault();
      e.stopPropagation();
      setIndicator('attach');
    } else if (intent.kind !== 'none') {
      e.preventDefault();
      e.stopPropagation();
      setIndicator(intent.kind === 'before' ? 'before' : 'into');
    } else {
      setIndicator(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setIndicator(null);
    const payload = decodeDrag(e.dataTransfer) ?? getCurrentDrag();
    if (!payload) return;
    const intent = intentFor(payload, zoneFromEvent(e));
    if (intent === 'attach') {
      e.preventDefault();
      e.stopPropagation();
      attachNote(payload.id, node.id);
    } else if (intent.kind === 'into') {
      e.preventDefault();
      e.stopPropagation();
      moveNode(payload.nodeType, payload.id, intent.parentId);
    } else if (intent.kind === 'before') {
      e.preventDefault();
      e.stopPropagation();
      const dragged = entries[payload.id];
      if (dragged && dragged.parentId !== intent.parentId) {
        moveNode('entry', payload.id, intent.parentId);
      }
      reorderEntry(payload.id, intent.beforeId);
    }
    setCurrentDrag(null);
  };

  const handleRename = () => {
    if (editName.trim()) {
      if (node.type === 'entry') renameEntry(node.id, editName.trim());
      else renameDirectory(node.id, editName.trim());
    }
    setIsEditing(false);
  };

  const entry = node.entry;
  const wordCount = entry
    ? entry.wordCount || countWords(entry.rawTranscript) || countWords(entry.refinedText)
    : 0;

  return (
    <div>
      <div
        className={`group relative flex cursor-pointer items-center gap-2 px-4 py-2 text-[11px] transition-colors ${
          isActive
            ? 'border-r-2 border-accent bg-accent/8 text-accent'
            : 'text-text-secondary hover:bg-surface-writing hover:text-text-primary'
        } ${
          indicator === 'into' || indicator === 'attach'
            ? 'bg-accent/8 outline outline-1 -outline-offset-1 outline-accent/50'
            : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 16}px` }}
        draggable={!isEditing}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DRAG_MIME, encodeDrag(dragPayload));
          e.dataTransfer.effectAllowed = 'move';
          setCurrentDrag(dragPayload);
        }}
        onDragEnd={() => {
          setCurrentDrag(null);
          setIndicator(null);
        }}
        onDragOver={handleDragOver}
        onDragLeave={() => setIndicator(null)}
        onDrop={handleDrop}
        onClick={() => {
          if (node.type === 'entry') setActiveEntry(node.id);
          else setIsOpen(!isOpen);
        }}
        onDoubleClick={() => {
          setEditName(node.name);
          setIsEditing(true);
        }}
      >
        {indicator === 'before' && (
          <span
            className="pointer-events-none absolute left-4 right-2 top-0 h-px bg-accent"
            aria-hidden="true"
          />
        )}
        <Glyph node={node} isOpen={isOpen} isActive={isActive} />

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
          <>
            <span
              className={`flex-1 truncate ${isBook ? 'font-medium uppercase tracking-[0.14em]' : ''} ${
                entry?.kind === 'note' ? 'italic text-text-muted group-hover:text-text-secondary' : ''
              }`}
            >
              {node.name}
            </span>
            {wordCount > 0 && (
              <span className="shrink-0 text-[9px] tabular-nums text-text-muted">
                {wordCount}w
              </span>
            )}
          </>
        )}

        <button
          className="px-0.5 text-xs leading-none text-text-muted opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setIsMenuOpen((open) => !open);
          }}
          title="Row actions"
          aria-label={`actions for ${node.name}`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
        >
          ⋯
        </button>

        {isMenuOpen && <RowMenu node={node} onClose={() => setIsMenuOpen(false)} />}
      </div>

      {node.type === 'directory' && isOpen && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}

      {node.type === 'entry' && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
