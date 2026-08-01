import { useState } from 'react';
import { AppProvider } from './context/AppContext';
import { RecordingProvider } from './context/RecordingContext';
import { Sidebar } from './components/layout/Sidebar';
import { MainPanel } from './components/layout/MainPanel';

function AppInner() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <RecordingProvider>
      <div className="app-shell flex h-screen overflow-hidden text-text-primary">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {sidebarOpen && (
          <button
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="close library"
          />
        )}
        <MainPanel onToggleSidebar={() => setSidebarOpen((open) => !open)} />
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
