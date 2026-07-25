import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Book,
  Contents,
  Location,
  Rendition,
} from 'epubjs';
import { useApp } from '../../context/AppContext';
import { useLibrary } from '../../context/LibraryContext';
import {
  fetchReadingState,
  publicationFileUrl,
  saveReadingState,
} from '../../lib/libraryApi';
import { addPassageLink } from '../../lib/passageLinks';
import type {
  ReaderAnnotation,
  ReaderLocation,
  LibraryPublication,
} from '../../types/library';
import { Icon } from '../ui/Icon';
import { SpeechControl } from '../speech/SpeechControl';

interface PendingSelection {
  cfiRange: string;
  exact: string;
  prefix?: string;
  suffix?: string;
}

interface PersistedReadingState {
  annotations: ReaderAnnotation[];
  location: ReaderLocation | null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const OUTBOX_KEY = 'cadence:reading-outbox:v1';

function readOutbox(): Record<string, PersistedReadingState> {
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOutbox(
  publicationId: string,
  snapshot: PersistedReadingState,
): void {
  try {
    const outbox = readOutbox();
    outbox[publicationId] = snapshot;
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // The remote save still runs when storage is restricted.
  }
}

function clearOutbox(publicationId: string): void {
  try {
    const outbox = readOutbox();
    delete outbox[publicationId];
    if (Object.keys(outbox).length === 0) {
      localStorage.removeItem(OUTBOX_KEY);
    } else {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    }
  } catch {
    // A stale outbox is safer than losing the acknowledged remote state.
  }
}

function outboxState(publicationId: string): PersistedReadingState | null {
  return readOutbox()[publicationId] ?? null;
}

function selectionContext(contents: Contents, exact: string): {
  prefix?: string;
  suffix?: string;
} {
  const documentText = contents.document.body?.textContent?.replace(/\s+/g, ' ');
  if (!documentText) return {};
  const normalizedExact = exact.replace(/\s+/g, ' ');
  const index = documentText.indexOf(normalizedExact);
  if (index < 0) return {};
  return {
    prefix: documentText.slice(Math.max(0, index - 48), index).trim() || undefined,
    suffix:
      documentText
        .slice(index + normalizedExact.length, index + normalizedExact.length + 48)
        .trim() || undefined,
  };
}

export function ReadingPane() {
  const { activePublication, locationRequest, theme } = useLibrary();
  if (!activePublication) return null;

  return (
    <PublicationReadingPane
      activePublication={activePublication}
      key={`${activePublication.id}:${theme}:${locationRequest?.requestId ?? ''}`}
    />
  );
}

function PublicationReadingPane({
  activePublication,
}: {
  activePublication: LibraryPublication;
}) {
  const { state } = useApp();
  const {
    closePublication,
    locationRequest,
    theme,
  } = useLibrary();
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const stateRef = useRef<PersistedReadingState>({
    annotations: [],
    location: null,
  });
  const revisionRef = useRef(0);
  const acknowledgedRevisionRef = useRef(0);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  const [isOpening, setIsOpening] = useState(true);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;
  const highlightStyle = useMemo(
    () =>
      theme === 'dark'
        ? {
            fill: '#b79bc4',
            'fill-opacity': '0.52',
            'mix-blend-mode': 'screen',
          }
        : {
            fill: '#b79bc4',
            'fill-opacity': '0.42',
            'mix-blend-mode': 'multiply',
          },
    [theme],
  );

  const flushSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;

    try {
      while (acknowledgedRevisionRef.current < revisionRef.current) {
        if (navigator.onLine === false) {
          setSaveState('offline');
          return;
        }
        const targetRevision = revisionRef.current;
        const snapshot = stateRef.current;
        setSaveState('saving');
        await saveReadingState(
          activePublication.id,
          snapshot.annotations,
          snapshot.location,
        );
        acknowledgedRevisionRef.current = targetRevision;
      }
      clearOutbox(activePublication.id);
      setSaveState('saved');
    } catch {
      setSaveState(navigator.onLine === false ? 'offline' : 'error');
    } finally {
      savingRef.current = false;
      if (acknowledgedRevisionRef.current < revisionRef.current) {
        setSaveState(navigator.onLine === false ? 'offline' : 'error');
      }
    }
  }, [activePublication.id]);

  const commitSnapshot = useCallback(
    (
      nextAnnotations: ReaderAnnotation[],
      nextLocation: ReaderLocation | null,
      debounceMs: number,
    ) => {
      const snapshot = {
        annotations: nextAnnotations,
        location: nextLocation,
      };
      stateRef.current = snapshot;
      revisionRef.current += 1;
      writeOutbox(activePublication.id, snapshot);
      setSaveState(navigator.onLine === false ? 'offline' : 'saving');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, debounceMs);
    },
    [activePublication.id, flushSave],
  );

  useEffect(() => {
    const publicationId = activePublication.id;
    let cancelled = false;
    let currentBook: Book | null = null;
    let currentRendition: Rendition | null = null;

    const open = async () => {
      try {
        const remoteState = await fetchReadingState(publicationId);
        if (cancelled) return;
        const recoveredState = outboxState(publicationId);
        const initialState = recoveredState ?? remoteState;
        stateRef.current = initialState;
        setAnnotations(initialState.annotations);
        setLocation(initialState.location);
        if (recoveredState) {
          revisionRef.current = 1;
          setSaveState('offline');
        } else {
          setSaveState('saved');
        }

        const { default: createBook } = await import('epubjs');
        if (cancelled || !viewerRef.current) return;
        currentBook = createBook(publicationFileUrl(publicationId));
        currentRendition = currentBook.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'none',
        });
        bookRef.current = currentBook;
        renditionRef.current = currentRendition;

        const readerColors =
          theme === 'dark'
            ? {
                background: '#0b0b0d',
                color: '#f1eff3',
                selection: '#8f7aa866',
              }
            : {
                background: '#f4f3f5',
                color: '#18161a',
                selection: '#b79bc466',
              };

        currentRendition.themes.default({
          html: {
            background: readerColors.background,
            color: readerColors.color,
            '-webkit-user-select': 'text',
            'user-select': 'text',
          },
          body: {
            background: readerColors.background,
            color: readerColors.color,
            'font-family': 'Georgia, Iowan Old Style, serif',
            'line-height': '1.62',
            padding: '0 4vw',
            '-webkit-touch-callout': 'default',
            '-webkit-user-select': 'text',
            'user-select': 'text',
          },
          p: { 'font-size': '1.04rem' },
          '::selection': { background: readerColors.selection },
        });

        currentRendition.on(
          'selected',
          (cfiRange: string, contents: Contents) => {
            if (cancelled) return;
            const selection = contents.window.getSelection();
            const exact = selection?.toString().trim();
            if (!exact) return;
            setPendingSelection({
              cfiRange,
              exact,
              ...selectionContext(contents, exact),
            });
          },
        );

        currentRendition.on('relocated', (next: Location) => {
          if (cancelled) return;
          const progress = currentBook!.locations.percentageFromCfi(
            next.start.cfi,
          );
          const nextLocation = {
            cfi: next.start.cfi,
            progress: Number.isFinite(progress) ? progress : 0,
          };
          setLocation(nextLocation);
          commitSnapshot(stateRef.current.annotations, nextLocation, 500);
        });

        await currentBook.ready;
        await currentBook.locations.generate(1200);
        if (cancelled) return;
        await currentRendition.display(
          locationRequest?.cfiRange ?? initialState.location?.cfi ?? undefined,
        );
        initialState.annotations.forEach((annotation) => {
          try {
            currentRendition?.annotations.highlight(
              annotation.cfiRange,
              {},
              undefined,
              `reading-${annotation.id}`,
              highlightStyle,
            );
          } catch {
            // A changed edition may invalidate a historical CFI. Its text-quote
            // selector remains available in the linked note for recovery.
          }
        });
        setIsOpening(false);
        if (recoveredState) void flushSave();
      } catch (caught) {
        if (cancelled) return;
        setIsOpening(false);
        setReaderError(
          caught instanceof Error
            ? caught.message
            : 'This publication could not be rendered.',
        );
      }
    };

    void open();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      currentRendition?.destroy();
      currentBook?.destroy();
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [
    activePublication.id,
    commitSnapshot,
    flushSave,
    highlightStyle,
    locationRequest?.requestId,
    locationRequest?.cfiRange,
    theme,
  ]);

  useEffect(() => {
    const retry = () => {
      if (revisionRef.current > acknowledgedRevisionRef.current) {
        void flushSave();
      }
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [flushSave]);

  const linkSelection = useCallback(async () => {
    if (!activePublication || !activeEntry || !pendingSelection) return;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const annotation: ReaderAnnotation = {
      id,
      cfiRange: pendingSelection.cfiRange,
      text: pendingSelection.exact,
      note: `Linked to ${activeEntry.name}`,
      title: activePublication.title,
      author: activePublication.author,
      createdAt,
    };

    await addPassageLink({
      id,
      annotationId: id,
      entryId: activeEntry.id,
      publicationId: activePublication.id,
      publicationTitle: activePublication.title,
      publicationAuthor: activePublication.author,
      selector: {
        cfiRange: pendingSelection.cfiRange,
        exact: pendingSelection.exact,
        prefix: pendingSelection.prefix,
        suffix: pendingSelection.suffix,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const nextAnnotations = [...annotations, annotation];
    setAnnotations(nextAnnotations);
    stateRef.current = {
      annotations: nextAnnotations,
      location: stateRef.current.location,
    };
    commitSnapshot(nextAnnotations, stateRef.current.location, 0);
    try {
      renditionRef.current?.annotations.highlight(
        annotation.cfiRange,
        {},
        undefined,
        `reading-${annotation.id}`,
        highlightStyle,
      );
    } catch {
      // The linked text still remains available through its quote selector.
    }
    setPendingSelection(null);
  }, [
    activeEntry,
    activePublication,
    annotations,
    commitSnapshot,
    highlightStyle,
    pendingSelection,
  ]);

  const saveLabel = useMemo(() => {
    if (saveState === 'saving') return 'Saving';
    if (saveState === 'offline') return 'Offline · changes kept';
    if (saveState === 'error') return 'Save interrupted';
    if (saveState === 'saved') return 'Saved';
    return '';
  }, [saveState]);

  return (
    <section
      aria-label={`Reading ${activePublication.title}`}
      className="reading-pane"
    >
      <header className="reading-toolbar">
        <button
          aria-label="Previous page"
          className="icon-button"
          disabled={isOpening}
          onClick={() => void renditionRef.current?.prev()}
          type="button"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <div className="reading-title">
          <strong>{activePublication.title}</strong>
          <span>{activePublication.author}</span>
          <small>
            {Math.round((location?.progress ?? 0) * 100)}%
          </small>
        </div>
        <button
          aria-label="Next page"
          className="icon-button"
          disabled={isOpening}
          onClick={() => void renditionRef.current?.next()}
          type="button"
        >
          <Icon name="chevron-right" size={18} />
        </button>
        <button
          aria-label="Close book"
          className="close-book"
          onClick={closePublication}
          type="button"
        >
          <Icon name="x" size={13} />
          <span>Close book</span>
        </button>
      </header>

      <div className="reading-canvas">
        {isOpening ? (
          <p className="reader-message">Typesetting pages…</p>
        ) : null}
        {readerError ? (
          <p className="reader-message reader-error">{readerError}</p>
        ) : null}
        <div className="epub-viewer" ref={viewerRef} />
        {pendingSelection ? (
          <div className="passage-action">
            <blockquote>“{pendingSelection.exact}”</blockquote>
            <SpeechControl
              getText={() => pendingSelection.exact}
              label="Listen to selected passage"
              side="top"
            />
            <button
              disabled={!activeEntry}
              onClick={() => void linkSelection()}
              type="button"
            >
              <Icon name="plus" size={14} />
              {activeEntry ? 'Link to current note' : 'Create a note to link'}
            </button>
            <button
              aria-label="Dismiss passage selection"
              className="icon-button"
              onClick={() => setPendingSelection(null)}
              type="button"
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ) : null}
        {saveLabel ? (
          <div className={`reading-save-state is-${saveState}`}>
            <span role="status">{saveLabel}</span>
            {saveState === 'error' || saveState === 'offline' ? (
              <button onClick={() => void flushSave()} type="button">
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
