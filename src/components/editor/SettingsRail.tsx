import { useApp } from '../../context/AppContext';
import { GENRES, SCALES } from '../../constants';
import type { GenreRegister, Scale } from '../../types/llm';
import { InfoPopover } from './InfoPopover';

const SELECT =
  'max-w-32 cursor-pointer border-b border-transparent bg-transparent py-1 text-[11px] uppercase tracking-[0.18em] text-text-secondary outline-none transition-colors hover:border-border-strong hover:text-text-primary focus:border-accent/50';

function Delimiter() {
  return (
    <span className="select-none text-text-muted/40" aria-hidden="true">
      ·
    </span>
  );
}

/**
 * The refinement settings as one quiet delimited line, ordered coarse→fine:
 * what voice → how much may change → how far it may stray.
 */
export function SettingsRail() {
  const { state, dispatch } = useApp();
  const { refinementSettings } = state;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-[0.2em] text-text-muted">
          register
        </span>
        <select
          value={refinementSettings.genre}
          onChange={(e) =>
            dispatch({
              type: 'UPDATE_REFINEMENT_SETTINGS',
              settings: { genre: e.target.value as GenreRegister },
            })
          }
          className={SELECT}
        >
          {GENRES.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </label>

      <Delimiter />

      <label className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-[0.2em] text-text-muted">
          scale
        </span>
        <select
          value={refinementSettings.scale}
          onChange={(e) =>
            dispatch({
              type: 'UPDATE_REFINEMENT_SETTINGS',
              settings: { scale: e.target.value as Scale },
            })
          }
          className={SELECT}
        >
          {SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <Delimiter />

      <div className="flex items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-[0.2em] text-text-muted">
          reach
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
          className="h-1 w-20 accent-accent"
          aria-label="reach (temperature)"
        />
        <span className="w-7 text-[10px] tabular-nums text-text-muted">
          {refinementSettings.temperature.toFixed(2)}
        </span>
        <InfoPopover label="what is reach?">
          <span className="font-medium text-text-primary">reach</span> — how far
          a pass may stray from your words. Also called temperature. Low reach
          (0.2) stays closest to your phrasing and punctuation; middle (0.5)
          balances fidelity with flow; high (0.9) rewrites boldly and varies
          more between runs. It never changes what you said — only how freely
          the pass may rephrase it.
        </InfoPopover>
      </div>
    </div>
  );
}
