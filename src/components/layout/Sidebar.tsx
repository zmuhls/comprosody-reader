import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';
import { LexiconPanel } from '../sidebar/LexiconPanel';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: Props) {
  const { dispatch } = useApp();
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch('/api/health')
        .then((r) => {
          if (!cancelled) setServerOk(r.ok);
        })
        .catch(() => {
          if (!cancelled) setServerOk(false);
        });
    };
    check();
    const interval = setInterval(check, 30_000);
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, []);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-app w-72 flex-shrink-0 flex-col border-r border-border bg-surface-raised backdrop-blur-md transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:translate-x-0 lg:bg-surface ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="border-b border-border px-5 py-5">
        <div className="flex items-start justify-between">
          <button
            onClick={() => {
              dispatch({ type: 'SET_ACTIVE_ENTRY', id: null });
              onClose();
            }}
            className="font-brand text-3xl italic text-text-primary transition-colors hover:text-accent"
            title="home"
          >
            comprosody
          </button>
          <button
            onClick={onClose}
            className="-mr-1 px-2 py-1 text-sm text-text-muted transition-colors hover:text-text-primary lg:hidden"
            aria-label="close library"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-text-muted">
          agentic reader
        </p>
      </div>

      <EntryActions />

      <div className="border-b border-border px-4 py-3">
        <input
          className="w-full border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-border-focus"
          placeholder="filter entries..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <DirectoryTree query={query} />
      </div>

      <LexiconPanel />

      <div className="border-t border-border px-5 py-4">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">
          <span
            className={`inline-block h-2 w-2 ${
              serverOk === null
                ? 'bg-text-muted'
                : serverOk
                  ? 'bg-success'
                  : 'bg-hot'
            }`}
          />
          {serverOk === null
            ? 'connecting...'
            : serverOk
              ? 'server connected'
              : 'server offline'}
        </span>
      </div>
    </aside>
  );
}
