import { useApp } from '../../context/AppContext';

interface Props {
  entryId: string;
}

/**
 * Notes pinned to the open entry. `include` marks whether a note travels into
 * the refinement context (undefined = included).
 */
export function MarginNotes({ entryId }: Props) {
  const { state, dispatch } = useApp();
  const notes = Object.values(state.entries)
    .filter((e) => e.attachedToId === entryId)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[50vh] overflow-y-auto border-t border-border bg-surface-raised xl:static xl:z-auto xl:max-h-none xl:w-60 xl:shrink-0 xl:border-l xl:border-t-0 xl:bg-transparent"
      aria-label="margin notes"
    >
      <div className="px-4 py-3">
        <div className="text-[9px] uppercase tracking-[0.24em] text-text-muted">
          margin notes
        </div>
        {notes.length === 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            No notes pinned here yet. Attach one from the library's row menu, or
            drag a note onto this entry.
          </p>
        )}
        <div className="mt-2 flex flex-col gap-3">
          {notes.map((note) => (
            <div key={note.id} className="border border-border/70 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-text-secondary">
                {note.name}
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-text-muted font-writing">
                {note.refinedText || note.rawTranscript || '(empty note)'}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="text-[9px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:text-accent"
                  onClick={() => dispatch({ type: 'SET_ACTIVE_ENTRY', id: note.id })}
                >
                  open
                </button>
                <span className="text-text-muted/40">·</span>
                <button
                  className="text-[9px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:text-hot"
                  onClick={() => dispatch({ type: 'DETACH_NOTE', noteId: note.id })}
                >
                  detach
                </button>
                <span className="flex-1" />
                <label className="flex cursor-pointer items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-text-secondary">
                  <input
                    type="checkbox"
                    checked={note.includeInRefinement !== false}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_ENTRY',
                        id: note.id,
                        updates: { includeInRefinement: e.target.checked },
                      })
                    }
                    className="h-3 w-3 accent-accent"
                  />
                  include
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
