import { AppProvider, useApp } from './context/AppContext';
import { RecordingProvider } from './context/RecordingContext';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';
import { ApiKeyDialog } from './components/ApiKeyDialog';

function AppInner() {
  const { state } = useApp();
  const showKeyDialog = !state.apiKey;

  return (
    <RecordingProvider>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar />
        <MainPanel />
      </div>
      {showKeyDialog && <ApiKeyDialog />}
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
