import { useState, useEffect } from 'react';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';
import { LexiconPanel } from '../sidebar/LexiconPanel';

export function Sidebar() {
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
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col border-r border-border bg-surface backdrop-blur-md">
      <div className="border-b border-border px-5 py-5">
        <div className="text-[10px] uppercase tracking-[0.32em] text-text-muted">
          studio
        </div>
        <h1 className="mt-2 font-brand text-3xl italic text-text-primary">
          comprosody
        </h1>
        <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary">
          dictation to prose
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
