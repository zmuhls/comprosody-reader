import { memo } from 'react';
import { useApp } from '../../context/AppContext';
import { GENRES, SCALES } from '../../constants';
import type { GenreRegister, Scale } from '../../types/llm';

interface Props {
  onRefineSelection: () => void;
  hasSelection: boolean;
  isRefining: boolean;
  isGeneratingVariants: boolean;
  onRefine: () => void;
  onGenerateVariants: () => void;
}

export const Toolbar = memo(function Toolbar({
  onRefineSelection,
  hasSelection,
  isRefining,
  isGeneratingVariants,
  onRefine,
  onGenerateVariants,
}: Props) {
  const { state, dispatch } = useApp();
  const { refinementSettings } = state;
  const hasEntry = !!state.activeEntryId;
  const canRefine = hasEntry && !isRefining && !isGeneratingVariants;
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-raised flex-wrap">
      <select
        value={refinementSettings.genre}
        onChange={(e) =>
          dispatch({
            type: 'UPDATE_REFINEMENT_SETTINGS',
            settings: { genre: e.target.value as GenreRegister },
          })
        }
        className="text-[10px] bg-surface border border-border text-text-secondary px-2 py-1 outline-none focus:border-border-focus"
      >
        {GENRES.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </select>

      <select
        value={refinementSettings.scale}
        onChange={(e) =>
          dispatch({
            type: 'UPDATE_REFINEMENT_SETTINGS',
            settings: { scale: e.target.value as Scale },
          })
        }
        className="text-[10px] bg-surface border border-border text-text-secondary px-2 py-1 outline-none focus:border-border-focus"
      >
        {SCALES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        <span className="text-[9px] text-text-muted">temp</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={refinementSettings.temperature}
          onChange={(e) =>
            dispatch({
              type: 'UPDATE_REFINEMENT_SETTINGS',
              settings: { temperature: parseFloat(e.target.value) },
            })
          }
          className="w-16 h-1 accent-accent"
        />
        <span className="text-[9px] text-text-muted w-6">
          {refinementSettings.temperature.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={!canUndo}
          className="text-[10px] px-2 py-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Undo"
          title="Undo"
        >
          \u21B6 undo
        </button>
        <button
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={!canRedo}
          className="text-[10px] px-2 py-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Redo"
          title="Redo"
        >
          redo \u21B7
        </button>
      </div>

      <div className="flex-1" />

      <button
        onClick={onRefine}
        disabled={!canRefine}
        className="text-[10px] px-3 py-1 bg-accent text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {isRefining ? 'refining...' : 'refine'}
      </button>

      <button
        onClick={onRefineSelection}
        disabled={!canRefine || !hasSelection}
        className="text-[10px] px-3 py-1 bg-surface-overlay text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        refine selection
      </button>

      <button
        onClick={onGenerateVariants}
        disabled={!canRefine}
        className="text-[10px] px-3 py-1 bg-surface-overlay text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {isGeneratingVariants ? 'generating...' : 'variants'}
      </button>
    </div>
  );
});
