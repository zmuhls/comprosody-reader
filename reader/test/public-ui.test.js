import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file) => fs.readFileSync(file, 'utf8');

test('reader UI keeps only the public reader surface', () => {
  const markup = read('public/index.html');
  const app = read('public/app.js');
  assert.match(markup, /id="bookmark-current"/u);
  assert.match(markup, /id="bookmark-list"/u);
  assert.match(markup, /id="ingest-panel"/u);
  assert.match(markup, /id="settings-panel"/u);
  assert.equal((markup.match(/class="header-actions"/gu) || []).length, 1);
  assert.equal((markup.match(/<a\s/gu) || []).length, 1);
  assert.doesNotMatch(app, /authorFor/u);
  assert.equal((app.match(/<article class="book-row"/gu) || []).length, 1);
});

test('palette is black, neutral gray, and sparing eggshell without purple', () => {
  const styles = read('public/styles.css');
  assert.match(styles, /--bg:\s*#0a0a0a/u);
  assert.match(styles, /--ink:\s*#f1eee5/u);
  assert.doesNotMatch(styles, /\b(?:purple|violet|lavender|magenta|plum)\b/iu);
  assert.match(styles, /linear-gradient\(45deg/u);
  assert.match(styles, /linear-gradient\(-45deg/u);
});

test('mobile controls respect safe areas, coarse landscape, and accessible labels', () => {
  const markup = read('public/index.html');
  const loginMarkup = read('public/login.html');
  const app = read('public/app.js');
  const login = read('public/login.js');
  const styles = read('public/styles.css');
  const rubi = read('public/rubi/companion.js');

  assert.match(markup, /aria-labelledby="annotation-heading"/u);
  assert.match(markup, /id="annotation-heading"/u);
  assert.match(markup, /aria-labelledby="organize-heading"/u);
  assert.match(markup, /id="organize-heading"/u);
  assert.match(loginMarkup, /<script type="module" src="\/login\.js"><\/script>/u);
  assert.match(login, /import \{ installGridMotion \} from '\.\/grid-motion\.js'/u);
  assert.doesNotMatch(login, /Signing in|Too many|That username|Could not reach/u);
  assert.match(app, /installGridMotion\(\{[\s\S]*?#notes-panel[\s\S]*?#ingest-panel/u);

  for (const variable of ['safe-top', 'safe-right', 'safe-bottom', 'safe-left']) {
    assert.match(styles, new RegExp(`--${variable}:\\s*env\\(safe-area-inset-`));
  }
  assert.match(
    styles,
    /@media \(max-width: 760px\), \(max-height: 500px\) and \(pointer: coarse\)/u,
  );
  assert.match(styles, /\.save-feedback button\s*\{[^}]*min-height:\s*44px/u);
  assert.match(styles, /\.bookmark-save button\s*\{[^}]*min-height:\s*44px/u);
  assert.match(styles, /#viewer\s*\{[^}]*padding-right:\s*var\(--safe-right\)/u);
  assert.match(
    rubi,
    /@media \(max-width: 720px\), \(max-height: 500px\) and \(pointer: coarse\)/u,
  );
});

test('bookmark, resume, and ingestion clients retain offline and privacy boundaries', () => {
  const app = read('public/app.js');
  const bookmarkOps = read('public/bookmark-ops.js');
  const extractor = read('client/ingest-entry.js');
  assert.match(bookmarkOps, /readings-bookmark-ops-v2:/u);
  assert.match(bookmarkOps, /autoRestore: false/u);
  assert.match(bookmarkOps, /onlineTarget: null/u);
  assert.match(app, /removeItem\('readings-bookmark-outbox-v1'\)/u);
  assert.match(app, /saves\.enqueue\(slug, currentState\(\), \{ debounceMs: 350 \}\)/u);
  assert.match(app, /activeBookmarkSession\.queue\.enqueue\(id, operation\)/u);
  assert.match(app, /if \(!bookmarkHydrated \|\| !activeBookmarkSession \|\| !activeSlug\) return;/u);
  assert.doesNotMatch(app, /storageKey:\s*'readings-bookmark-outbox-v1'/u);
  assert.match(extractor, /getTextContent/u);
  assert.match(extractor, /data\.fill\(0\)/u);
  assert.doesNotMatch(extractor, /fetch\(|XMLHttpRequest|FormData/u);
});
