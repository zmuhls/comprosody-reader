import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeRubiLayout,
  normalizeRubiState,
  readRubiLayout,
  readRubiState,
  RUBI_DEFAULTS,
  RUBI_LAYOUT_DEFAULTS,
  RUBI_STATES,
  writeRubiLayout,
  writeRubiState,
} from '../public/rubi/companion.js';

const assetDir = path.resolve('public/rubi/idle');
const manifest = JSON.parse(fs.readFileSync(path.join(assetDir, 'manifest.json'), 'utf8'));

test('ships the Rubi runtime sprite and six transparent frame assets', () => {
  assert.equal(manifest.name, 'rubi');
  assert.equal(manifest.frameCount, 6);
  assert.equal(manifest.strip.webp, 'idle-strip.webp');
  assert.ok(fs.statSync(path.join(assetDir, manifest.strip.webp)).size > 1_000);
  for (const relative of manifest.frames) {
    const bytes = fs.readFileSync(path.join(assetDir, relative));
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(bytes.readUInt32BE(16), 96);
    assert.equal(bytes.readUInt32BE(20), 96);
    assert.equal(bytes[25], 6);
  }
});

test('Rubi collapsed and hidden preferences are local and defensive', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readRubiState(storage), RUBI_STATES.expanded);
  assert.equal(writeRubiState(RUBI_STATES.collapsed, storage), 'collapsed');
  assert.equal(readRubiState(storage), RUBI_STATES.collapsed);
  assert.equal(writeRubiState(RUBI_STATES.hidden, storage), 'hidden');
  assert.equal(readRubiState(storage), RUBI_STATES.hidden);
  assert.equal(normalizeRubiState('unexpected'), RUBI_STATES.expanded);
  assert.equal(RUBI_DEFAULTS.frameCount, manifest.frameCount);
});

test('Rubi movement layout is bounded, persisted, and backward compatible', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.deepEqual(readRubiLayout(storage), RUBI_LAYOUT_DEFAULTS);
  writeRubiState(RUBI_STATES.collapsed, storage);
  assert.deepEqual(readRubiLayout(storage), {
    ...RUBI_LAYOUT_DEFAULTS,
    state: RUBI_STATES.collapsed,
  });

  const stored = writeRubiLayout({
    state: RUBI_STATES.hidden,
    edge: 'right',
    y: 0.43219,
  }, storage);
  assert.deepEqual(stored, { state: 'hidden', edge: 'right', y: 0.4322 });
  assert.deepEqual(readRubiLayout(storage), stored);
  assert.equal(readRubiState(storage), RUBI_STATES.hidden);

  assert.deepEqual(normalizeRubiLayout({
    state: 'bad',
    edge: 'center',
    y: -12,
  }), { state: 'expanded', edge: 'left', y: 0 });
  assert.equal(normalizeRubiLayout({ y: 12 }).y, 1);
  assert.equal(normalizeRubiLayout({ y: 'not-a-number' }).y, RUBI_LAYOUT_DEFAULTS.y);
});

test('the companion has borderless controls and no programmatic network client', () => {
  const source = fs.readFileSync(path.resolve('public/rubi/companion.js'), 'utf8');
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
  assert.match(source, /\.rubi-companion button[\s\S]*?border:\s*0;/u);
  assert.match(source, /\.rubi-companion button:focus-visible\s*\{[^}]*outline:\s*0;/u);
  assert.match(source, /background-color:\s*transparent;/u);
  assert.match(source, /sprite\.style\.backgroundImage = spriteImage/u);
  assert.match(
    source,
    /\.rubi-companion\[data-rubi-state="collapsed"\] \.rubi-companion__expand-hint\s*\{[^}]*display:\s*block;/u,
  );
  assert.match(source, /expandHint\.textContent = '\+'/u);
  assert.match(source, /state === RUBI_STATES\.collapsed \? 'expand rubi' : 'collapse rubi'/u);
  assert.match(source, /@media \(max-width: 760px\)/u);
  assert.match(source, /--rubi-size:\s*52px/u);
  assert.match(source, /documentElement\.clientWidth \|\| view\.innerWidth/u);
  assert.match(source, /lostpointercapture/u);
  assert.doesNotMatch(
    executable,
    /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/u,
  );
});
