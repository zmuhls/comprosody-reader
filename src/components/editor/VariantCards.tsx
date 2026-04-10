import type { Variant } from '../../types/llm';

interface Props {
  variants: Variant[];
  onAccept: (variant: Variant) => void;
}

const LABEL_STYLES: Record<
  string,
  { border: string; text: string; bg: string }
> = {
  cool: {
    border: 'border-cool/40',
    text: 'text-cool',
    bg: 'bg-cool/5',
  },
  warm: {
    border: 'border-warm/40',
    text: 'text-warm',
    bg: 'bg-warm/5',
  },
  hot: {
    border: 'border-hot/40',
    text: 'text-hot',
    bg: 'bg-hot/5',
  },
};

export function VariantCards({ variants, onAccept }: Props) {
  if (variants.length === 0) return null;

  return (
    <div className="border-t border-border bg-surface px-5 py-4">
      <div className="mb-3 text-[10px] uppercase tracking-[0.28em] text-text-muted">
        variant passes
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {variants.map((v) => {
          const style = LABEL_STYLES[v.label];
          return (
            <button
              key={v.label}
              onClick={() => onAccept(v)}
              className={`border ${style.border} ${style.bg} p-4 text-left transition-all hover:-translate-y-px hover:border-opacity-100`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span
                  className={`text-[10px] font-medium uppercase tracking-[0.24em] ${style.text}`}
                >
                  {v.label}
                </span>
                <span className="text-[9px] tabular-nums text-text-muted">
                  t={v.temperature}
                </span>
              </div>
              <p className="line-clamp-5 text-sm leading-relaxed text-text-secondary font-writing">
                {v.text.slice(0, 300)}
                {v.text.length > 300 ? '...' : ''}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
