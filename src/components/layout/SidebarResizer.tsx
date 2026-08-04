import { useEffect, useState } from 'react';
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from '../../lib/sidebarWidth';

const SIDEBAR_WIDTH_KEY = 'comprosody:sidebar-width';

function initialSidebarWidth(): number {
  try {
    const stored = Number.parseFloat(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '');
    return Number.isFinite(stored) ? clampSidebarWidth(stored) : 232;
  } catch {
    return 232;
  }
}

export function SidebarResizer() {
  const [width, setWidth] = useState(initialSidebarWidth);
  const finishResize = () => {
    delete document.documentElement.dataset.sidebarResizing;
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch {
      // Resizing remains available for this session when storage is blocked.
    }
  }, [width]);

  return (
    <div
      aria-label="Resize note directory"
      aria-orientation="vertical"
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuenow={width}
      className="sidebar-resizer"
      onKeyDown={(event) => {
        const step = event.shiftKey ? 24 : 8;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setWidth((current) => clampSidebarWidth(current - step));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          setWidth((current) => clampSidebarWidth(current + step));
        } else if (event.key === 'Home') {
          event.preventDefault();
          setWidth(MIN_SIDEBAR_WIDTH);
        } else if (event.key === 'End') {
          event.preventDefault();
          setWidth(MAX_SIDEBAR_WIDTH);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.dataset.sidebarResizing = 'true';
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        setWidth(clampSidebarWidth(event.clientX));
      }}
      onLostPointerCapture={finishResize}
      onPointerCancel={finishResize}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finishResize();
      }}
      role="separator"
      tabIndex={0}
    />
  );
}
