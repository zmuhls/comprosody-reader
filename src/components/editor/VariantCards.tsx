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
    <div className="border-t border-border p-4 bg-surface-raised">
      <div className="text-[10px] text-text-muted mb-3 uppercase tracking-widest">
        variants — click to accept
      </div>
      <div className="grid grid-cols-3 gap-3">
        {variants.map((v) => {
          const style = LABEL_STYLES[v.label];
          return (
            <button
              key={v.label}
              onClick={() => onAccept(v)}
              className={`text-left p-3 border ${style.border} ${style.bg} hover:border-opacity-100 transition-all rounded-sm`}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-[10px] font-medium uppercase tracking-wider ${style.text}`}
                >
                  {v.label}
                </span>
                <span className="text-[9px] text-text-muted tabular-nums">
                  t={v.temperature}
                </span>
              </div>
              <p className="text-xs text-text-secondary line-clamp-4 leading-relaxed font-writing">
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
