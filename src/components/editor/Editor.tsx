import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useRefinement } from '../../hooks/useRefinement';
import { countParagraphs, countWords } from '../../lib/entries';
import { formatDuration, formatUpdatedAt } from '../../lib/time';
import { copyEntryToClipboard, downloadEntry } from '../../lib/export';
import { TranscriptView } from './TranscriptView';
import { Toolbar } from './Toolbar';
import { VariantCards } from './VariantCards';
import { DiffView } from './DiffView';

interface Props {
  interimTranscript: string;
  isRecording: boolean;
}

export function Editor({ interimTranscript, isRecording }: Props) {
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
  } = useRefinement();
  const refinedRef = useRef<HTMLTextAreaElement>(null);
  const [hasSelection, setHasSelection] = useState(false);
  // Keyed by entry id so switching entries implicitly resets both flags.
  const [diffEntryId, setDiffEntryId] = useState<string | null>(null);
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
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
      <div className="flex flex-1 items-center justify-center">
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
  const variantsNote =
    variants.length > 0 && variantErrors.length > 0
      ? `${variants.length} of ${variants.length + variantErrors.length} variants returned`
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-surface/90 px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.32em] text-text-muted">
              active entry
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
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
              Keep the transcript close to the spoken source, then use controlled
              refinement passes to shape the prose instead of flattening it.
            </p>
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
          {showDiff && canDiff ? (
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
        </div>
      </div>

      <VariantCards
        variants={variants}
        onAccept={acceptVariant}
        disabled={isRefining || isGeneratingVariants}
        note={variantsNote}
      />
    </div>
  );
}
