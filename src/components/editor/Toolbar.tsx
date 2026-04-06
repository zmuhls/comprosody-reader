import { useApp } from '../../context/AppContext';
import { useRefinement } from '../../hooks/useRefinement';
import { GENRES, SCALES } from '../../constants';
import type { GenreRegister, Scale } from '../../types/llm';

interface Props {
  onRefineSelection: () => void;
  hasSelection: boolean;
}

export function Toolbar({ onRefineSelection, hasSelection }: Props) {
  const { state, dispatch } = useApp();
  const { isRefining, refine, isGeneratingVariants, generateVariants } =
    useRefinement();
  const { refinementSettings } = state;
  const hasEntry = !!state.activeEntryId;
  const canRefine = hasEntry && !isRefining && !isGeneratingVariants;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-surface-raised flex-wrap">
      {/* Genre */}
      <select
        value={refinementSettings.genre}
        onChange={(e) =>
          dispatch({
            type: 'UPDATE_REFINEMENT_SETTINGS',
            settings: { genre: e.target.value as GenreRegister },
          })
        }
        className="text-[11px] bg-surface border border-border text-text-secondary px-2 py-1 outline-none focus:border-accent/50 rounded-sm transition-colors"
      >
        {GENRES.map((g) => (
          <option key={g.value} value={g.value}>
            {g.label}
          </option>
        ))}
      </select>

      {/* Scale */}
      <select
        value={refinementSettings.scale}
        onChange={(e) =>
          dispatch({
            type: 'UPDATE_REFINEMENT_SETTINGS',
            settings: { scale: e.target.value as Scale },
          })
        }
        className="text-[11px] bg-surface border border-border text-text-secondary px-2 py-1 outline-none focus:border-accent/50 rounded-sm transition-colors"
      >
        {SCALES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {/* Temperature */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-muted">temp</span>
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
          className="w-20 h-1 accent-accent"
        />
        <span className="text-[10px] text-text-muted tabular-nums w-7">
          {refinementSettings.temperature.toFixed(2)}
        </span>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={refine}
        disabled={!canRefine}
        className="text-[11px] px-4 py-1.5 bg-accent text-surface font-medium hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-sm"
      >
        {isRefining ? 'refining...' : 'refine'}
      </button>

      <button
        onClick={onRefineSelection}
        disabled={!canRefine || !hasSelection}
        className="text-[11px] px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-focus disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-sm"
      >
        selection
      </button>

      <button
        onClick={generateVariants}
        disabled={!canRefine}
        className="text-[11px] px-3 py-1.5 border border-border text-text-secondary hover:text-text-primary hover:border-border-focus disabled:opacity-30 disabled:cursor-not-allowed transition-colors rounded-sm"
      >
        {isGeneratingVariants ? 'generating...' : 'variants'}
      </button>
    </div>
  );
}
