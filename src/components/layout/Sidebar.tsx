import { memo, useState, useEffect } from 'react';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';

export const Sidebar = memo(function Sidebar() {
  const [serverOk, setServerOk] = useState<boolean | null>(null);

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
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <aside className="w-56 flex-shrink-0 bg-surface-raised border-r border-border flex flex-col h-screen">
      <div className="p-3 border-b border-border">
        <h1 className="text-sm font-bold text-text-primary tracking-widest uppercase">
          comprosody
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
        <span className="text-[10px] text-text-muted px-1">
          {serverOk === null
            ? 'checking server...'
            : serverOk
              ? '\u2713 server connected'
              : '\u26A0 server offline'}
        </span>
      </div>
    </aside>
  );
});
