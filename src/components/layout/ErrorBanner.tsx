import { memo } from 'react';
import { useApp } from '../../context/AppContext';

export const ErrorBanner = memo(function ErrorBanner() {
  const { state, dispatch } = useApp();
  if (state.errors.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      className="flex flex-col gap-1 px-4 py-2 bg-hot/10 border-b border-hot/30"
      role="alert"
    >
      {state.errors.map((error) => (
        <div key={error.id} className="flex items-start gap-2 text-[10px]">
          <span className="text-hot font-bold uppercase shrink-0">
            {error.type} error
          </span>
          <span className="text-text-secondary flex-1">{error.message}</span>
          <button
            onClick={() => dispatch({ type: 'CLEAR_ERROR', id: error.id })}
            className="error-dismiss text-text-muted hover:text-text-primary"
            aria-label="Dismiss error"
            type="button"
          >
            \u00D7
          </button>
        </div>
      ))}
    </div>
  );
});
