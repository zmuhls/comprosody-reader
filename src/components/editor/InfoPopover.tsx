import { useState, useRef, useEffect, useId, type ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

/**
 * A small ⓘ affordance for plain-language explanations. One shared component
 * so the settings rail and the passes bar explain temperature the same way.
 */
export function InfoPopover({ label, children }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        aria-controls={isOpen ? contentId : undefined}
        onClick={() => setIsOpen((open) => !open)}
        aria-label={label}
        aria-expanded={isOpen}
        className={`info-popover-trigger flex h-8 w-8 items-center justify-center rounded-full border text-[11px] leading-none transition-colors ${
          isOpen
            ? 'border-accent text-accent'
            : 'border-border text-text-muted hover:border-border-focus hover:text-text-secondary'
        }`}
        type="button"
      >
        i
      </button>
      {isOpen && (
        <div
          className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 border border-border bg-surface-overlay px-4 py-3 text-[11px] normal-case leading-relaxed tracking-normal text-text-secondary shadow-[0_22px_70px_rgba(0,0,0,0.42)]"
          id={contentId}
          role="note"
        >
          {children}
        </div>
      )}
    </div>
  );
}
