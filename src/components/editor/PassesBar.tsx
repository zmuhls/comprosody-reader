import { VARIANT_TEMPERATURES } from '../../constants';
import type { Variant, VariantError } from '../../types/llm';
import { InfoPopover } from './InfoPopover';

interface Props {
  variants: Variant[];
  errors: VariantError[];
  highlighted: Variant['label'] | null;
  onHighlight: (label: Variant['label'] | null) => void;
  onRetry: (label: Variant['label']) => void;
  onAccept: () => void;
  onToNote: () => void;
  onToChapter: () => void;
  canToChapter: boolean;
  onDismiss: () => void;
  isGenerating: boolean;
}

const CHIP_TITLES: Record<Variant['label'], string> = {
  cool: 'cool — closest to your wording',
  warm: 'warm — balances fidelity and flow',
  hot: 'hot — boldest rewrite',
};

const ACTION =
  'px-1.5 py-1 text-[10px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35';

export function PassesBar({
  variants,
  errors,
  highlighted,
  onHighlight,
  onRetry,
  onAccept,
  onToNote,
  onToChapter,
  canToChapter,
  onDismiss,
  isGenerating,
}: Props) {
  if (variants.length === 0 && errors.length === 0 && !isGenerating) return null;

  const available = VARIANT_TEMPERATURES.map(({ label, temperature }) => ({
    label,
    temperature,
    variant: variants.find((v) => v.label === label) ?? null,
    error: errors.find((e) => e.label === label) ?? null,
  }));
  const selectable = available.filter((slot) => slot.variant !== null);
  const hasHighlight = highlighted !== null && selectable.some((s) => s.label === highlighted);

  const cycle = (direction: 1 | -1) => {
    if (selectable.length === 0) return;
    const index = selectable.findIndex((s) => s.label === highlighted);
    const next =
      selectable[(index + direction + selectable.length) % selectable.length];
    onHighlight(next.label);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-5 py-2">
      <span className="text-[9px] uppercase tracking-[0.24em] text-text-muted">
        passes
      </span>

      <div
        role="radiogroup"
        aria-label="variant passes — highlighting one previews its diff in the draft below"
        className="flex items-center gap-1"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            cycle(1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            cycle(-1);
          } else if (e.key === 'Escape') {
            onHighlight(null);
          }
        }}
      >
        {available.map(({ label, temperature, variant, error }) => {
          if (isGenerating && !variant && !error) {
            return (
              <span
                key={label}
                className="animate-pulse px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-text-muted"
              >
                {label}…
              </span>
            );
          }
          if (error && !variant) {
            return (
              <button
                key={label}
                onClick={() => onRetry(label)}
                className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-text-muted opacity-60 transition-colors hover:text-hot hover:opacity-100"
                title={`${label} pass failed: ${error.error} — click to retry`}
              >
                {label} ↻
              </button>
            );
          }
          if (!variant) return null;
          const isOn = highlighted === label;
          return (
            <button
              key={label}
              role="radio"
              aria-checked={isOn}
              tabIndex={isOn || (!hasHighlight && label === selectable[0]?.label) ? 0 : -1}
              onClick={() => onHighlight(isOn ? null : label)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                isOn
                  ? 'text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              title={`${CHIP_TITLES[label]} · reach ${temperature}`}
            >
              <span aria-hidden="true">{isOn ? '●' : '◦'}</span>
              {label}
            </button>
          );
        })}
      </div>

      <InfoPopover label="how passes work">
        Each pass rewrites the transcript at a different{' '}
        <span className="font-medium text-text-primary">reach</span> (also
        called temperature): cool stays closest to your wording, warm balances,
        hot rewrites boldest. Highlight a chip and the draft below previews it —
        green text would be added, struck-through red text removed. Accept when
        one reads right.
      </InfoPopover>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <button onClick={onAccept} disabled={!hasHighlight} className={`${ACTION} ${hasHighlight ? 'text-accent hover:text-accent-hover' : ''}`}>
          accept
        </button>
        <button onClick={onToNote} disabled={!hasHighlight} className={ACTION}>
          → note
        </button>
        <button
          onClick={onToChapter}
          disabled={!hasHighlight || !canToChapter}
          className={ACTION}
          title={canToChapter ? 'append as a new chapter' : 'entry is not inside a book'}
        >
          + chapter
        </button>
        <button onClick={onDismiss} className={ACTION}>
          dismiss
        </button>
      </div>
    </div>
  );
}
