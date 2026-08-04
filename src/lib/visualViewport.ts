const KEYBOARD_THRESHOLD_PX = 120;

function isEditable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && (
    element.matches('input, textarea, select, [contenteditable="true"]')
    || element.isContentEditable
  );
}

function focusedRect(documentRef: Document): DOMRect | null {
  const focused = documentRef.activeElement;
  if (!isEditable(focused)) return null;
  if (focused.isContentEditable) {
    const selection = documentRef.getSelection();
    if (selection?.rangeCount) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) return rect;
    }
  }
  return focused.getBoundingClientRect();
}

export function keepFocusedEditorControlVisible(
  documentRef: Document,
  viewportTop: number,
  viewportHeight: number,
): void {
  const focused = documentRef.activeElement;
  const rect = focusedRect(documentRef);
  if (!rect || !isEditable(focused)) return;
  const scroller = focused.closest<HTMLElement>(
    '.document-viewport, .refinement-sidecar, .source-drawer, .sidebar',
  );
  if (!scroller) return;

  const topClearance = 72;
  const dock = documentRef.querySelector<HTMLElement>('.interaction-dock');
  const dockClearance = dock?.getBoundingClientRect().height ?? 76;
  const visibleTop = viewportTop + topClearance;
  const visibleBottom = viewportTop + viewportHeight - dockClearance - 16;
  let delta = 0;
  if (rect.bottom > visibleBottom) delta = rect.bottom - visibleBottom;
  else if (rect.top < visibleTop) delta = rect.top - visibleTop;
  if (Math.abs(delta) > 1) scroller.scrollBy({ top: delta, behavior: 'auto' });
}

export function installVisualViewportSync(
  windowRef: Window = window,
  documentRef: Document = document,
): () => void {
  const root = documentRef.documentElement;
  const viewport = windowRef.visualViewport;
  let frame = 0;
  let followup = 0;

  const update = () => {
    if (frame) windowRef.cancelAnimationFrame(frame);
    frame = windowRef.requestAnimationFrame(() => {
      frame = 0;
      const height = viewport?.height ?? windowRef.innerHeight;
      const width = viewport?.width ?? windowRef.innerWidth;
      const offsetTop = viewport?.offsetTop ?? 0;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const keyboardInset = Math.max(0, windowRef.innerHeight - height - offsetTop);
      const keyboardOpen = keyboardInset >= KEYBOARD_THRESHOLD_PX
        && isEditable(documentRef.activeElement);

      root.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`);
      root.style.setProperty('--visual-viewport-width', `${Math.round(width)}px`);
      root.style.setProperty('--visual-viewport-top', `${Math.round(offsetTop)}px`);
      root.style.setProperty('--visual-viewport-left', `${Math.round(offsetLeft)}px`);
      root.style.setProperty('--keyboard-inset', `${Math.round(keyboardInset)}px`);
      root.dataset.virtualKeyboard = keyboardOpen ? 'open' : 'closed';
      if (keyboardOpen) {
        keepFocusedEditorControlVisible(documentRef, offsetTop, height);
        if (followup) windowRef.clearTimeout(followup);
        followup = windowRef.setTimeout(
          () => keepFocusedEditorControlVisible(documentRef, offsetTop, height),
          240,
        );
      }
    });
  };

  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  windowRef.addEventListener('resize', update);
  windowRef.addEventListener('orientationchange', update);
  documentRef.addEventListener('focusin', update);
  documentRef.addEventListener('focusout', update);
  update();

  return () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    windowRef.removeEventListener('resize', update);
    windowRef.removeEventListener('orientationchange', update);
    documentRef.removeEventListener('focusin', update);
    documentRef.removeEventListener('focusout', update);
    if (frame) windowRef.cancelAnimationFrame(frame);
    if (followup) windowRef.clearTimeout(followup);
    delete root.dataset.virtualKeyboard;
  };
}
