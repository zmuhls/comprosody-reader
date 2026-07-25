function scrollOffset(target, view) {
  if (target === view) {
    return Number(view.scrollY ?? view.document?.documentElement?.scrollTop ?? 0);
  }
  return Number(target?.scrollTop ?? 0);
}

export function installGridMotion({
  targets = [],
  root = globalThis.document?.documentElement,
  view = globalThis.window,
} = {}) {
  if (!root?.style || !view?.addEventListener || !view?.requestAnimationFrame) {
    return Object.freeze({ update() {}, destroy() {} });
  }

  let frame = null;
  let timer = null;
  let pendingTravel = 0;
  const listeners = [];
  const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');

  function update(target = view) {
    if (reducedMotion?.matches) return;
    pendingTravel = scrollOffset(target, view);
    if (frame !== null) return;
    frame = view.requestAnimationFrame(() => {
      const travel = Number.isFinite(pendingTravel) ? pendingTravel : 0;
      root.style.setProperty('--grid-shift-x', `${((travel % 240) - 120) * 0.018}px`);
      root.style.setProperty('--grid-shift-y', `${((travel % 192) - 96) * -0.035}px`);
      root.style.setProperty('--grid-glint-y', `${((travel % 720) - 360) * 0.075}px`);
      root.classList.add('is-scrolling');
      view.clearTimeout(timer);
      timer = view.setTimeout(() => root.classList.remove('is-scrolling'), 180);
      frame = null;
    });
  }

  for (const target of [view, ...targets]) {
    if (!target?.addEventListener
        || listeners.some(({ target: item }) => item === target)) continue;
    const handler = () => update(target);
    target.addEventListener('scroll', handler, { passive: true });
    listeners.push({ target, handler });
  }

  return Object.freeze({
    update,
    destroy() {
      for (const { target, handler } of listeners) {
        target.removeEventListener('scroll', handler);
      }
      if (frame !== null) view.cancelAnimationFrame?.(frame);
      view.clearTimeout(timer);
      frame = null;
      timer = null;
      root.classList.remove('is-scrolling');
    },
  });
}
