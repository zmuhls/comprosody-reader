import assert from 'node:assert/strict';
import test from 'node:test';
import { installGridMotion } from '../public/grid-motion.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.scrollTop = 0;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners.get(type) === handler) this.listeners.delete(type);
  }

  emit(type) {
    this.listeners.get(type)?.();
  }
}

test('grid motion follows window and independent panel scrolling', () => {
  const view = new FakeTarget();
  const panel = new FakeTarget();
  const frames = [];
  const timers = new Map();
  const properties = new Map();
  const classes = new Set();
  let timerId = 0;

  view.scrollY = 120;
  view.matchMedia = () => ({ matches: false });
  view.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  view.cancelAnimationFrame = () => {};
  view.setTimeout = (callback) => {
    timerId += 1;
    timers.set(timerId, callback);
    return timerId;
  };
  view.clearTimeout = (id) => timers.delete(id);

  const root = {
    style: { setProperty: (name, value) => properties.set(name, value) },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };

  const motion = installGridMotion({ targets: [panel], root, view });
  assert.equal(view.listeners.has('scroll'), true);
  assert.equal(panel.listeners.has('scroll'), true);

  panel.scrollTop = 360;
  panel.emit('scroll');
  assert.equal(frames.length, 1);
  frames.shift()();

  assert.equal(properties.get('--grid-shift-x'), '0px');
  assert.ok(
    Math.abs(Number.parseFloat(properties.get('--grid-shift-y')) + 2.52) < 0.000_001,
  );
  assert.equal(properties.get('--grid-glint-y'), '0px');
  assert.equal(classes.has('is-scrolling'), true);
  [...timers.values()].at(-1)();
  assert.equal(classes.has('is-scrolling'), false);

  motion.destroy();
  assert.equal(view.listeners.has('scroll'), false);
  assert.equal(panel.listeners.has('scroll'), false);
});

test('reduced motion leaves the grid stationary and cleanup is safe', () => {
  const view = new FakeTarget();
  const panel = new FakeTarget();
  const properties = new Map();
  const classes = new Set();

  view.matchMedia = () => ({ matches: true });
  view.requestAnimationFrame = () => {
    throw new Error('reduced motion must not schedule a frame');
  };
  view.cancelAnimationFrame = () => {};
  view.setTimeout = () => 1;
  view.clearTimeout = () => {};

  const motion = installGridMotion({
    targets: [panel],
    view,
    root: {
      style: { setProperty: (name, value) => properties.set(name, value) },
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
    },
  });
  panel.scrollTop = 120;
  panel.emit('scroll');
  assert.equal(properties.size, 0);
  motion.destroy();
  assert.equal(classes.size, 0);
});
