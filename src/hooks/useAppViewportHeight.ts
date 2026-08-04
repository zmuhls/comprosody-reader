import { useEffect } from 'react';

/**
 * Mirrors the visual viewport height into a `--app-height` CSS variable
 * (consumed by the `h-app` utility in index.css).
 *
 * iOS Safari never resizes the layout viewport for the on-screen keyboard —
 * it slides the keyboard over the page and pans the window to reveal the
 * caret, which shears a fixed `h-screen`/`100dvh` shell out of view. Only
 * the VisualViewport API observes the keyboard, so the shell binds to this
 * variable and compresses into the visible area instead.
 */
export function useAppViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const apply = () => {
      // height × scale = layout-viewport CSS pixels not covered by the
      // keyboard, so pinch-zoom cancels out and only the keyboard shrinks
      // the shell.
      root.style.setProperty(
        '--app-height',
        `${Math.round(viewport.height * viewport.scale)}px`
      );
      // Undo the focus pan: with the shell resized the caret is already
      // visible, so any residual window scroll just hides the header.
      if (window.scrollY > 0) window.scrollTo(0, 0);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      root.style.removeProperty('--app-height');
    };
  }, []);
}
