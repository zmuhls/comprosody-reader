import { useState, useEffect } from 'react';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';

export function Sidebar() {
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServerOk(r.ok))
      .catch(() => setServerOk(false));
  }, []);

  return (
    <aside className="flex h-screen w-64 flex-shrink-0 flex-col border-r border-border bg-surface/80 backdrop-blur-md">
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

      <div className="flex-1 overflow-y-auto">
        <DirectoryTree />
      </div>

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
