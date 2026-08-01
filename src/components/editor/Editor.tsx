import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp, newEntry } from '../../context/AppContext';
import { useRefinement } from '../../hooks/useRefinement';
import { getPagingSiblings, useSwipePaging } from '../../hooks/useSwipePaging';
import { countParagraphs, countWords, deriveEntryName } from '../../lib/entries';
import { formatDuration, formatUpdatedAt } from '../../lib/time';
import { copyEntryToClipboard, downloadEntry } from '../../lib/export';
import type { Directory } from '../../types/editor';
import type { Variant } from '../../types/llm';
import { TranscriptView } from './TranscriptView';
import { Toolbar } from './Toolbar';
import { PassesBar } from './PassesBar';
import { VariantDiffView } from './VariantDiffView';
import { DiffView } from './DiffView';
import { MarginNotes } from './MarginNotes';

interface Props {
  interimTranscript: string;
  isRecording: boolean;
  onToggleSidebar: () => void;
}

function HamburgerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-10 w-10 shrink-0 items-center justify-center border border-border text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary lg:hidden"
      aria-label="open library"
    >
      ≡
    </button>
  );
}

/** Nearest enclosing book, walking up from a containing directory id. */
function findBookAncestor(
  directories: Record<string, Directory>,
  startId: string | null
): string | null {
  let cursor = startId;
  while (cursor !== null) {
    const dir = directories[cursor];
    if (!dir) return null;
    if (dir.kind === 'book') return dir.id;
    cursor = dir.parentId;
  }
  return null;
}

export function Editor({ interimTranscript, isRecording, onToggleSidebar }: Props) {
  const { state, dispatch } = useApp();
  const {
    isRefining,
    refinementError,
    refine,
    refineSelection,
    variants,
    variantErrors,
    isGeneratingVariants,
    generateVariants,
    acceptVariant,
    retryVariant,
    dismissVariants,
  } = useRefinement();
  const refinedRef = useRef<HTMLTextAreaElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  // Keyed by entry id so switching entries implicitly resets these flags.
  const [diffEntryId, setDiffEntryId] = useState<string | null>(null);
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [highlightedPass, setHighlightedPass] = useState<{
    entryId: string;
    label: Variant['label'];
  } | null>(null);
  const [notesEntryId, setNotesEntryId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const showDiff = !!activeEntry && diffEntryId === activeEntry.id;
  const copied = !!activeEntry && copiedEntryId === activeEntry.id;

  const hasTranscript = !!activeEntry && countWords(activeEntry.rawTranscript) > 0;
  const hasRefinedText = !!activeEntry && activeEntry.refinedText.trim().length > 0;
  const hasContent = hasTranscript || hasRefinedText;
  const canRefine = hasTranscript && !isRefining && !isGeneratingVariants;
  const canUndo = (activeEntry?.draftHistory?.length ?? 0) > 0;

  const handleRefineSelection = useCallback(() => {
    const textarea = refinedRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    if (selectionStart === selectionEnd) return;
    refineSelection(selectionStart, selectionEnd);
  }, [refineSelection]);

  const handleSelectionChange = useCallback(() => {
    const textarea = refinedRef.current;
    if (!textarea) return;
    setHasSelection(textarea.selectionStart !== textarea.selectionEnd);
  }, []);

  const handleSeedDraft = useCallback(() => {
    if (!activeEntry) return;
    dispatch({
      type: 'UPDATE_ENTRY',
      id: activeEntry.id,
      updates: {
        refinedText:
          activeEntry.refinedText.trim() === activeEntry.rawTranscript.trim()
            ? ''
            : activeEntry.rawTranscript,
      },
    });
  }, [activeEntry, dispatch]);

  const handleUndo = useCallback(() => {
    if (!activeEntry) return;
    const history = activeEntry.draftHistory ?? [];
    if (history.length === 0) return;
    dispatch({
      type: 'UPDATE_ENTRY',
      id: activeEntry.id,
      updates: {
        refinedText: history[history.length - 1],
        draftHistory: history.slice(0, -1),
      },
    });
  }, [activeEntry, dispatch]);

  const handleCopy = useCallback(() => {
    if (!activeEntry) return;
    const entryId = activeEntry.id;
    copyEntryToClipboard(activeEntry)
      .then(() => {
        setCopiedEntryId(entryId);
        if (copiedTimerRef.current !== null) {
          window.clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = window.setTimeout(
          () => setCopiedEntryId(null),
          1600
        );
      })
      .catch((err) => {
        console.error('Copy failed:', err);
      });
  }, [activeEntry]);

  const handleExport = useCallback(() => {
    if (!activeEntry) return;
    downloadEntry(activeEntry);
  }, [activeEntry]);

  const handleToggleDiff = useCallback(() => {
    if (!activeEntry) return;
    const entryId = activeEntry.id;
    setDiffEntryId((current) => (current === entryId ? null : entryId));
    setHasSelection(false);
  }, [activeEntry]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  // Swipe (touch) and bracket keys page between sibling chapters/entries.
  const rootRef = useRef<HTMLDivElement>(null);
  const goToSibling = useCallback(
    (direction: 'prev' | 'next') => {
      const currentId = state.activeEntryId;
      if (!currentId) return;
      const { prev, next } = getPagingSiblings(
        currentId,
        state.entries,
        state.directories
      );
      const target = direction === 'prev' ? prev : next;
      if (target) dispatch({ type: 'SET_ACTIVE_ENTRY', id: target });
    },
    [state.activeEntryId, state.entries, state.directories, dispatch]
  );

  useSwipePaging(rootRef, {
    onPrev: () => goToSibling('prev'),
    onNext: () => goToSibling('next'),
    enabled: !!state.activeEntryId && !isRecording,
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === '[') {
        event.preventDefault();
        goToSibling('prev');
      } else if (event.key === ']') {
        event.preventDefault();
        goToSibling('next');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goToSibling]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        if (!canRefine) return;
        event.preventDefault();
        refine();
      } else if (event.shiftKey && event.key.toLowerCase() === 'c') {
        if (!hasContent) return;
        event.preventDefault();
        handleCopy();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRefine, hasContent, refine, handleCopy]);

  if (!activeEntry) {
    return (
      <div className="relative flex flex-1 items-center justify-center">
        <div className="absolute left-4 top-4">
          <HamburgerButton onClick={onToggleSidebar} />
        </div>
        <div className="max-w-md px-8 text-center">
          <p className="font-brand text-3xl italic text-text-secondary">
            open a session
          </p>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            Create an entry from the library or start recording from the footer.
            The app will attach the session to a fresh entry automatically.
          </p>
        </div>
      </div>
    );
  }

  const transcriptWordCount = countWords(activeEntry.rawTranscript);
  const draftWordCount = countWords(activeEntry.refinedText);
  const draftParagraphs = countParagraphs(activeEntry.refinedText);
  const toneSummary = `${state.refinementSettings.genre} / ${state.refinementSettings.scale}`;
  const recordedDurationMs = activeEntry.recordedDurationMs ?? 0;
  const canDiff = hasTranscript && hasRefinedText;

  const highlightedVariant =
    highlightedPass && highlightedPass.entryId === activeEntry.id
      ? (variants.find((v) => v.label === highlightedPass.label) ?? null)
      : null;
  const bookAncestorId = findBookAncestor(state.directories, activeEntry.parentId);

  // Location breadcrumb: ancestor chain plus chapter position inside a book.
  const crumbs: string[] = [];
  {
    let cursor = activeEntry.parentId;
    while (cursor !== null) {
      const dir = state.directories[cursor];
      if (!dir) break;
      crumbs.unshift(dir.name);
      cursor = dir.parentId;
    }
  }
  const parentDir = activeEntry.parentId
    ? state.directories[activeEntry.parentId]
    : null;
  let chapterMarker: string | null = null;
  if (parentDir?.kind === 'book' && activeEntry.kind === 'writing') {
    const chapters = Object.values(state.entries)
      .filter(
        (e) =>
          e.parentId === activeEntry.parentId &&
          e.kind === 'writing' &&
          e.attachedToId === undefined
      )
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const position = chapters.findIndex((e) => e.id === activeEntry.id);
    if (position !== -1) {
      chapterMarker = `ch ${position + 1} of ${chapters.length}`;
    }
  }

  const attachedNoteCount = Object.values(state.entries).filter(
    (e) => e.attachedToId === activeEntry.id
  ).length;
  const showNotes = notesEntryId === activeEntry.id;

  const handleHighlightPass = (label: Variant['label'] | null) => {
    setHighlightedPass(label ? { entryId: activeEntry.id, label } : null);
  };

  const handleAcceptPass = () => {
    if (!highlightedVariant) return;
    acceptVariant(highlightedVariant);
    setHighlightedPass(null);
  };

  const handlePassToNote = () => {
    if (!highlightedVariant) return;
    const note = {
      ...newEntry(activeEntry.parentId, 'note'),
      name: `${highlightedVariant.label} pass — ${activeEntry.name}`.slice(0, 60),
      refinedText: highlightedVariant.text,
      attachedToId: activeEntry.id,
    };
    dispatch({ type: 'CREATE_ENTRY', entry: note });
    // Routing sends text away; the writer stays where they were.
    dispatch({ type: 'SET_ACTIVE_ENTRY', id: activeEntry.id });
  };

  const handlePassToChapter = () => {
    if (!highlightedVariant) return;
    // Membership can change while passes are open — re-check at click time.
    const bookId = findBookAncestor(state.directories, activeEntry.parentId);
    if (!bookId) return;
    const chapter = {
      ...newEntry(bookId, 'writing'),
      name: deriveEntryName(highlightedVariant.text),
      refinedText: highlightedVariant.text,
    };
    dispatch({ type: 'CREATE_ENTRY', entry: chapter });
    dispatch({ type: 'SET_ACTIVE_ENTRY', id: activeEntry.id });
  };

  const handleDismissPasses = () => {
    dismissVariants();
    setHighlightedPass(null);
  };

  const paging = getPagingSiblings(activeEntry.id, state.entries, state.directories);

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-surface/90 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <HamburgerButton onClick={onToggleSidebar} />
            <div className="min-w-0 flex-1">
            <div
              className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-text-muted"
              aria-live="polite"
            >
              <span>{activeEntry.kind === 'note' ? 'note' : 'active entry'}</span>
              {(crumbs.length > 0 || chapterMarker) && (
                <span className="tracking-[0.18em] text-text-muted/80">
                  {crumbs.join(' / ')}
                  {chapterMarker ? `${crumbs.length > 0 ? ' / ' : ''}${chapterMarker}` : ''}
                </span>
              )}
              {(paging.prev !== null || paging.next !== null) && (
                <span className="flex items-center gap-1 tracking-normal">
                  <button
                    onClick={() => goToSibling('prev')}
                    disabled={paging.prev === null}
                    className="px-1.5 py-0.5 text-[12px] leading-none text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="previous page"
                    title="previous ( [ or swipe right )"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => goToSibling('next')}
                    disabled={paging.next === null}
                    className="px-1.5 py-0.5 text-[12px] leading-none text-text-secondary transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label="next page"
                    title="next ( ] or swipe left )"
                  >
                    ›
                  </button>
                </span>
              )}
            </div>
            <input
              value={activeEntry.name}
              onChange={(event) =>
                dispatch({
                  type: 'RENAME_ENTRY',
                  id: activeEntry.id,
                  name: event.target.value,
                })
              }
              className="mt-2 w-full max-w-2xl border-b border-transparent bg-transparent pb-2 text-3xl text-text-primary outline-none transition-colors focus:border-border-strong font-brand"
            />
            <p className="mt-2 hidden max-w-2xl text-sm leading-relaxed text-text-secondary sm:block">
              Keep the transcript close to the spoken source, then use controlled
              refinement passes to shape the prose instead of flattening it.
            </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-secondary">
              transcript {transcriptWordCount}w
            </span>
            <span className="border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-secondary">
              draft {draftWordCount}w
            </span>
            <span className="border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-secondary">
              paragraphs {draftParagraphs}
            </span>
            {recordedDurationMs > 0 && (
              <span className="border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-secondary">
                take {formatDuration(recordedDurationMs)}
              </span>
            )}
            <span className="border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-secondary">
              {toneSummary}
            </span>
            <span className="border border-border px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-text-secondary">
              updated {formatUpdatedAt(activeEntry.updatedAt)}
            </span>
          </div>
        </div>

        {refinementError && (
          <p className="mt-4 border-l-2 border-hot pl-3 text-[11px] uppercase tracking-[0.16em] text-hot">
            {refinementError}
          </p>
        )}
      </div>

      <Toolbar
        onRefine={refine}
        onRefineSelection={handleRefineSelection}
        onGenerateVariants={generateVariants}
        onSeedDraft={handleSeedDraft}
        onUndo={handleUndo}
        onCopy={handleCopy}
        onExport={handleExport}
        canUndo={canUndo}
        copied={copied}
        hasSelection={hasSelection}
        hasTranscript={hasTranscript}
        hasRefinedText={hasRefinedText}
        isRefining={isRefining}
        isGeneratingVariants={isGeneratingVariants}
      />

      <div className="grid flex-1 min-h-0 xl:grid-cols-[minmax(0,0.95fr)_1px_minmax(0,1.05fr)]">
        {/* Raw transcript */}
        <TranscriptView
          entryId={activeEntry.id}
          rawTranscript={activeEntry.rawTranscript}
          interimTranscript={interimTranscript}
          isRecording={isRecording}
          audioTakes={activeEntry.audioTakes}
          onChangeTranscript={(value) =>
            dispatch({
              type: 'UPDATE_ENTRY',
              id: activeEntry.id,
              updates: { rawTranscript: value },
            })
          }
        />

        {/* Divider */}
        <div className="hidden bg-border xl:block" />

        {/* Refined text */}
        <div className="flex min-w-0 flex-1 flex-col bg-surface-writing">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-text-muted">
                refined draft
              </div>
              <div className="mt-1 text-[11px] text-text-secondary">
                Selection-based refinement works on this pane.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  setNotesEntryId((current) =>
                    current === activeEntry.id ? null : activeEntry.id
                  )
                }
                className={`border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                  showNotes
                    ? 'border-border-focus text-text-primary'
                    : 'border-border text-text-secondary hover:border-border-strong hover:text-text-primary'
                }`}
              >
                notes{attachedNoteCount > 0 ? ` (${attachedNoteCount})` : ''}
              </button>
              <button
                onClick={handleToggleDiff}
                disabled={!canDiff}
                className="border border-border px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
              >
                {showDiff ? 'edit' : 'diff'}
              </button>
              <span className="text-[10px] uppercase tracking-[0.22em] text-text-muted">
                {isRecording
                  ? 'recording live'
                  : showDiff && canDiff
                    ? 'diff view'
                    : 'manual editing'}
              </span>
            </div>
          </div>
          <PassesBar
            variants={variants}
            errors={variantErrors}
            highlighted={highlightedVariant?.label ?? null}
            onHighlight={handleHighlightPass}
            onRetry={(label) => void retryVariant(label)}
            onAccept={handleAcceptPass}
            onToNote={handlePassToNote}
            onToChapter={handlePassToChapter}
            canToChapter={bookAncestorId !== null}
            onDismiss={handleDismissPasses}
            isGenerating={isGeneratingVariants}
          />
          <div className="flex min-h-0 flex-1">
            {highlightedVariant ? (
              <VariantDiffView
                oldText={activeEntry.refinedText}
                newText={highlightedVariant.text}
              />
            ) : showDiff && canDiff ? (
              <DiffView
                oldText={activeEntry.rawTranscript}
                newText={activeEntry.refinedText}
              />
            ) : (
              <textarea
                ref={refinedRef}
                value={activeEntry.refinedText}
                readOnly={isRefining}
                aria-busy={isRefining}
                onChange={(e) =>
                  dispatch({
                    type: 'UPDATE_ENTRY',
                    id: activeEntry.id,
                    updates: { refinedText: e.target.value },
                  })
                }
                onSelect={handleSelectionChange}
                onMouseUp={handleSelectionChange}
                onKeyUp={handleSelectionChange}
                placeholder="Refined text appears here. Use seed draft to bring the transcript across for manual shaping."
                className={`flex-1 w-full resize-none bg-transparent px-5 py-5 text-[1rem] leading-relaxed text-text-primary outline-none placeholder:text-text-muted/50 font-writing ${
                  isRefining ? 'cursor-wait opacity-70' : ''
                }`}
              />
            )}
            {showNotes && <MarginNotes entryId={activeEntry.id} />}
          </div>
        </div>
      </div>

    </div>
  );
}
