import { useState } from 'react';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';
import { useApp } from '../../context/AppContext';

export function Sidebar() {
  const { state, dispatch } = useApp();
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyValue, setKeyValue] = useState('');

  const handleSaveKey = () => {
    if (keyValue.trim()) {
      dispatch({ type: 'SET_API_KEY', key: keyValue.trim() });
      setShowKeyInput(false);
      setKeyValue('');
    }
  };

  return (
    <aside className="w-56 flex-shrink-0 bg-surface-raised border-r border-border flex flex-col h-screen">
      <div className="p-3 border-b border-border">
        <h1 className="text-sm font-bold text-text-primary tracking-widest uppercase">
          vox
        </h1>
        <p className="text-[10px] text-text-muted mt-0.5">
          dictation &rarr; prose
        </p>
      </div>

      <EntryActions />

      <div className="flex-1 overflow-y-auto">
        <DirectoryTree />
      </div>

      <div className="border-t border-border p-2">
        {showKeyInput ? (
          <div className="flex flex-col gap-1">
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveKey();
                if (e.key === 'Escape') setShowKeyInput(false);
              }}
              className="w-full text-xs px-2 py-1 bg-surface border border-border text-text-primary outline-none focus:border-border-focus"
              autoFocus
            />
            <div className="flex gap-1">
              <button
                onClick={handleSaveKey}
                className="flex-1 text-[10px] px-2 py-1 bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                save
              </button>
              <button
                onClick={() => setShowKeyInput(false)}
                className="flex-1 text-[10px] px-2 py-1 bg-surface-overlay text-text-secondary hover:text-text-primary transition-colors"
              >
                cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowKeyInput(true)}
            className="w-full text-[10px] text-text-muted hover:text-text-secondary transition-colors text-left px-1"
          >
            {state.apiKey ? '\u2713 api key set' : '\u26A0 set api key'}
          </button>
        )}
      </div>
    </aside>
  );
}
