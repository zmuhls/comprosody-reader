import type { Variant } from '../../types/llm';

interface Props {
  variants: Variant[];
  onAccept: (variant: Variant) => void;
}

const LABEL_STYLES: Record<string, { border: string; text: string; bg: string }> = {
  cool: {
    border: 'border-cool/50',
    text: 'text-cool',
    bg: 'bg-cool/10',
  },
  warm: {
    border: 'border-warm/50',
    text: 'text-warm',
    bg: 'bg-warm/10',
  },
  hot: {
    border: 'border-hot/50',
    text: 'text-hot',
    bg: 'bg-hot/10',
  },
};

export function VariantCards({ variants, onAccept }: Props) {
  if (variants.length === 0) return null;

  return (
    <div className="border-t border-border p-3 bg-surface-raised">
      <div className="text-[10px] text-text-muted mb-2 uppercase tracking-wider">
        variants — click to accept
      </div>
      <div className="grid grid-cols-3 gap-2">
        {variants.map((v) => {
          const style = LABEL_STYLES[v.label];
          return (
            <button
              key={v.label}
              onClick={() => onAccept(v)}
              className={`text-left p-2 border ${style.border} ${style.bg} hover:border-opacity-100 transition-colors rounded`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-bold uppercase ${style.text}`}>
                  {v.label}
                </span>
                <span className="text-[9px] text-text-muted">
                  t={v.temperature}
                </span>
              </div>
              <p className="text-[10px] text-text-secondary line-clamp-4 leading-relaxed">
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
