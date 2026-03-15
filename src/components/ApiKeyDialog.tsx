import { useState } from 'react';
import { useApp } from '../context/AppContext';

export function ApiKeyDialog() {
  const { dispatch } = useApp();
  const [key, setKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      dispatch({ type: 'SET_API_KEY', key: key.trim() });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-surface-raised border border-border p-6 w-80 flex flex-col gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-text-primary">vox</h2>
          <p className="text-[10px] text-text-muted mt-1">
            enter your anthropic api key to enable refinement.
          </p>
        </div>
        <input
          type="password"
          placeholder="sk-ant-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full text-xs px-3 py-2 bg-surface border border-border text-text-primary outline-none focus:border-border-focus"
          autoFocus
        />
        <button
          type="submit"
          disabled={!key.trim()}
          className="text-xs px-4 py-2 bg-accent text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          save key
        </button>
      </form>
    </div>
  );
}
