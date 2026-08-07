export const PANEL_WIDTH_DEFAULTS = Object.freeze({
  notes: 368,
  settings: 368,
  ingest: 368,
});

const PANEL_NAMES = new Set(Object.keys(PANEL_WIDTH_DEFAULTS));
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 720;
const MIN_READER_WIDTH = 320;

export function clampPanelWidth(value, {
  viewportWidth,
  railWidth = 176,
  minimum = MIN_PANEL_WIDTH,
  maximum = MAX_PANEL_WIDTH,
  readerMinimum = MIN_READER_WIDTH,
} = {}) {
  const availableMaximum = Math.max(
    minimum,
    Math.min(maximum, Number(viewportWidth) - Number(railWidth) - readerMinimum),
  );
  const numeric = Number.isFinite(Number(value)) ? Number(value) : minimum;
  return Math.round(Math.min(availableMaximum, Math.max(minimum, numeric)));
}

export function createPanelResizer({
  root,
  handle,
  panels,
  onCommit = () => {},
  onReflow = () => {},
} = {}) {
  if (!root || !handle || !panels) {
    throw new TypeError('panel resizer requires a root, handle, and panels');
  }
  const view = root.ownerDocument.defaultView;
  const widths = { ...PANEL_WIDTH_DEFAULTS };
  let activeName = null;
  let displayedWidth = PANEL_WIDTH_DEFAULTS.notes;
  let drag = null;
  let frame = null;
  let queuedX = null;

  function desktop() {
    return view.matchMedia('(min-width: 1100px)').matches;
  }

  function railWidth() {
    const raw = view.getComputedStyle(root.ownerDocument.documentElement)
      .getPropertyValue('--rail-width');
    return Number.parseFloat(raw) || 0;
  }

  function viewportWidth() {
    return root.ownerDocument.documentElement.clientWidth || view.innerWidth;
  }

  function bounds() {
    return {
      viewportWidth: viewportWidth(),
      railWidth: railWidth(),
    };
  }

  function runtimeWidth(name, value = widths[name]) {
    return clampPanelWidth(value, bounds());
  }

  function updateAria() {
    const maximum = clampPanelWidth(MAX_PANEL_WIDTH, bounds());
    handle.setAttribute('aria-valuemin', String(MIN_PANEL_WIDTH));
    handle.setAttribute('aria-valuemax', String(maximum));
    handle.setAttribute('aria-valuenow', String(displayedWidth));
    handle.setAttribute('aria-valuetext', `${displayedWidth} pixels`);
  }

  function renderWidth(name, value) {
    displayedWidth = runtimeWidth(name, value);
    root.style.setProperty(`--${name}-panel-width`, `${displayedWidth}px`);
    if (activeName === name) {
      root.style.setProperty('--active-panel-width', `${displayedWidth}px`);
      updateAria();
    }
    return displayedWidth;
  }

  function setLayout(layout = {}) {
    for (const name of PANEL_NAMES) {
      const candidate = Number(layout[name]);
      widths[name] = Number.isFinite(candidate)
        ? Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, candidate)))
        : PANEL_WIDTH_DEFAULTS[name];
      root.style.setProperty(`--${name}-panel-width`, `${widths[name]}px`);
    }
    if (activeName) renderWidth(activeName, widths[activeName]);
  }

  function activate(name) {
    if (!PANEL_NAMES.has(name)) throw new TypeError('unknown panel');
    activeName = name;
    handle.dataset.panel = name;
    handle.setAttribute('aria-controls', `${panels[name].id} reader`);
    renderWidth(name, widths[name]);
    handle.hidden = !desktop();
  }

  function deactivate(name = activeName) {
    if (name && activeName !== name) return;
    if (drag) finishDrag({ commit: false });
    activeName = null;
    handle.hidden = true;
    delete handle.dataset.panel;
  }

  function applyPointerX(clientX) {
    if (!activeName) return;
    renderWidth(activeName, viewportWidth() - clientX);
  }

  function flushPointerFrame() {
    frame = null;
    if (queuedX === null) return;
    applyPointerX(queuedX);
    queuedX = null;
  }

  function queuePointerX(clientX) {
    queuedX = clientX;
    if (frame === null) frame = view.requestAnimationFrame(flushPointerFrame);
  }

  function finishDrag({ commit }) {
    if (!drag) return;
    const { name, pointerId } = drag;
    if (frame !== null) {
      view.cancelAnimationFrame(frame);
      frame = null;
    }
    if (queuedX !== null) {
      applyPointerX(queuedX);
      queuedX = null;
    }
    const canCommit = commit && activeName === name;
    if (canCommit) {
      widths[name] = displayedWidth;
      onCommit(name, displayedWidth);
      onReflow();
    } else {
      renderWidth(name, widths[name]);
    }
    root.classList.remove('is-panel-resizing');
    drag = null;
    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {}
  }

  handle.addEventListener('pointerdown', (event) => {
    if (!desktop() || !activeName || event.button !== 0 || !event.isPrimary) return;
    drag = { pointerId: event.pointerId, name: activeName };
    handle.setPointerCapture(event.pointerId);
    root.classList.add('is-panel-resizing');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    queuePointerX(event.clientX);
    event.preventDefault();
  });
  handle.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag({ commit: true });
  });
  handle.addEventListener('pointercancel', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag({ commit: false });
  });
  handle.addEventListener('lostpointercapture', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag({ commit: false });
  });
  handle.addEventListener('keydown', (event) => {
    if (!activeName) return;
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      event.stopPropagation();
      finishDrag({ commit: false });
      return;
    }
    const step = event.shiftKey ? 48 : 16;
    let next;
    if (event.key === 'ArrowLeft') next = displayedWidth + step;
    else if (event.key === 'ArrowRight') next = displayedWidth - step;
    else if (event.key === 'Home') next = MIN_PANEL_WIDTH;
    else if (event.key === 'End') next = MAX_PANEL_WIDTH;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const width = renderWidth(activeName, next);
    widths[activeName] = width;
    onCommit(activeName, width);
    onReflow();
  });

  function reflow() {
    handle.hidden = !activeName || !desktop();
    if (activeName) renderWidth(activeName, widths[activeName]);
  }

  view.addEventListener('resize', reflow);

  setLayout(widths);
  handle.hidden = true;

  return Object.freeze({
    activate,
    deactivate,
    setLayout,
    getLayout: () => ({ ...widths }),
    reflow,
    destroy() {
      view.removeEventListener('resize', reflow);
      if (frame !== null) view.cancelAnimationFrame(frame);
    },
  });
}
