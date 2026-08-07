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
  assert.match(markup, /id="panel-resizer"[^>]*role="separator"/u);
  assert.match(markup, /<h1 id="library-title">your private shelf<\/h1>/u);
  assert.doesNotMatch(markup, /reader and note-taking library/u);
  assert.equal((markup.match(/class="header-actions"/gu) || []).length, 1);
  assert.equal((markup.match(/<a\s/gu) || []).length, 1);
  assert.match(markup, /href="\/styles\.css\?v=9"/u);
  assert.doesNotMatch(app, /authorFor/u);
  assert.equal((app.match(/<article class="book-row"/gu) || []).length, 1);
});

test('library typography and the PDF picker retain their measured touch balance', () => {
  const styles = read('public/styles.css');
  assert.match(
    styles,
    /\.book-meta > p\s*\{[^}]*font:\s*500 12px\/1\.35 var\(--mono\)[^}]*letter-spacing:\s*0\.055em/u,
  );
  assert.match(
    styles,
    /\.book-meta h2\s*\{[^}]*font:\s*400 clamp\(30px, 3\.7vw, 48px\) \/ 1\.03 var\(--serif\)[^}]*letter-spacing:\s*-0\.035em/u,
  );
  assert.match(
    styles,
    /\.file-choice\s*\{[^}]*position:\s*relative[^}]*overflow:\s*hidden/u,
  );
  assert.match(
    styles,
    /\.file-choice > span,\s*\.file-choice output\s*\{[^}]*pointer-events:\s*none/u,
  );
  assert.match(
    styles,
    /#ingest-pdf\s*\{[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*opacity:\s*0/u,
  );
});

test('palette is black, neutral gray, and sparing eggshell without purple', () => {
  const styles = read('public/styles.css');
  assert.match(styles, /--bg:\s*#0a0a0a/u);
  assert.match(styles, /--ink:\s*#f1eee5/u);
  assert.doesNotMatch(styles, /\b(?:purple|violet|lavender|magenta|plum)\b/iu);
  assert.match(styles, /linear-gradient\(45deg/u);
  assert.match(styles, /linear-gradient\(-45deg/u);
});

test('home-screen metadata is generic, installable, and download-only', () => {
  const app = read('public/app.js');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  for (const file of ['public/index.html', 'public/login.html']) {
    const markup = read(file);
    assert.match(markup, /rel="manifest"\s+href="\/manifest\.webmanifest"/u);
    assert.match(
      markup,
      /rel="apple-touch-icon"\s+sizes="180x180"\s+href="\/icons\/comprosody-180\.png"/u,
    );
    assert.match(markup, /name="apple-mobile-web-app-capable"\s+content="yes"/u);
    assert.match(markup, /name="apple-mobile-web-app-title"\s+content="comprosody"/u);
    assert.match(
      markup,
      /name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/u,
    );
  }
  assert.deepEqual(manifest, {
    id: '/',
    name: 'comprosody reader',
    short_name: 'comprosody',
    description: 'private epub reader and note-taking library',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      {
        src: '/icons/comprosody-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/comprosody-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/comprosody-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  });
  assert.match(
    app,
    /href="\/books\/\$\{encodeURIComponent\(item\.book\)\}\.epub"\s+download>download epub/u,
  );
  assert.doesNotMatch(app, /navigator\.share|data-epub-share/u);
});

test('mobile controls respect safe areas, coarse landscape, and accessible labels', () => {
  const markup = read('public/index.html');
  const loginMarkup = read('public/login.html');
  const registerMarkup = read('public/register.html');
  const app = read('public/app.js');
  const login = read('public/login.js');
  const styles = read('public/styles.css');
  const rubi = read('public/rubi/companion.js');

  assert.match(markup, /aria-labelledby="annotation-heading"/u);
  assert.match(markup, /id="annotation-heading"/u);
  assert.match(markup, /aria-labelledby="organize-heading"/u);
  assert.match(markup, /id="organize-heading"/u);
  assert.match(loginMarkup, /<script type="module" src="\/login\.js"><\/script>/u);
  assert.match(registerMarkup, /<script type="module" src="\/register\.js"><\/script>/u);
  assert.match(loginMarkup, /id="reset-form"/u);
  assert.match(registerMarkup, /name="accessCode"/u);
  assert.doesNotMatch(loginMarkup, /reader and note-taking library/u);
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
  assert.match(styles, /button:focus-visible,[\s\S]*?a:focus-visible\s*\{[^}]*background:\s*var\(--accent-soft\)[^}]*text-decoration:\s*underline/u);
  assert.match(styles, /\.library-intro\s*\{[^}]*border:\s*0;/u);
  assert.match(styles, /\.book-row\s*\{[^}]*border:\s*0;/u);
  assert.doesNotMatch(styles, /\.book-row::before/u);
  assert.match(rubi, /@media \(max-width: 760px\)/u);
  assert.match(rubi, /--rubi-size:\s*52px/u);
  assert.match(rubi, /setPointerCapture/u);
  assert.match(rubi, /data-rubi-edge/u);
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
  assert.match(
    app,
    /pageTurnForArrow/u,
  );
  assert.match(app, /view\?\.document\?\.addEventListener\('keydown', handleReaderArrow/u);
  assert.match(app, /\[role="button"\]/u);
  assert.match(app, /audio\[controls\]/u);
  assert.match(app, /if \(!window\.matchMedia\('\(max-width: 1099px\)'\)\.matches\) return null;/u);
  assert.match(app, /keepalive:\s*true/u);
  assert.match(app, /const profileSaved = await flushProfile\(\)/u);
  assert.match(
    app,
    /if \(isCoverSection\(locatedSection\)\) \{[\s\S]*?readerAtCover = true;[\s\S]*?return;[\s\S]*?readerAtCover = false;[\s\S]*?progress = location\.start\.cfi;/u,
  );
  assert.match(
    app,
    /bookmarkHydrated[\s\S]*?&& !readerAtCover[\s\S]*?&& typeof progress === 'string'/u,
  );
  assert.match(app, /function bookmarkAtCurrentLocation\(\) \{\s*if \(readerAtCover\) return null;/u);
  assert.doesNotMatch(app, /storageKey:\s*'readings-bookmark-outbox-v1'/u);
  assert.match(extractor, /getTextContent/u);
  assert.match(extractor, /data\.fill\(0\)/u);
  assert.doesNotMatch(extractor, /fetch\(|XMLHttpRequest|FormData/u);
  assert.match(app, /api\('\/api\/ingestion-capabilities'\)/u);
  assert.match(app, /loadIngestionCapability\(\{ force: true \}\)/u);
  assert.match(app, /characterCount > capability\.maxSourceCharacters/u);
  assert.ok(
    app.indexOf("loadIngestionCapability({ force: true })")
      < app.indexOf("appendIngestionLog('loading local pdf tools')"),
  );
  assert.match(app, /expectedEpoch !== ingestionEpoch \|\| activeIngestionId !== expectedJobId/u);
});
