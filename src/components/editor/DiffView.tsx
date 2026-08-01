import { useMemo } from 'react';
import { diffWords } from 'diff';

interface Props {
  oldText: string;
  newText: string;
}

export function DiffView({ oldText, newText }: Props) {
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText]);

  return (
    <div className="w-full flex-1 overflow-y-auto whitespace-pre-wrap px-5 py-5 text-[1rem] leading-relaxed text-text-primary font-writing">
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.added
              ? 'text-success'
              : part.removed
                ? 'text-hot line-through opacity-70'
                : undefined
          }
        >
          {part.value}
        </span>
      ))}
    </div>
  );
}
