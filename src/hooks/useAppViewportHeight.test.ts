import { renderHook } from '@testing-library/react';
import { useAppViewportHeight } from './useAppViewportHeight';

class FakeVisualViewport extends EventTarget {
  height = 800;
  scale = 1;
}

function installViewport(viewport: FakeVisualViewport | undefined) {
  Object.defineProperty(window, 'visualViewport', {
    value: viewport,
    configurable: true,
    writable: true,
  });
}

describe('useAppViewportHeight', () => {
  afterEach(() => {
    installViewport(undefined);
    document.documentElement.style.removeProperty('--app-height');
  });

  it('sets --app-height from the visual viewport on mount', () => {
    installViewport(Object.assign(new FakeVisualViewport(), { height: 812 }));
    renderHook(() => useAppViewportHeight());
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('812px');
  });

  it('tracks keyboard show/hide via viewport resize events', () => {
    const viewport = Object.assign(new FakeVisualViewport(), { height: 812 });
    installViewport(viewport);
    renderHook(() => useAppViewportHeight());

    viewport.height = 486; // iOS keyboard open
    viewport.dispatchEvent(new Event('resize'));
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('486px');

    viewport.height = 812;
    viewport.dispatchEvent(new Event('resize'));
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('812px');
  });

  it('multiplies by scale so pinch-zoom does not collapse the shell', () => {
    // At pinch scale 2 the visual viewport halves, but the keyboard is not
    // involved — height × scale stays at the full layout height.
    installViewport(
      Object.assign(new FakeVisualViewport(), { height: 406, scale: 2 })
    );
    renderHook(() => useAppViewportHeight());
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('812px');
  });

  it('clears the variable and listeners on unmount', () => {
    const viewport = Object.assign(new FakeVisualViewport(), { height: 812 });
    installViewport(viewport);
    const { unmount } = renderHook(() => useAppViewportHeight());
    unmount();
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('');

    viewport.height = 486;
    viewport.dispatchEvent(new Event('resize'));
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('');
  });

  it('is a no-op when visualViewport is unavailable', () => {
    installViewport(undefined);
    expect(() => renderHook(() => useAppViewportHeight())).not.toThrow();
    expect(
      document.documentElement.style.getPropertyValue('--app-height')
    ).toBe('');
  });
});
