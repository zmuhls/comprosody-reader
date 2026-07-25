import { useState } from 'react';
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

type MobileWorkspaceView = 'reader' | 'note';

interface MobileWorkspaceSelection {
  publicationId: string | null;
  view: MobileWorkspaceView;
}

function AppInner() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mobileWorkspaceSelection, setMobileWorkspaceSelection] =
    useState<MobileWorkspaceSelection>({
      publicationId: null,
      view: 'reader',
    });
  const { activePublication } = useLibrary();
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

  return (
    <RecordingProvider>
      <Tooltip.Provider delayDuration={450}>
        <div className="app-frame">
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
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
              <MainPanel onOpenSidebar={() => setIsSidebarOpen(true)} />
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
