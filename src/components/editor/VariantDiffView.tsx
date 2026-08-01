import { useMemo } from 'react';
import { diffWords } from 'diff';

interface Props {
  oldText: string;
  newText: string;
}

/**
 * The draft pane rendered as a preview of accepting a variant: what the pass
 * would add in green, what it would remove struck through in red. The text
 * itself is the preview — no cards, no side-by-side.
 */
export function VariantDiffView({ oldText, newText }: Props) {
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText]);

  return (
    <div
      className="w-full flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-5 text-[1rem] leading-relaxed text-text-primary font-writing"
      aria-label="variant preview: green text would be added, struck-through red text removed"
    >
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.added
              ? 'text-success bg-success/10'
              : part.removed
                ? 'text-hot/80 line-through decoration-hot/50 opacity-70'
                : ''
          }
        >
          {part.value}
        </span>
      ))}
    </div>
  );
}
