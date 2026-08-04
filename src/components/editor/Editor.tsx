import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { Dialog, DropdownMenu, Tooltip } from 'radix-ui';
import { useApp } from '../../context/AppContext';
import { useStorage } from '../../hooks/useStorage';
import type { ProsodyDiagnostics } from '../../types/audio';
import type { TranscriptionProviderId } from '../../types/transcription';
import {
  isDocumentRevisionCurrent,
  type RefinementController,
} from '../../hooks/useRefinement';
import { Icon } from '../ui/Icon';
import { RecordingDock } from '../dictation/RecordingDock';
import { RefinementComposer } from './Toolbar';
import { VariantCards } from './VariantCards';
import { RefinementSidecar } from './RefinementSidecar';
import type { Entry } from '../../types/editor';
import { LinkedPassages } from '../library/LinkedPassages';
import { SpeechControl } from '../speech/SpeechControl';
import { useAutomaticNoteTitle } from '../../hooks/useAutomaticNoteTitle';
import { AudioTakes } from './AudioTakes';

interface Props {
  backgroundLimitMs: number;
  backgroundNotice: string;
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
  interimTranscript: string;
  isRecording: boolean;
  isTranscribing: boolean;
  onOpenSidebar: (returnFocusTarget?: HTMLElement) => void;
  onBackgroundLimitChange: (milliseconds: number) => void;
  onProviderChange: (provider: TranscriptionProviderId) => void;
  onStart: () => void;
  onStop: () => void;
  prosody: ProsodyDiagnostics;
  provider: TranscriptionProviderId;
  refinement: RefinementController;
  startedAt?: number;
}

function documentDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function safeFilename(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'untitled-note';
}

export function DocumentTitle({
  entry,
  onCommit,
  onEditingChange,
  onEnterBody,
}: {
  entry: Entry;
  onCommit: (title: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onEnterBody: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({
    baseName: entry.name,
    value: entry.name,
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const displayRef = useRef<HTMLButtonElement | null>(null);
  const lastTouchAtRef = useRef(Number.NEGATIVE_INFINITY);
  const value = isEditing ? draft.value : entry.name;

  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const beginEditing = () => {
    setDraft({ baseName: entry.name, value: entry.name });
    onEditingChange?.(true);
    setIsEditing(true);
  };

  const commit = (enterBody = false) => {
    const nextTitle = value.trim() || 'Untitled';
    setDraft({ baseName: entry.name, value: nextTitle });
    if (nextTitle !== entry.name) onCommit(nextTitle);
    setIsEditing(false);
    onEditingChange?.(false);
    if (enterBody) onEnterBody();
  };

  if (!isEditing) {
    return (
      <button
        aria-label={`Rename note title: ${entry.name}`}
        className="document-title document-title-display"
        onClick={(event) => {
          if (event.detail === 0) beginEditing();
        }}
        onDoubleClick={beginEditing}
        onKeyDown={(event) => {
          if (!['Enter', ' ', 'F2'].includes(event.key)) return;
          event.preventDefault();
          beginEditing();
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
          const now = performance.now();
          if (now - lastTouchAtRef.current <= 460) {
            event.preventDefault();
            beginEditing();
            lastTouchAtRef.current = Number.NEGATIVE_INFINITY;
          } else {
            lastTouchAtRef.current = now;
          }
        }}
        title="Double-click or double-tap to rename"
        type="button"
        ref={displayRef}
      >
        {entry.name}
      </button>
    );
  }

  return (
    <input
      aria-label="Note title"
      className="document-title document-title-input"
      onBlur={() => commit()}
      onChange={(event) =>
        setDraft({ baseName: entry.name, value: event.target.value })
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft({ baseName: entry.name, value: entry.name });
          setIsEditing(false);
          onEditingChange?.(false);
          window.requestAnimationFrame(() => displayRef.current?.focus());
        }
      }}
      ref={inputRef}
      value={value}
    />
  );
}

export function SourceTranscriptDrawer({
  audioTakes,
  entryId,
  interimTranscript,
  isOpen,
  onClose,
  rawTranscript,
}: {
  audioTakes?: number;
  entryId: string;
  interimTranscript: string;
  isOpen: boolean;
  onClose: () => void;
  rawTranscript: string;
}) {
  if (!isOpen) return null;

  return (
    <aside
      aria-label="Source transcript"
      className="source-drawer is-open"
      id="source-transcript-drawer"
    >
      <div className="source-drawer-header">
        <div>
          <strong>Source transcript</strong>
          <span>Unrefined speech record</span>
        </div>
        <button
          aria-label="Close source transcript"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="source-transcript-copy">
        {rawTranscript || 'No transcript has been recorded yet.'}
        {interimTranscript ? ` ${interimTranscript}` : ''}
      </div>
      <AudioTakes entryId={entryId} audioTakes={audioTakes} />
    </aside>
  );
}

export const Editor = memo(function Editor({
  backgroundLimitMs,
  backgroundNotice,
  drawWaveform,
  interimTranscript,
  isRecording,
  isTranscribing,
  onOpenSidebar,
  onBackgroundLimitChange,
  onProviderChange,
  onStart,
  onStop,
  prosody,
  provider,
  refinement,
  startedAt,
}: Props) {
  const {
    state,
    dispatch,
    storageReady,
    titleEditingEntryId,
    setTitleEditingEntryId,
  } = useApp();
  const { createEntry } = useStorage();
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [isRefinementOpen, setIsRefinementOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    window.matchMedia('(max-width: 900px)').matches,
  );
  const [hasSelection, setHasSelection] = useState(false);
  const [hasPendingUpdate, setHasPendingUpdate] = useState(false);
  const activeEntryIdRef = useRef<string | null>(state.activeEntryId);
  const pendingUpdateRef = useRef<{ id: string; markdown: string } | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocalMarkdownRef = useRef('');
  const lastEntryIdRef = useRef<string | null>(null);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;
  const automaticTitleStatus = useAutomaticNoteTitle(
    activeEntry,
    Boolean(activeEntry && titleEditingEntryId === activeEntry.id),
  );
  const handleTitleEditingChange = useCallback((editing: boolean) => {
    const entryId = activeEntryIdRef.current;
    setTitleEditingEntryId((current) => {
      if (editing) return entryId;
      return current === entryId ? null : current;
    });
  }, [setTitleEditingEntryId]);

  useEffect(() => {
    activeEntryIdRef.current = state.activeEntryId;
  }, [state.activeEntryId]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setIsNarrowViewport(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const flushPendingUpdate = useCallback((updateStatus = true) => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
    const pending = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    if (!pending) return;
    dispatch({
      type: 'UPDATE_ENTRY',
      id: pending.id,
      updates: { refinedText: pending.markdown },
      recordHistory: false,
    });
    if (updateStatus) setHasPendingUpdate(false);
  }, [dispatch]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Placeholder.configure({
        placeholder: 'Begin writing, or press the microphone and begin speaking…',
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: false },
      }),
    ],
    content: activeEntry?.refinedText || activeEntry?.rawTranscript || '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        'aria-label': 'Note body',
        'aria-multiline': 'true',
        class: 'document-prose',
        role: 'textbox',
        spellcheck: 'true',
      },
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      setHasSelection(!currentEditor.state.selection.empty);
    },
    onUpdate: ({ editor: currentEditor }) => {
      const entryId = activeEntryIdRef.current;
      if (!entryId) return;
      const markdown = currentEditor.getMarkdown();
      lastLocalMarkdownRef.current = markdown;
      pendingUpdateRef.current = { id: entryId, markdown };
      setHasPendingUpdate(true);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(flushPendingUpdate, 350);
    },
  });

  useEffect(() => {
    return () => flushPendingUpdate(false);
  }, [flushPendingUpdate]);

  useEffect(() => {
    if (!editor || !activeEntry) return;
    const incoming = activeEntry.refinedText || activeEntry.rawTranscript || '';
    const switchedEntry = lastEntryIdRef.current !== activeEntry.id;
    const isExternalUpdate = incoming !== lastLocalMarkdownRef.current;

    if (switchedEntry || isExternalUpdate) {
      editor.commands.setContent(incoming, {
        contentType: 'markdown',
        emitUpdate: false,
      });
      lastLocalMarkdownRef.current = incoming;
      lastEntryIdRef.current = activeEntry.id;
    }
  }, [activeEntry, editor]);

  const exportMarkdown = useCallback(() => {
    if (!activeEntry || !editor) return;
    const body = editor.getMarkdown().trim();
    const markdown = `# ${activeEntry.name}\n\n${body}\n`;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(activeEntry.name)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [activeEntry, editor]);

  const applyInstruction = useCallback(
    async (instruction: string): Promise<boolean> => {
      if (!editor || !activeEntry) return false;
      setIsRefinementOpen(true);
      flushPendingUpdate();
      const { from, to, empty } = editor.state.selection;

      if (!empty) {
        const documentText = editor.getMarkdown();
        const selection = editor.state.doc.textBetween(from, to, '\n');
        const contextBefore = editor.state.doc.textBetween(
          Math.max(0, from - 320),
          from,
          '\n',
        );
        const contextAfter = editor.state.doc.textBetween(
          to,
          Math.min(editor.state.doc.content.size, to + 320),
          '\n',
        );
        const result = await refinement.refineSelection({
          selection,
          contextBefore,
          contextAfter,
          documentText,
          from,
          instruction,
          to,
        });
        return Boolean(result);
      }

      const result = await refinement.refine({
        mode: 'faithful',
        instruction,
        sourceText: editor.getMarkdown(),
      });
      return Boolean(result);
    },
    [activeEntry, editor, flushPendingUpdate, refinement],
  );

  const acceptRefinement = useCallback((): boolean => {
    flushPendingUpdate();
    return refinement.acceptProposal((candidate) => {
      if (
        !editor ||
        editor.isDestroyed ||
        !activeEntry ||
        activeEntryIdRef.current !== candidate.entryId
      ) {
        return false;
      }

      const persistAcceptedMarkdown = (markdown: string) => {
        if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
          updateTimerRef.current = null;
        }
        pendingUpdateRef.current = null;
        lastLocalMarkdownRef.current = markdown;
        setHasPendingUpdate(false);
        dispatch({
          type: 'UPDATE_ENTRY',
          id: candidate.entryId,
          updates: { refinedText: markdown },
          recordHistory: true,
        });
      };

      const target = candidate.selectionTarget;
      if (target) {
        if (
          editor.getMarkdown() !== target.documentText ||
          target.from < 0 ||
          target.to <= target.from
        ) {
          return false;
        }
        const applied = editor
          .chain()
          .focus()
          .insertContentAt(
            { from: target.from, to: target.to },
            candidate.text,
            { contentType: 'markdown' },
          )
          .run();
        if (applied) persistAcceptedMarkdown(editor.getMarkdown());
        return applied;
      }

      const currentMarkdown = editor.getMarkdown();
      if (
        !isDocumentRevisionCurrent(
          candidate.startedRevision,
          {
            rawTranscript: activeEntry.rawTranscript,
            refinedText: currentMarkdown,
          },
          candidate.sourceText,
        )
      ) {
        return false;
      }

      const applied = editor.commands.setContent(candidate.text, {
        contentType: 'markdown',
        emitUpdate: false,
      });
      if (applied) persistAcceptedMarkdown(candidate.text);
      return applied;
    });
  }, [
    activeEntry,
    dispatch,
    editor,
    flushPendingUpdate,
    refinement,
  ]);

  const retryRefinement = useCallback(
    async (guidance: string): Promise<boolean> => {
      const proposal = refinement.proposal;
      if (!editor || editor.isDestroyed || !activeEntry || !proposal) {
        return false;
      }

      const documentText = editor.getMarkdown();
      flushPendingUpdate();
      const { from, to, empty } = editor.state.selection;
      const selection = proposal.selectionTarget && !empty
        ? {
            selection: editor.state.doc.textBetween(from, to, '\n'),
            contextBefore: editor.state.doc.textBetween(
              Math.max(0, from - 320),
              from,
              '\n',
            ),
            contextAfter: editor.state.doc.textBetween(
              to,
              Math.min(editor.state.doc.content.size, to + 320),
              '\n',
            ),
            documentText,
            from,
            to,
          }
        : undefined;

      const result = await refinement.retryProposal(guidance, {
        documentText,
        selection,
      });
      return Boolean(result);
    },
    [activeEntry, editor, flushPendingUpdate, refinement],
  );

  if (!activeEntry) {
    return (
      <main
        aria-label="Note workspace"
        className="editor-empty-state"
        id="main-content"
        tabIndex={-1}
      >
        <button
          className="mobile-menu-button"
          onClick={(event) => onOpenSidebar(event.currentTarget)}
          type="button"
        >
          <Icon name="menu" size={17} />
          <span>Notes</span>
        </button>
        <div>
          <h1>A quiet place for spoken thought.</h1>
          <button onClick={() => createEntry(null, 'note')} type="button">
            <Icon name="plus" size={15} />
            New note
          </button>
        </div>
      </main>
    );
  }

  const parentName = activeEntry.parentId
    ? state.directories[activeEntry.parentId]?.name ?? 'Notes'
    : 'Notes';

  return (
    <Dialog.Root
      modal={isNarrowViewport}
      onOpenChange={setIsRefinementOpen}
      open={isRefinementOpen}
    >
      <div className="editor-shell">
      <div className="editor-topbar">
        <button
          aria-label="Open note directory"
          className="icon-button mobile-directory-trigger"
          onClick={(event) => onOpenSidebar(event.currentTarget)}
          type="button"
        >
          <Icon name="menu" size={17} />
        </button>

        <button
          aria-label={`Current note: ${activeEntry.name}. Open directory`}
          className="breadcrumb"
          onClick={(event) => onOpenSidebar(event.currentTarget)}
          type="button"
        >
          <span>{parentName}</span>
          <Icon name="chevron-right" size={12} />
          <strong>{activeEntry.name}</strong>
        </button>

        <div className="editor-topbar-spacer" />

        <span className="save-state" role="status" aria-live="polite">
          {storageReady && !hasPendingUpdate ? (
            <Icon name="check" size={13} />
          ) : null}
          {!storageReady
            ? 'Opening local store'
            : hasPendingUpdate
              ? 'Saving locally'
              : 'Saved locally'}
        </span>

        <div className="topbar-actions">
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Dialog.Trigger asChild>
                <button
                  aria-label={
                    isRefinementOpen
                      ? 'Close refinement'
                      : refinement.proposal
                        ? 'Review refinement proposal'
                        : 'Open refinement'
                  }
                  aria-pressed={isRefinementOpen}
                  className="icon-button refinement-open-button"
                  data-has-proposal={Boolean(refinement.proposal)}
                  type="button"
                >
                  <Icon name="sparkles" size={16} />
                </button>
              </Dialog.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="ui-tooltip" sideOffset={7}>
                Refinement
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <SpeechControl
            getText={() => editor?.getText().trim() ?? ''}
            label="Listen to note"
          />

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                aria-controls="source-transcript-drawer"
                aria-expanded={isSourceOpen}
                aria-label={
                  isSourceOpen
                    ? 'Close source transcript'
                    : 'Open source transcript'
                }
                aria-pressed={isSourceOpen}
                className="icon-button"
                onClick={() => setIsSourceOpen((open) => !open)}
                type="button"
              >
                <Icon name="file" size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="ui-tooltip" sideOffset={7}>
                Source transcript
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                aria-label="Export Markdown"
                className="icon-button"
                onClick={exportMarkdown}
                type="button"
              >
                <Icon name="download" size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="ui-tooltip" sideOffset={7}>
                Export Markdown
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="icon-button" aria-label="More note actions">
              <Icon name="more" size={17} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" className="ui-menu" sideOffset={7}>
                <DropdownMenu.Item
                  className="ui-menu-item"
                  disabled={!editor?.can().undo()}
                  onSelect={() => editor?.chain().focus().undo().run()}
                >
                  <Icon name="undo" size={14} />
                  Undo
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="ui-menu-item"
                  disabled={!editor?.can().redo()}
                  onSelect={() => editor?.chain().focus().redo().run()}
                >
                  <Icon name="redo" size={14} />
                  Redo
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="ui-menu-separator" />
                <DropdownMenu.Item
                  className="ui-menu-item"
                  onSelect={() => setIsSourceOpen((open) => !open)}
                >
                  <Icon name="file" size={14} />
                  {isSourceOpen ? 'Hide' : 'Show'} source transcript
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="ui-menu-item"
                  disabled={refinement.isGeneratingVariants}
                  onSelect={() => void refinement.generateVariants()}
                >
                  <Icon name="sparkles" size={14} />
                  Generate variants
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <main
        aria-label="Note workspace"
        className="document-viewport"
        id="main-content"
        tabIndex={-1}
      >
        <article className="document-page">
          <time className="document-date" dateTime={new Date(activeEntry.createdAt).toISOString()}>
            {documentDate(activeEntry.createdAt)}
          </time>
          <div className="document-title-group">
            <h1 className="document-title-heading">
              <DocumentTitle
                key={activeEntry.id}
                entry={activeEntry}
                onCommit={(nextTitle) =>
                  dispatch({
                    type: 'RENAME_ENTRY',
                    id: activeEntry.id,
                    name: nextTitle,
                  })
                }
                onEditingChange={handleTitleEditingChange}
                onEnterBody={() => editor?.commands.focus('start')}
              />
            </h1>
            <span
              aria-live="polite"
              className="automatic-title-status"
              data-active={automaticTitleStatus === 'suggesting'}
            >
              {automaticTitleStatus === 'suggesting'
                ? 'Comprosody is titling this note…'
                : activeEntry.titleSource === 'agent'
                  ? 'Titled by Comprosody'
                  : ''}
            </span>
          </div>
          <LinkedPassages entryId={activeEntry.id} />
          <EditorContent editor={editor} />

          {isRecording && interimTranscript ? (
            <div className="live-transcript">
              <span aria-live="polite" role="status">Listening</span>
              {interimTranscript}
            </div>
          ) : null}
        </article>

        <SourceTranscriptDrawer
          audioTakes={activeEntry.audioTakes}
          entryId={activeEntry.id}
          interimTranscript={interimTranscript}
          isOpen={isSourceOpen}
          onClose={() => setIsSourceOpen(false)}
          rawTranscript={activeEntry.rawTranscript}
        />

        <RefinementSidecar
          hasSelection={hasSelection}
          isOpen={isRefinementOpen}
          onAccept={acceptRefinement}
          onFaithfulEdit={() => {
            setIsRefinementOpen(true);
            flushPendingUpdate();
            void refinement.refine({
              mode: 'faithful',
              sourceText: editor?.getMarkdown(),
            });
          }}
          onFullOverhaul={() => {
            setIsRefinementOpen(true);
            flushPendingUpdate();
            void refinement.refine({
              mode: 'overhaul',
              sourceText: editor?.getMarkdown(),
            });
          }}
          onInstruction={applyInstruction}
          onRetry={retryRefinement}
          refinement={refinement}
        />
      </main>

      <VariantCards
        variants={refinement.variants}
        onAccept={(variant) => {
          refinement.acceptVariant(variant);
          setIsRefinementOpen(true);
        }}
      />

      <section
        aria-label="Writing and recording controls"
        className="interaction-dock"
        data-busy={isTranscribing || refinement.isRefining}
        data-recording={isRecording}
      >
        <RefinementComposer
          hasSelection={hasSelection}
          isRefining={refinement.isRefining}
          onCancel={refinement.cancel}
          onFaithfulEdit={() => {
            setIsRefinementOpen(true);
            flushPendingUpdate();
            void refinement.refine({
              mode: 'faithful',
              sourceText: editor?.getMarkdown(),
            });
          }}
          onFullOverhaul={() => {
            setIsRefinementOpen(true);
            flushPendingUpdate();
            void refinement.refine({
              mode: 'overhaul',
              sourceText: editor?.getMarkdown(),
            });
          }}
          onInstruction={applyInstruction}
        />
        <RecordingDock
          backgroundLimitMs={backgroundLimitMs}
          backgroundNotice={backgroundNotice}
          drawWaveform={drawWaveform}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          onProviderChange={onProviderChange}
          onBackgroundLimitChange={onBackgroundLimitChange}
          onStart={onStart}
          onStop={onStop}
          prosody={prosody}
          provider={provider}
          startedAt={startedAt}
        />
      </section>
      </div>
    </Dialog.Root>
  );
});
