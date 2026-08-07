import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  PANEL_WIDTH_DEFAULTS,
  clampPanelWidth,
} from '../public/panel-resizer.js';

test('panel widths are bounded by the panel contract and remaining reader space', () => {
  assert.deepEqual(PANEL_WIDTH_DEFAULTS, {
    notes: 368,
    settings: 368,
    ingest: 368,
  });
  assert.equal(clampPanelWidth(100, { viewportWidth: 1440, railWidth: 176 }), 280);
  assert.equal(clampPanelWidth(900, { viewportWidth: 1440, railWidth: 176 }), 720);
  assert.equal(clampPanelWidth(720, { viewportWidth: 1100, railWidth: 176 }), 604);
  assert.equal(clampPanelWidth(368, { viewportWidth: 700, railWidth: 176 }), 280);
  assert.equal(clampPanelWidth('bad', { viewportWidth: 1440, railWidth: 176 }), 280);
});

test('the shared panel separator is borderless, keyboard operable, and disabled on compact screens', () => {
  const markup = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
  const styles = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');
  const source = fs.readFileSync(path.resolve('public/panel-resizer.js'), 'utf8');

  assert.match(
    markup,
    /id="panel-resizer"[^>]*role="separator"[^>]*aria-orientation="vertical"[^>]*tabindex="0"/,
  );
  assert.match(styles, /\.panel-resizer\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(styles, /@media \(max-width:\s*1099px\)[\s\S]*?\.panel-resizer\s*\{[^}]*display:\s*none !important;/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.match(source, new RegExp(`event\\.key === '${key}'`));
  }
  assert.match(source, /documentElement\.clientWidth \|\| view\.innerWidth/);
  assert.match(source, /drag = \{ pointerId: event\.pointerId, name: activeName \}/);
  assert.match(source, /releasePointerCapture/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /onCommit\(name, displayedWidth\)/);
  assert.match(source, /onCommit\(activeName, width\)/);
});
