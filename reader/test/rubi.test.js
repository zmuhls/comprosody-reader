import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeRubiState,
  readRubiState,
  RUBI_DEFAULTS,
  RUBI_STATES,
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

test('the companion has borderless controls and no programmatic network client', () => {
  const source = fs.readFileSync(path.resolve('public/rubi/companion.js'), 'utf8');
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '');
  assert.match(source, /\.rubi-companion button[\s\S]*?border:\s*0;/u);
  assert.match(source, /\.rubi-companion button:focus-visible\s*\{[^}]*outline:\s*0;/u);
  assert.match(source, /right:\s*max\(2px, env\(safe-area-inset-right, 0px\)\)/u);
  assert.doesNotMatch(
    executable,
    /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/u,
  );
});
