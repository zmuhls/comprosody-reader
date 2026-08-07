import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { buildEpub } from '../lib/epub-builder.js';

test('EPUB builder writes mimetype first with STORE and includes the EPUB 3 container', async () => {
  const { buffer, report } = await buildEpub({
    metadata: {
      title: 'A & <B>',
      author: 'Writer "One"',
      language: 'en-US',
    },
    chapters: [
      { title: 'First <section>', text: 'A safe paragraph with <script>alert("x")</script> & evidence.' },
      { title: 'Second', text: 'Line one.\nLine two.\n\nA second paragraph with “quotation.”' },
    ],
  }, { modifiedAt: '2026-07-25T12:34:56.789Z' });

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  assert.equal(buffer.readUInt16LE(8), 0, 'first ZIP entry must use STORE');
  const filenameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);
  const filename = buffer.subarray(30, 30 + filenameLength).toString('utf8');
  assert.equal(filename, 'mimetype');
  const mimetypeStart = 30 + filenameLength + extraLength;
  assert.equal(buffer.subarray(mimetypeStart, mimetypeStart + 'application/epub+zip'.length).toString(), 'application/epub+zip');

  const zip = await JSZip.loadAsync(buffer);
  assert.equal(Object.keys(zip.files)[0], 'mimetype');
  for (const name of [
    'META-INF/container.xml',
    'OEBPS/content.opf',
    'OEBPS/nav.xhtml',
    'OEBPS/styles.css',
    'OEBPS/text/chapter-001.xhtml',
    'OEBPS/text/chapter-002.xhtml',
  ]) {
    assert.ok(zip.file(name), `missing ${name}`);
  }
  const container = await zip.file('META-INF/container.xml').async('string');
  assert.match(container, /full-path="OEBPS\/content\.opf"/);
  const opf = await zip.file('OEBPS/content.opf').async('string');
  assert.match(opf, /<package[^>]+version="3\.0"/);
  assert.match(opf, /<dc:title>A &amp; &lt;B&gt;<\/dc:title>/);
  assert.match(opf, /<meta property="dcterms:modified">2026-07-25T12:34:56Z<\/meta>/);
  assert.match(opf, /properties="nav"/);
  for (const name of [
    'OEBPS/nav.xhtml',
    'OEBPS/text/chapter-001.xhtml',
    'OEBPS/text/chapter-002.xhtml',
  ]) {
    const xhtml = await zip.file(name).async('string');
    assert.match(
      xhtml,
      /<meta name="viewport" content="width=device-width, initial-scale=1\.0"\/>/,
    );
  }
  const styles = await zip.file('OEBPS/styles.css').async('string');
  assert.match(styles, /-webkit-text-size-adjust:\s*100%/u);
  assert.equal(report.format, 'EPUB 3');
  assert.equal(report.chapters, 2);
  assert.equal(report.entries, 7);
  assert.equal(report.archiveBytes, buffer.length);
});

test('EPUB XHTML escapes source content instead of treating it as markup', async () => {
  const { buffer } = await buildEpub({
    metadata: { title: 'escape test', author: 'reader' },
    text: `Five < six & seven > four. "Quoted" and 'marked'.`,
  }, { modifiedAt: 0 });
  const zip = await JSZip.loadAsync(buffer);
  const chapter = await zip.file('OEBPS/text/chapter-001.xhtml').async('string');
  assert.match(chapter, /Five &lt; six &amp; seven &gt; four\./);
  assert.match(chapter, /&quot;Quoted&quot; and &apos;marked&apos;/);
  assert.doesNotMatch(chapter, /<p>Five < six/);
});

test('EPUB metadata is normalized and its fallback identifier is deterministic', async () => {
  const input = {
    metadata: { title: '  same   title ', author: ' same   author ', language: 'not a language value' },
    sections: [{ title: 'source', text: 'same source text' }],
  };
  const first = await buildEpub(input, { modifiedAt: '2026-01-01T00:00:00Z' });
  const second = await buildEpub(input, { modifiedAt: '2026-01-01T00:00:00Z' });
  assert.equal(first.report.identifier, second.report.identifier);
  assert.match(first.report.identifier, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(first.report.title, 'same title');
  assert.equal(first.report.author, 'same author');
  assert.equal(first.report.language, 'en');
});

test('EPUB builder rejects binary source text', async () => {
  await assert.rejects(
    buildEpub({ metadata: {}, text: Buffer.from('binary') }),
    (error) => error?.code === 'invalid_epub_input',
  );
});
