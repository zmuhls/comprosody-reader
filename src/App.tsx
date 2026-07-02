import { AppProvider } from './context/AppContext';
import { RecordingProvider } from './context/RecordingContext';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';
import { ErrorBanner } from './components/layout/ErrorBanner';

function AppInner() {
  return (
    <RecordingProvider>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <ErrorBanner />
          <MainPanel />
        </div>
      </div>
    </RecordingProvider>
  );
}

function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}

export default App;
