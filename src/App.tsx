import { useEffect, useState } from 'react';
import { AppProvider } from './context/AppContext';
import { RecordingProvider } from './context/RecordingContext';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';
import { ErrorBanner } from './components/layout/ErrorBanner';
import { ScholarRail } from './components/layout/ScholarRail';
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
  const [sidebarReturnFocusTarget, setSidebarReturnFocusTarget] =
    useState<HTMLElement | null>(null);
  const [mobileWorkspaceSelection, setMobileWorkspaceSelection] =
    useState<MobileWorkspaceSelection>({
      publicationId: null,
      view: 'reader',
    });
  const { activePublication } = useLibrary();

  useEffect(() => installVisualViewportSync(), []);
  const activePublicationId = activePublication?.id ?? null;
  const mobileWorkspaceView =
    mobileWorkspaceSelection.publicationId === activePublicationId
      ? mobileWorkspaceSelection.view
      : 'reader';

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

  return (
    <RecordingProvider>
      <Tooltip.Provider delayDuration={450}>
        <div className="app-frame">
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            returnFocusTarget={sidebarReturnFocusTarget}
          />
          <SidebarResizer />
          <div
            className={`workspace-stage ${
              activePublication
                ? `is-reading mobile-view-${mobileWorkspaceView}`
                : ''
            }`}
          >
            {activePublication ? (
              <nav
                aria-label="Reading workspace view"
                className="mobile-workspace-switch"
              >
                <button
                  aria-label="Open note directory"
                  className="mobile-workspace-menu"
                  onClick={(event) => openSidebar(event.currentTarget)}
                  type="button"
                >
                  <Icon name="menu" size={18} />
                </button>
                <button
                  aria-pressed={mobileWorkspaceView === 'reader'}
                  data-active={mobileWorkspaceView === 'reader'}
                  onClick={() => selectMobileWorkspaceView('reader')}
                  type="button"
                >
                  Reader
                </button>
                <button
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
              <MainPanel onOpenSidebar={openSidebar} />
            </div>
          </div>
          <ScholarRail />
          <CommandPalette />
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
