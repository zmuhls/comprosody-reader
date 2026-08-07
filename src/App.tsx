import { useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { RecordingProvider } from './context/RecordingContext';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';
import { ErrorBanner } from './components/layout/ErrorBanner';
import { CommandPalette } from './components/layout/CommandPalette';
import { Tooltip } from 'radix-ui';
import { LibraryProvider, useLibrary } from './context/LibraryContext';
import { ReadingPane } from './components/library/ReadingPane';
import { SpeechProvider } from './context/SpeechContext';
import { Icon } from './components/ui/Icon';
import { SidebarResizer } from './components/layout/SidebarResizer';
import { installVisualViewportSync } from './lib/visualViewport';

type MobileWorkspaceView = 'reader' | 'note';

interface MobileWorkspaceSelection {
  publicationId: string | null;
  view: MobileWorkspaceView;
}

function AppInner() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    window.matchMedia?.('(max-width: 900px)').matches ?? false,
  );
  const [sidebarReturnFocusTarget, setSidebarReturnFocusTarget] =
    useState<HTMLElement | null>(null);
  const [mobileWorkspaceSelection, setMobileWorkspaceSelection] =
    useState<MobileWorkspaceSelection>({
      publicationId: null,
      view: 'reader',
    });
  const { activePublication } = useLibrary();
  const { state, dispatch } = useApp();
  const previousPublicationIdRef = useRef<string | null>(null);
  const scopedPublicationIdRef = useRef<string | null>(null);

  useEffect(() => installVisualViewportSync(), []);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setIsNarrowViewport(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const activePublicationId = activePublication?.id ?? null;
  const mobileWorkspaceView =
    mobileWorkspaceSelection.publicationId === activePublicationId
      ? mobileWorkspaceSelection.view
      : 'reader';
  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  // Writing belongs to the book it was written against. Changing books swaps in
  // that book's most recent work instead of carrying the previous book's note
  // across, which is what made every book look like it shared one note.
  useEffect(() => {
    if (scopedPublicationIdRef.current === activePublicationId) return;
    scopedPublicationIdRef.current = activePublicationId;
    const current = state.activeEntryId
      ? state.entries[state.activeEntryId]
      : null;
    if ((current?.publicationId ?? null) === activePublicationId) return;
    const next = Object.values(state.entries)
      .filter((entry) => (entry.publicationId ?? null) === activePublicationId)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    dispatch({ type: 'SET_ACTIVE_ENTRY', id: next?.id ?? null });
  }, [activePublicationId, dispatch, state.activeEntryId, state.entries]);

  useEffect(() => {
    const contextTitle = activePublication && mobileWorkspaceView === 'reader'
      ? activePublication.title
      : activeEntry?.name;
    document.title = contextTitle
      ? `${contextTitle} — Comprosody`
      : 'Comprosody';
  }, [activeEntry?.name, activePublication, mobileWorkspaceView]);

  useEffect(() => {
    const previousPublicationId = previousPublicationIdRef.current;
    previousPublicationIdRef.current = activePublicationId;
    if (!activePublicationId && !previousPublicationId) return;
    const targetId = activePublicationId && mobileWorkspaceView === 'reader'
      ? 'reading-content'
      : 'main-content';
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus({ preventScroll: true });
    });
  }, [activePublicationId, mobileWorkspaceView]);

  const selectMobileWorkspaceView = (view: MobileWorkspaceView) => {
    setMobileWorkspaceSelection({
      publicationId: activePublicationId,
      view,
    });
  };
  const openSidebar = (returnFocusTarget?: HTMLElement) => {
    setSidebarReturnFocusTarget(
      returnFocusTarget ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null),
    );
    setIsSidebarOpen(true);
  };
  const sidebarModalOpen = isNarrowViewport && isSidebarOpen;
  const skipToReading = Boolean(
    activePublication && mobileWorkspaceView === 'reader',
  );

  return (
    <RecordingProvider>
      <Tooltip.Provider delayDuration={450}>
        <div className="app-frame">
          <a
            className="skip-link"
            href={skipToReading ? '#reading-content' : '#main-content'}
            inert={sidebarModalOpen ? true : undefined}
          >
            {skipToReading ? 'Skip to reading' : 'Skip to note'}
          </a>
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            returnFocusTarget={sidebarReturnFocusTarget}
          />
          <div
            aria-label="Workspace sizing"
            className="sidebar-resizer-region"
            role="region"
          >
            <SidebarResizer />
          </div>
          <div
            className={`workspace-stage ${
              activePublication
                ? `is-reading mobile-view-${mobileWorkspaceView}`
                : ''
            }`}
            inert={sidebarModalOpen ? true : undefined}
          >
            {activePublication ? (
              <nav
                aria-label="Reading workspace view"
                className="mobile-workspace-switch"
              >
                <button
                  aria-label="Open workspace menu"
                  className="mobile-workspace-menu"
                  onClick={(event) => openSidebar(event.currentTarget)}
                  type="button"
                >
                  <Icon name="menu" size={18} />
                </button>
                <button
                  aria-controls="reading-content"
                  aria-pressed={mobileWorkspaceView === 'reader'}
                  data-active={mobileWorkspaceView === 'reader'}
                  onClick={() => selectMobileWorkspaceView('reader')}
                  type="button"
                >
                  Reader
                </button>
                <button
                  aria-controls="main-content"
                  aria-pressed={mobileWorkspaceView === 'note'}
                  data-active={mobileWorkspaceView === 'note'}
                  onClick={() => selectMobileWorkspaceView('note')}
                  type="button"
                >
                  Note
                </button>
              </nav>
            ) : null}
            {activePublication ? <ReadingPane key="reading-pane" /> : null}
            <div className="app-main" key="note-pane">
              <ErrorBanner />
              <MainPanel
                onOpenSidebar={openSidebar}
                publicationId={activePublicationId}
              />
            </div>
          </div>
          {sidebarModalOpen ? null : <CommandPalette />}
        </div>
      </Tooltip.Provider>
    </RecordingProvider>
  );
}

function App() {
  return (
    <AppProvider>
      <LibraryProvider>
        <SpeechProvider>
          <AppInner />
        </SpeechProvider>
      </LibraryProvider>
    </AppProvider>
  );
}

export default App;
