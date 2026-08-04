import {
  installVisualViewportSync,
  keepFocusedEditorControlVisible,
} from './visualViewport';

function rect(overrides: Partial<DOMRect>): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides,
  };
}

describe('visual viewport keyboard handling', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('style');
    delete document.documentElement.dataset.virtualKeyboard;
    Reflect.deleteProperty(window, 'visualViewport');
    vi.restoreAllMocks();
  });

  it('marks an iOS-sized visual viewport as keyboard-open and updates CSS vars', () => {
    const target = new EventTarget();
    const viewportHeight = window.innerHeight - 414;
    const viewport = {
      height: viewportHeight,
      offsetLeft: 0,
      offsetTop: 12,
      width: 390,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    } as unknown as VisualViewport;
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    const uninstall = installVisualViewportSync(window, document);

    expect(document.documentElement.dataset.virtualKeyboard).toBe('open');
    expect(
      document.documentElement.style.getPropertyValue('--visual-viewport-height'),
    ).toBe(`${viewportHeight}px`);
    expect(
      document.documentElement.style.getPropertyValue('--visual-viewport-top'),
    ).toBe('12px');
    expect(
      document.documentElement.style.getPropertyValue('--keyboard-inset'),
    ).toBe('402px');

    uninstall();
    expect(document.documentElement.dataset.virtualKeyboard).toBeUndefined();
  });

  it('scrolls the focused editor control above the recording dock', () => {
    const scroller = document.createElement('div');
    scroller.className = 'document-viewport';
    const input = document.createElement('textarea');
    const dock = document.createElement('div');
    dock.className = 'interaction-dock';
    scroller.append(input);
    document.body.append(scroller, dock);
    input.focus();

    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;
    input.getBoundingClientRect = () => rect({ top: 410, bottom: 450, height: 40 });
    dock.getBoundingClientRect = () => rect({ height: 82, bottom: 430 });

    keepFocusedEditorControlVisible(document, 0, 430);

    expect(scrollBy).toHaveBeenCalledWith({
      top: 118,
      behavior: 'auto',
    });
  });
});
