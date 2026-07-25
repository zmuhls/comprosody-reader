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
import { DropdownMenu, Tooltip } from 'radix-ui';
import { useApp } from '../../context/AppContext';
import { useStorage } from '../../hooks/useStorage';
import type { ProsodyDiagnostics } from '../../types/audio';
import type { TranscriptionProviderId } from '../../types/transcription';
import type { RefinementController } from '../../hooks/useRefinement';
import { Icon } from '../ui/Icon';
import { RecordingDock } from '../dictation/RecordingDock';
import { RefinementComposer } from './Toolbar';
import { VariantCards } from './VariantCards';
import type { Entry } from '../../types/editor';
import { LinkedPassages } from '../library/LinkedPassages';
import { SpeechControl } from '../speech/SpeechControl';

interface Props {
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
  interimTranscript: string;
  isRecording: boolean;
  isTranscribing: boolean;
  onOpenSidebar: () => void;
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
  onEnterBody,
}: {
  entry: Entry;
  onCommit: (title: string) => void;
  onEnterBody: () => void;
}) {
  const [draft, setDraft] = useState({
    baseName: entry.name,
    value: entry.name,
  });
  const value = draft.baseName === entry.name ? draft.value : entry.name;

  const commit = () => {
    const nextTitle = value.trim() || 'Untitled';
    setDraft({ baseName: entry.name, value: nextTitle });
    if (nextTitle !== entry.name) onCommit(nextTitle);
  };

  return (
    <input
      aria-label="Note title"
      className="document-title"
      onBlur={commit}
      onChange={(event) =>
        setDraft({ baseName: entry.name, value: event.target.value })
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
          onEnterBody();
        }
      }}
      value={value}
    />
  );
}

export function SourceTranscriptDrawer({
  interimTranscript,
  isOpen,
  onClose,
  rawTranscript,
}: {
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
    </aside>
  );
}

export const Editor = memo(function Editor({
  drawWaveform,
  interimTranscript,
  isRecording,
  isTranscribing,
  onOpenSidebar,
  onProviderChange,
  onStart,
  onStop,
  prosody,
  provider,
  refinement,
  startedAt,
}: Props) {
  const { state, dispatch, storageReady } = useApp();
  const { createEntry } = useStorage();
  const [isSourceOpen, setIsSourceOpen] = useState(false);
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

  useEffect(() => {
    activeEntryIdRef.current = state.activeEntryId;
  }, [state.activeEntryId]);

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
        class: 'document-prose',
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

  useEffect(() => {
    editor?.setEditable(!refinement.isRefining);
  }, [editor, refinement.isRefining]);

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
      const { from, to, empty } = editor.state.selection;

      if (!empty) {
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
        const originEntryId = activeEntry.id;
        const result = await refinement.refineSelection({
          selection,
          contextBefore,
          contextAfter,
          instruction,
        });
        if (
          !result ||
          activeEntryIdRef.current !== originEntryId ||
          editor.isDestroyed
        ) {
          return false;
        }
        editor
          .chain()
          .focus()
          .insertContentAt({ from, to }, result, { contentType: 'markdown' })
          .run();
        return true;
      }

      const result = await refinement.refine({
        mode: 'faithful',
        instruction,
        sourceText: editor.getMarkdown(),
      });
      return Boolean(result);
    },
    [activeEntry, editor, refinement],
  );

  if (!activeEntry) {
    return (
      <div className="editor-empty-state">
        <button className="mobile-menu-button" onClick={onOpenSidebar} type="button">
          <Icon name="menu" size={17} />
          <span>Notes</span>
        </button>
        <div>
          <p>A quiet place for spoken thought.</p>
          <button onClick={() => createEntry(null)} type="button">
            <Icon name="plus" size={15} />
            New note
          </button>
        </div>
      </div>
    );
  }

  const parentName = activeEntry.parentId
    ? state.directories[activeEntry.parentId]?.name ?? 'Notes'
    : 'Notes';

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <button
          aria-label="Open note directory"
          className="icon-button mobile-directory-trigger"
          onClick={onOpenSidebar}
          type="button"
        >
          <Icon name="menu" size={17} />
        </button>

        <button className="breadcrumb" onClick={onOpenSidebar} type="button">
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
      </header>

      <main className="document-viewport">
        <article className="document-page">
          <time className="document-date" dateTime={new Date(activeEntry.createdAt).toISOString()}>
            {documentDate(activeEntry.createdAt)}
          </time>
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
            onEnterBody={() => editor?.commands.focus('start')}
          />
          <LinkedPassages entryId={activeEntry.id} />
          <EditorContent editor={editor} />

          {isRecording && interimTranscript ? (
            <div className="live-transcript" aria-live="polite">
              <span>Listening</span>
              {interimTranscript}
            </div>
          ) : null}
        </article>

        <SourceTranscriptDrawer
          interimTranscript={interimTranscript}
          isOpen={isSourceOpen}
          onClose={() => setIsSourceOpen(false)}
          rawTranscript={activeEntry.rawTranscript}
        />
      </main>

      <VariantCards
        variants={refinement.variants}
        onAccept={refinement.acceptVariant}
      />

      <div
        className="interaction-dock"
        data-busy={isTranscribing || refinement.isRefining}
        data-recording={isRecording}
      >
        <RefinementComposer
          hasSelection={hasSelection}
          isRefining={refinement.isRefining}
          onCancel={refinement.cancel}
          onFaithfulEdit={() =>
            void refinement.refine({
              mode: 'faithful',
              sourceText: editor?.getMarkdown(),
            })
          }
          onFullOverhaul={() =>
            void refinement.refine({
              mode: 'overhaul',
              sourceText: editor?.getMarkdown(),
            })
          }
          onInstruction={applyInstruction}
        />
        <RecordingDock
          drawWaveform={drawWaveform}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          onProviderChange={onProviderChange}
          onStart={onStart}
          onStop={onStop}
          prosody={prosody}
          provider={provider}
          startedAt={startedAt}
        />
      </div>
    </div>
  );
});
