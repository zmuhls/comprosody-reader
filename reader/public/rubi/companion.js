const STORAGE_KEY = 'readings:rubi-companion:v1';
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

export function normalizeRubiState(value) {
  return VALID_STATES.has(value) ? value : RUBI_STATES.expanded;
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
      bottom: max(300px, calc(env(safe-area-inset-bottom) + 300px));
      display: flex;
      align-items: flex-end;
      gap: 2px;
      color: color-mix(in srgb, currentColor 62%, transparent);
      pointer-events: none;
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
      outline: 2px solid var(--accent, #dedbd2);
      outline-offset: 3px;
    }

    .rubi-companion__sprite {
      width: var(--rubi-size);
      height: var(--rubi-size);
      min-width: 44px;
      min-height: 44px;
      background-image: var(--rubi-strip);
      background-repeat: no-repeat;
      background-size: calc(var(--rubi-size) * 6) var(--rubi-size);
      background-position: 0 0;
      cursor: pointer;
      filter: drop-shadow(0 4px 7px rgb(0 0 0 / 20%));
      transition: filter 160ms ease, opacity 160ms ease;
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
      opacity: .72;
    }

    @media (max-width: 720px), (max-height: 500px) and (pointer: coarse) {
      .rubi-companion {
        --rubi-size: 44px;
        z-index: 41;
        top: calc(env(safe-area-inset-top, 0px) + 10px);
        right: auto;
        bottom: auto;
        left: 50%;
        transform: translateX(-50%);
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

  const hideButton = doc.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'rubi-companion__hide';
  hideButton.setAttribute('aria-label', 'hide rubi');
  hideButton.textContent = '×';

  root.append(sprite, hideButton);
  mount.append(root);

  let state = normalizeRubiState(initialState);
  let frame = 0;
  let animationFrame = null;
  let previousTime = 0;
  const frameDuration = 1000 / fps;
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');

  root.style.setProperty('--rubi-strip', `url("${String(stripUrl).replaceAll('"', '\\"')}")`);
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

  function applyState(next, { persist = true, announce = true } = {}) {
    state = normalizeRubiState(next);
    root.dataset.rubiState = state;
    root.hidden = state === RUBI_STATES.hidden;
    sprite.setAttribute(
      'aria-label',
      state === RUBI_STATES.collapsed ? 'expand rubi' : 'collapse rubi',
    );
    sprite.setAttribute('aria-expanded', String(state === RUBI_STATES.expanded));
    if (persist) writeRubiState(state, storage);
    renderFrame();
    start();
    if (announce && typeof view.CustomEvent === 'function') {
      root.dispatchEvent(
        new view.CustomEvent('rubi:statechange', {
          bubbles: true,
          detail: { state },
        }),
      );
    }
    return state;
  }

  function onVisibilityChange() {
    if (doc.hidden) stop();
    else start();
  }

  sprite.addEventListener('click', () => {
    applyState(
      state === RUBI_STATES.collapsed
        ? RUBI_STATES.expanded
        : RUBI_STATES.collapsed,
    );
  });
  hideButton.addEventListener('click', () => applyState(RUBI_STATES.hidden));
  doc.addEventListener('visibilitychange', onVisibilityChange);
  reducedMotion?.addEventListener?.('change', start);

  applyState(state, { persist: false, announce: false });

  return Object.freeze({
    element: root,
    getState: () => state,
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
      root.remove();
    },
  });
}
