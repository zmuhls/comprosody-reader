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
    <aside className="w-52 flex-shrink-0 bg-surface-raised border-r border-border flex flex-col h-screen">
      <div className="px-4 py-4 border-b border-border">
        <h1 className="font-brand text-lg text-text-primary tracking-wide italic">
          comprosody
        </h1>
        <p className="text-[10px] font-ui text-text-muted mt-0.5 tracking-widest uppercase">
          dictation to prose
        </p>
      </div>

      <EntryActions />

      <div className="flex-1 overflow-y-auto">
        <DirectoryTree />
      </div>

      <div className="border-t border-border px-4 py-2">
        <span className="text-[10px] text-text-muted flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
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
