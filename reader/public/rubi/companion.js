const STORAGE_KEY = 'readings:rubi-companion:v1';
const LAYOUT_STORAGE_KEY = 'readings:rubi-layout:v1';
const STYLE_ID = 'rubi-companion-styles';
const VALID_STATES = new Set(['expanded', 'collapsed', 'hidden']);

export const RUBI_STATES = Object.freeze({
  expanded: 'expanded',
  collapsed: 'collapsed',
  hidden: 'hidden',
});

export const RUBI_DEFAULTS = Object.freeze({
  frameCount: 6,
  frameSize: 96,
  fps: 3,
  stripUrl: '/rubi/idle/idle-strip.webp',
});

export const RUBI_LAYOUT_DEFAULTS = Object.freeze({
  state: RUBI_STATES.expanded,
  edge: 'left',
  y: 0.58,
});

export function normalizeRubiState(value) {
  return VALID_STATES.has(value) ? value : RUBI_STATES.expanded;
}

export function normalizeRubiLayout(value = {}) {
  const edge = value?.edge === 'right' ? 'right' : 'left';
  const numericY = Number(value?.y);
  const y = Number.isFinite(numericY)
    ? Math.round(Math.min(1, Math.max(0, numericY)) * 10_000) / 10_000
    : RUBI_LAYOUT_DEFAULTS.y;
  return {
    state: normalizeRubiState(value?.state),
    edge,
    y,
  };
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readRubiState(storage = browserStorage()) {
  if (!storage) return RUBI_STATES.expanded;
  try {
    return normalizeRubiState(storage.getItem(STORAGE_KEY));
  } catch {
    return RUBI_STATES.expanded;
  }
}

export function writeRubiState(value, storage = browserStorage()) {
  const state = normalizeRubiState(value);
  try {
    storage?.setItem(STORAGE_KEY, state);
  } catch {
    // Storage can be unavailable in private browsing. Rubi still works in-tab.
  }
  return state;
}

export function readRubiLayout(storage = browserStorage()) {
  if (!storage) return { ...RUBI_LAYOUT_DEFAULTS };
  try {
    const stored = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!stored) return { ...RUBI_LAYOUT_DEFAULTS, state: readRubiState(storage) };
    return normalizeRubiLayout(JSON.parse(stored));
  } catch {
    return { ...RUBI_LAYOUT_DEFAULTS, state: readRubiState(storage) };
  }
}

export function writeRubiLayout(value, storage = browserStorage()) {
  const layout = normalizeRubiLayout(value);
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    storage?.setItem(STORAGE_KEY, layout.state);
  } catch {
    // Storage can be unavailable in private browsing. Rubi still works in-tab.
  }
  return layout;
}

function installStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .rubi-companion {
      --rubi-size: 64px;
      position: fixed;
      z-index: 18;
      left: calc((var(--rail-width, 176px) - var(--rubi-size)) / 2);
      top: 58%;
      display: flex;
      align-items: flex-end;
      gap: 2px;
      color: color-mix(in srgb, currentColor 62%, transparent);
      pointer-events: none;
    }

    .rubi-companion[data-rubi-edge="right"] {
      flex-direction: row-reverse;
    }

    .rubi-companion[hidden] {
      display: none !important;
    }

    .rubi-companion[inert] {
      visibility: hidden;
    }

    .rubi-companion button {
      appearance: none;
      -webkit-appearance: none;
      border: 0;
      border-radius: 0;
      background-color: transparent;
      box-shadow: none;
      color: inherit;
      padding: 0;
      pointer-events: auto;
      -webkit-tap-highlight-color: transparent;
    }

    .rubi-companion button:focus-visible {
      outline: 0;
      background-color: var(--accent-soft, rgb(222 219 210 / 5.5%));
    }

    .rubi-companion__sprite {
      position: relative;
      width: var(--rubi-size);
      height: var(--rubi-size);
      min-width: 44px;
      min-height: 44px;
      background-image: var(--rubi-strip);
      background-repeat: no-repeat;
      background-size: calc(var(--rubi-size) * 6) var(--rubi-size);
      background-position: 0 0;
      cursor: grab;
      filter: drop-shadow(0 4px 7px rgb(0 0 0 / 20%));
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      transition: filter 160ms ease, opacity 160ms ease;
    }

    .rubi-companion__expand-hint {
      position: absolute;
      right: -8px;
      bottom: -4px;
      display: none;
      color: var(--accent, #dedbd2);
      font: 500 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      opacity: .72;
      pointer-events: none;
    }

    .rubi-companion[data-rubi-edge="right"] .rubi-companion__expand-hint {
      right: auto;
      left: -8px;
    }

    .rubi-companion__sprite:active {
      cursor: grabbing;
    }

    .rubi-companion__sprite:hover,
    .rubi-companion__sprite:focus-visible {
      filter: drop-shadow(0 4px 8px rgb(0 0 0 / 24%))
        drop-shadow(0 0 5px rgb(222 219 210 / 28%));
    }

    .rubi-companion__hide {
      width: 44px;
      height: 44px;
      opacity: 0;
      cursor: pointer;
      font: 400 16px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      transition: opacity 160ms ease;
    }

    .rubi-companion:hover .rubi-companion__hide,
    .rubi-companion:focus-within .rubi-companion__hide {
      opacity: .66;
    }

    .rubi-companion__hide:hover,
    .rubi-companion__hide:focus-visible {
      opacity: 1;
      text-decoration: underline;
      text-underline-offset: 4px;
    }

    .rubi-companion[data-rubi-state="collapsed"] {
      --rubi-size: 44px;
      opacity: .8;
    }

    .rubi-companion[data-rubi-state="collapsed"] .rubi-companion__expand-hint {
      display: block;
    }

    @media (max-width: 760px), (max-height: 500px) and (pointer: coarse) {
      .rubi-companion {
        --rubi-size: 52px;
        z-index: 41;
      }

      .rubi-companion__hide {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .rubi-companion *,
      .rubi-companion *::before,
      .rubi-companion *::after {
        transition: none !important;
      }
    }
  `;
  doc.head.append(style);
}

/**
 * Mount a tiny, borderless Rubi companion.
 *
 * The module only reads its shipped sprite URL through CSS; it makes no fetch,
 * XHR, WebSocket, analytics, or other programmatic network calls.
 */
export function createRubiCompanion({
  mount = globalThis.document?.body,
  stripUrl = RUBI_DEFAULTS.stripUrl,
  frameCount = RUBI_DEFAULTS.frameCount,
  frameSize = RUBI_DEFAULTS.frameSize,
  fps = RUBI_DEFAULTS.fps,
  storage = browserStorage(),
  initialState = readRubiState(storage),
  initialLayout = readRubiLayout(storage),
  onCommit = () => {},
} = {}) {
  if (!mount?.ownerDocument) {
    throw new TypeError('createRubiCompanion requires a DOM mount node');
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new TypeError('frameCount must be a positive integer');
  }
  if (!Number.isFinite(frameSize) || frameSize < 1 || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError('frameSize and fps must be positive numbers');
  }

  const doc = mount.ownerDocument;
  const view = doc.defaultView ?? globalThis;
  installStyles(doc);

  const root = doc.createElement('aside');
  root.className = 'rubi-companion';
  root.setAttribute('aria-label', 'rubi companion');

  const sprite = doc.createElement('button');
  sprite.type = 'button';
  sprite.className = 'rubi-companion__sprite';

  const expandHint = doc.createElement('span');
  expandHint.className = 'rubi-companion__expand-hint';
  expandHint.setAttribute('aria-hidden', 'true');
  expandHint.textContent = '+';
  sprite.append(expandHint);

  const hideButton = doc.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'rubi-companion__hide';
  hideButton.setAttribute('aria-label', 'hide rubi');
  hideButton.textContent = '×';

  root.append(sprite, hideButton);
  mount.append(root);

  let layout = normalizeRubiLayout({
    ...initialLayout,
    state: initialState ?? initialLayout?.state,
  });
  let state = layout.state;
  let frame = 0;
  let animationFrame = null;
  let previousTime = 0;
  const frameDuration = 1000 / fps;
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');

  const spriteImage = `url("${String(stripUrl).replaceAll('"', '\\"')}")`;
  root.style.setProperty('--rubi-strip', spriteImage);
  sprite.style.backgroundImage = spriteImage;
  root.dataset.rubiFrameSize = String(frameSize);

  function renderFrame() {
    const displaySize = Number.parseFloat(
      view.getComputedStyle?.(sprite).width || String(frameSize),
    ) || frameSize;
    sprite.style.backgroundSize = `${displaySize * frameCount}px ${displaySize}px`;
    sprite.style.backgroundPosition = `${-frame * displaySize}px 0`;
  }

  function tick(time) {
    if (time - previousTime >= frameDuration) {
      frame = (frame + 1) % frameCount;
      previousTime = time;
      renderFrame();
    }
    animationFrame = view.requestAnimationFrame(tick);
  }

  function stop() {
    if (animationFrame !== null) view.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  function start() {
    stop();
    if (state === RUBI_STATES.hidden || reducedMotion?.matches) {
      frame = 0;
      renderFrame();
      return;
    }
    previousTime = view.performance?.now?.() ?? 0;
    animationFrame = view.requestAnimationFrame(tick);
  }

  function numericCustomProperty(name, fallback = 0) {
    const raw = view.getComputedStyle?.(doc.documentElement)?.getPropertyValue(name);
    return Number.parseFloat(raw) || fallback;
  }

  function mobileLayout() {
    return view.matchMedia?.('(max-width: 760px), (max-height: 500px) and (pointer: coarse)')?.matches;
  }

  function openPanelWidth() {
    if (mobileLayout()) return 0;
    const shell = doc.querySelector('.app-shell');
    if (!shell?.matches('.notes-open, .settings-open, .ingest-open')) return 0;
    return Number.parseFloat(
      view.getComputedStyle?.(shell)?.getPropertyValue('--active-panel-width'),
    ) || 0;
  }

  function geometry() {
    const viewportWidth = doc.documentElement.clientWidth || view.innerWidth;
    const rootRect = root.getBoundingClientRect();
    const spriteRect = sprite.getBoundingClientRect();
    const spriteSize = spriteRect.width
      || Number.parseFloat(view.getComputedStyle?.(sprite).width)
      || frameSize;
    const rootWidth = rootRect.width || spriteSize + (mobileLayout() ? 0 : 46);
    const rootHeight = rootRect.height || spriteSize;
    const safeTop = numericCustomProperty('--safe-top');
    const safeRight = numericCustomProperty('--safe-right');
    const safeBottom = numericCustomProperty('--safe-bottom');
    const safeLeft = numericCustomProperty('--safe-left');
    const headerBottom = doc.querySelector('.app-header')?.getBoundingClientRect().bottom
      || safeTop + 64;
    const topMinimum = mobileLayout()
      ? Math.max(safeTop + 72, headerBottom + 8)
      : safeTop + 16;
    const topMaximum = Math.max(
      topMinimum,
      view.innerHeight - rootHeight - safeBottom - 16,
    );
    const railWidth = numericCustomProperty('--rail-width', mobileLayout() ? 0 : 176);
    const leftSnap = mobileLayout()
      ? safeLeft + 2
      : Math.max(2, (railWidth - spriteSize) / 2);
    const rightSnap = Math.max(
      safeLeft + 2,
      viewportWidth - openPanelWidth() - rootWidth - safeRight - 8,
    );
    return {
      rootWidth,
      rootHeight,
      topMinimum,
      topMaximum,
      leftSnap,
      rightSnap,
      dragLeftMinimum: safeLeft + 2,
      dragLeftMaximum: Math.max(
        safeLeft + 2,
        viewportWidth - openPanelWidth() - rootWidth - safeRight - 2,
      ),
    };
  }

  function updatePositionDescription() {
    const percentage = Math.round(layout.y * 100);
    sprite.setAttribute('aria-description', `${layout.edge} edge, ${percentage} percent down`);
  }

  function reflow() {
    if (state === RUBI_STATES.hidden) return;
    const bounds = geometry();
    root.dataset.rubiEdge = layout.edge;
    root.style.left = `${layout.edge === 'right' ? bounds.rightSnap : bounds.leftSnap}px`;
    root.style.top = `${bounds.topMinimum + layout.y * (bounds.topMaximum - bounds.topMinimum)}px`;
    updatePositionDescription();
  }

  function applyLayout(next, { persist = true, announce = true } = {}) {
    layout = normalizeRubiLayout({ ...layout, ...next });
    state = layout.state;
    root.dataset.rubiState = state;
    root.dataset.rubiEdge = layout.edge;
    root.hidden = state === RUBI_STATES.hidden;
    sprite.setAttribute(
      'aria-label',
      state === RUBI_STATES.collapsed ? 'expand rubi' : 'collapse rubi',
    );
    sprite.title = state === RUBI_STATES.collapsed ? 'expand rubi' : 'collapse rubi';
    sprite.setAttribute('aria-expanded', String(state === RUBI_STATES.expanded));
    if (!root.hidden) reflow();
    if (persist) {
      writeRubiLayout(layout, storage);
      try { onCommit({ ...layout }); } catch {}
    }
    renderFrame();
    start();
    if (announce && typeof view.CustomEvent === 'function') {
      root.dispatchEvent(
        new view.CustomEvent('rubi:statechange', {
          bubbles: true,
          detail: { state, layout: { ...layout } },
        }),
      );
    }
    return { ...layout };
  }

  function applyState(next, options) {
    return applyLayout({ state: normalizeRubiState(next) }, options).state;
  }

  function onVisibilityChange() {
    if (doc.hidden) stop();
    else start();
  }

  let pointerDrag = null;
  let suppressClick = false;

  function positionDuringDrag(clientX, clientY) {
    const bounds = geometry();
    const left = Math.min(
      bounds.dragLeftMaximum,
      Math.max(bounds.dragLeftMinimum, clientX - pointerDrag.offsetX),
    );
    const top = Math.min(
      bounds.topMaximum,
      Math.max(bounds.topMinimum, clientY - pointerDrag.offsetY),
    );
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  }

  function commitDrag() {
    const bounds = geometry();
    const rect = root.getBoundingClientRect();
    const edge = Math.abs(rect.left - bounds.leftSnap) <= Math.abs(rect.left - bounds.rightSnap)
      ? 'left'
      : 'right';
    const range = bounds.topMaximum - bounds.topMinimum;
    const y = range > 0 ? (rect.top - bounds.topMinimum) / range : 0;
    applyLayout({ edge, y });
  }

  sprite.addEventListener('pointerdown', (event) => {
    if (state === RUBI_STATES.hidden || event.button !== 0 || !event.isPrimary) return;
    const rect = root.getBoundingClientRect();
    pointerDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
      original: { ...layout },
    };
    sprite.setPointerCapture(event.pointerId);
  });
  sprite.addEventListener('pointermove', (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    if (!pointerDrag.moved) {
      pointerDrag.moved = Math.hypot(
        event.clientX - pointerDrag.startX,
        event.clientY - pointerDrag.startY,
      ) >= 4;
    }
    if (!pointerDrag.moved) return;
    positionDuringDrag(event.clientX, event.clientY);
    event.preventDefault();
  });
  sprite.addEventListener('pointerup', (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    if (pointerDrag.moved) {
      suppressClick = true;
      commitDrag();
    }
    pointerDrag = null;
  });
  sprite.addEventListener('pointercancel', (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const original = pointerDrag.original;
    pointerDrag = null;
    applyLayout(original, { persist: false, announce: false });
  });
  sprite.addEventListener('lostpointercapture', (event) => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const original = pointerDrag.original;
    pointerDrag = null;
    suppressClick = false;
    applyLayout(original, { persist: false, announce: false });
  });
  sprite.addEventListener('keydown', (event) => {
    if (state === RUBI_STATES.hidden) return;
    const bounds = geometry();
    const range = Math.max(1, bounds.topMaximum - bounds.topMinimum);
    const step = (event.shiftKey ? 48 : 16) / range;
    let next = { ...layout };
    if (event.key === 'ArrowUp') next.y -= step;
    else if (event.key === 'ArrowDown') next.y += step;
    else if (event.key === 'ArrowLeft') next.edge = 'left';
    else if (event.key === 'ArrowRight') next.edge = 'right';
    else if (event.key === 'Home') next.y = 0;
    else if (event.key === 'End') next.y = 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    applyLayout(next);
  });
  sprite.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    applyState(
      state === RUBI_STATES.collapsed
        ? RUBI_STATES.expanded
        : RUBI_STATES.collapsed,
    );
  });
  hideButton.addEventListener('click', () => applyState(RUBI_STATES.hidden));
  doc.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion?.addEventListener?.('change', start);
  view.addEventListener?.('resize', reflow);
  view.visualViewport?.addEventListener?.('resize', reflow);

  applyLayout(layout, { persist: false, announce: false });

  return Object.freeze({
    element: root,
    getState: () => state,
    getLayout: () => ({ ...layout }),
    setLayout: (next, options) => applyLayout(next, options),
    reflow,
    setState: (next) => applyState(next),
    expand: () => applyState(RUBI_STATES.expanded),
    collapse: () => applyState(RUBI_STATES.collapsed),
    hide: () => applyState(RUBI_STATES.hidden),
    show: () => applyState(
      state === RUBI_STATES.hidden ? RUBI_STATES.expanded : state,
    ),
    destroy() {
      stop();
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      reducedMotion?.removeEventListener?.('change', start);
      view.removeEventListener?.('resize', reflow);
      view.visualViewport?.removeEventListener?.('resize', reflow);
      root.remove();
    },
  });
}
