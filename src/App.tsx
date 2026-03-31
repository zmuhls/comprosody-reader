import { AppProvider } from './context/AppContext';
import { RecordingProvider } from './context/RecordingContext';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';

function AppInner() {
  return (
    <RecordingProvider>
      <div className="flex h-screen overflow-hidden bg-surface">
        <Sidebar />
        <MainPanel />
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
