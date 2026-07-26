import { useApp } from '../../context/AppContext';
import { GENRES, SCALES } from '../../constants';
import type { GenreRegister, Scale } from '../../types/llm';

interface Props {
  onRefine: () => void;
  onRefineSelection: () => void;
  onGenerateVariants: () => void;
  onSeedDraft: () => void;
  onUndo: () => void;
  onCopy: () => void;
  onExport: () => void;
  canUndo: boolean;
  copied: boolean;
  hasSelection: boolean;
  hasTranscript: boolean;
  hasRefinedText: boolean;
  isRefining: boolean;
  isGeneratingVariants: boolean;
}

const SECONDARY_BUTTON =
  'border border-border px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35';

export function Toolbar({
  onRefine,
  onRefineSelection,
  onGenerateVariants,
  onSeedDraft,
  onUndo,
  onCopy,
  onExport,
  canUndo,
  copied,
  hasSelection,
  hasTranscript,
  hasRefinedText,
  isRefining,
  isGeneratingVariants,
}: Props) {
  const { state, dispatch } = useApp();
  const { refinementSettings } = state;
  const hasEntry = !!state.activeEntryId;
  const canRefine =
    hasEntry && hasTranscript && !isRefining && !isGeneratingVariants;
  const hasContent = hasTranscript || hasRefinedText;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3">
      {/* Genre */}
      <select
        value={refinementSettings.genre}
        onChange={(e) =>
          dispatch({
            type: 'UPDATE_REFINEMENT_SETTINGS',
            settings: { genre: e.target.value as GenreRegister },
          })
        }
        className="border border-border bg-transparent px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary outline-none transition-colors focus:border-accent/50"
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
        className="border border-border bg-transparent px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-text-secondary outline-none transition-colors focus:border-accent/50"
      >
        {SCALES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {/* Temperature */}
      <div className="flex items-center gap-2 border border-border px-3 py-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
          temp
        </span>
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
          className="h-1 w-24 accent-accent"
        />
        <span className="w-8 text-[10px] tabular-nums text-text-muted">
          {refinementSettings.temperature.toFixed(2)}
        </span>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={onSeedDraft}
        disabled={!hasTranscript || isRefining || isGeneratingVariants}
        className={SECONDARY_BUTTON}
      >
        {hasRefinedText ? 'reset draft' : 'seed draft'}
      </button>

      <button
        onClick={onUndo}
        disabled={!canUndo || isRefining || isGeneratingVariants}
        className={SECONDARY_BUTTON}
      >
        undo
      </button>

      <button
        onClick={onRefine}
        disabled={!canRefine}
        className="border border-accent bg-accent px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-canvas transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
      >
        {isRefining ? 'refining...' : 'refine'}
      </button>

      <button
        onClick={onRefineSelection}
        disabled={!canRefine || !hasSelection}
        className={SECONDARY_BUTTON}
      >
        selection
      </button>

      <button
        onClick={onGenerateVariants}
        disabled={!canRefine}
        className={SECONDARY_BUTTON}
      >
        {isGeneratingVariants ? 'generating...' : 'variants'}
      </button>

      <button
        onClick={onCopy}
        disabled={!hasContent}
        className={`border border-border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-35 ${
          copied
            ? 'text-success'
            : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        {copied ? 'copied' : 'copy'}
      </button>

      <button
        onClick={onExport}
        disabled={!hasContent}
        className={SECONDARY_BUTTON}
      >
        export
      </button>
    </div>
  );
}
