import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const INPUT_KEYS = new Set(['metadata', 'text', 'chapters', 'sections']);
const METADATA_KEYS = new Set(['title', 'author', 'language', 'identifier', 'description', 'publisher']);
const CHAPTER_KEYS = new Set(['title', 'text']);
const MIMETYPE = 'application/epub+zip';

export class EpubBuildError extends Error {
  constructor(message, code = 'invalid_epub_input') {
    super(message);
    this.name = 'EpubBuildError';
    this.code = code;
  }
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EpubBuildError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new EpubBuildError(`${label} contains an unsupported field.`);
  }
}

function cleanXmlText(value, maxLength) {
  if (typeof value !== 'string') throw new EpubBuildError('EPUB text fields must be strings.');
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .normalize('NFC')
    .slice(0, maxLength);
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeLanguage(value) {
  const language = typeof value === 'string' ? value.trim() : 'en';
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'en';
}

function deterministicIdentifier(metadata, chapters) {
  const digest = createHash('sha256')
    .update(metadata.title)
    .update('\0')
    .update(metadata.author)
    .update('\0')
    .update(chapters.map((chapter) => `${chapter.title}\0${chapter.text}`).join('\0'))
    .digest('hex');
  const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return `urn:uuid:${uuid}`;
}

function normalizeMetadata(metadata = {}, chapters) {
  exactKeys(metadata, METADATA_KEYS, 'metadata');
  const title = cleanXmlText(metadata.title || 'untitled reading', 240).replace(/\s+/g, ' ').trim() || 'untitled reading';
  const author = cleanXmlText(metadata.author || 'unknown', 240).replace(/\s+/g, ' ').trim() || 'unknown';
  const result = {
    title,
    author,
    language: normalizeLanguage(metadata.language),
    description: cleanXmlText(metadata.description || '', 2_000).replace(/\s+/g, ' ').trim(),
    publisher: cleanXmlText(metadata.publisher || '', 240).replace(/\s+/g, ' ').trim(),
  };
  const suppliedIdentifier = cleanXmlText(metadata.identifier || '', 500).replace(/\s+/g, ' ').trim();
  result.identifier = suppliedIdentifier || deterministicIdentifier(result, chapters);
  return result;
}

function normalizeChapter(chapter, index) {
  exactKeys(chapter, CHAPTER_KEYS, `chapters[${index}]`);
  const text = cleanXmlText(chapter.text, 2_000_000).trim();
  if (!text) throw new EpubBuildError(`chapters[${index}] contains no text.`);
  const title = cleanXmlText(chapter.title || `section ${index + 1}`, 240).replace(/\s+/g, ' ').trim();
  return { title: title || `section ${index + 1}`, text };
}

function normalizeInput(input) {
  exactKeys(input, INPUT_KEYS, 'EPUB input');
  if (Buffer.isBuffer(input.text) || ArrayBuffer.isView(input.text) || input.text instanceof ArrayBuffer) {
    throw new EpubBuildError('Binary source input is not supported.');
  }

  let chapters;
  if (Array.isArray(input.chapters)) {
    chapters = input.chapters;
  } else if (Array.isArray(input.sections)) {
    chapters = input.sections.map((section) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)
          || typeof section.text !== 'string'
          || (section.title !== undefined && typeof section.title !== 'string')) {
        throw new EpubBuildError('sections must contain text chapters.');
      }
      return { title: section.title || '', text: section.text };
    });
  } else if (typeof input.text === 'string') {
    chapters = [{ title: 'text', text: input.text }];
  } else {
    throw new EpubBuildError('EPUB input requires text, sections, or chapters.');
  }
  if (chapters.length < 1 || chapters.length > 500) {
    throw new EpubBuildError('EPUB input must contain between 1 and 500 chapters.');
  }
  const normalizedChapters = chapters.map(normalizeChapter);
  return {
    metadata: normalizeMetadata(input.metadata || {}, normalizedChapters),
    chapters: normalizedChapters,
  };
}

function paragraphs(text) {
  return text.split(/\n[ \t]*\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function paragraphXhtml(paragraph) {
  const escapedLines = paragraph.split('\n').map((line) => escapeXml(line.trimEnd()));
  return `      <p>${escapedLines.join('<br/>')}</p>`;
}

function chapterXhtml(chapter, metadata, index) {
  const body = paragraphs(chapter.text).map(paragraphXhtml).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(metadata.language)}" lang="${escapeXml(metadata.language)}">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>${escapeXml(chapter.title)}</title>
    <link rel="stylesheet" type="text/css" href="../styles.css"/>
  </head>
  <body>
    <section epub:type="chapter" role="doc-chapter" aria-labelledby="chapter-${index + 1}-title">
      <h1 id="chapter-${index + 1}-title">${escapeXml(chapter.title)}</h1>
${body}
    </section>
  </body>
</html>
`;
}

function navXhtml(metadata, chapters) {
  const items = chapters.map((chapter, index) => (
    `        <li><a href="text/chapter-${String(index + 1).padStart(3, '0')}.xhtml">${escapeXml(chapter.title)}</a></li>`
  )).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(metadata.language)}" lang="${escapeXml(metadata.language)}">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>contents</title>
    <link rel="stylesheet" type="text/css" href="styles.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc" role="doc-toc">
      <h1>contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

function contentOpf(metadata, chapters, modified) {
  const chapterManifest = chapters.map((_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return `    <item id="chapter-${number}" href="text/chapter-${number}.xhtml" media-type="application/xhtml+xml"/>`;
  }).join('\n');
  const spine = chapters.map((_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return `    <itemref idref="chapter-${number}"/>`;
  }).join('\n');
  const optionalDescription = metadata.description ? `\n    <dc:description>${escapeXml(metadata.description)}</dc:description>` : '';
  const optionalPublisher = metadata.publisher ? `\n    <dc:publisher>${escapeXml(metadata.publisher)}</dc:publisher>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(metadata.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(metadata.identifier)}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:language>${escapeXml(metadata.language)}</dc:language>
    <dc:creator id="creator">${escapeXml(metadata.author)}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>${optionalDescription}${optionalPublisher}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="styles" href="styles.css" media-type="text/css"/>
${chapterManifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const BOOK_CSS = `@namespace epub "http://www.idpf.org/2007/ops";
html {
  color: #171719;
  background: #fff;
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}
body {
  margin: 0 auto;
  max-width: 42rem;
  padding: 5%;
}
h1 {
  font-size: 1.35em;
  font-weight: 500;
  line-height: 1.2;
  margin: 0 0 2em;
}
p {
  margin: 0 0 1em;
  orphans: 2;
  widows: 2;
}
nav ol {
  padding-left: 1.25em;
}
nav li {
  margin: 0 0 .75em;
}
a {
  color: inherit;
}
`;

function normalizedModifiedAt(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new EpubBuildError('modifiedAt is invalid.');
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Creates an EPUB 3 archive and a source-free build report.
 */
export async function buildEpub(input, { modifiedAt } = {}) {
  const { metadata, chapters } = normalizeInput(input);
  const modified = normalizedModifiedAt(modifiedAt);
  const zip = new JSZip();

  // EPUB requires this to be the first local-file entry and stored without compression.
  zip.file('mimetype', MIMETYPE, { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/content.opf', contentOpf(metadata, chapters, modified));
  zip.file('OEBPS/nav.xhtml', navXhtml(metadata, chapters));
  zip.file('OEBPS/styles.css', BOOK_CSS);
  chapters.forEach((chapter, index) => {
    const filename = `OEBPS/text/chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
    zip.file(filename, chapterXhtml(chapter, metadata, index));
  });

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: MIMETYPE,
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  const report = Object.freeze({
    format: 'EPUB 3',
    mediaType: MIMETYPE,
    identifier: metadata.identifier,
    title: metadata.title,
    author: metadata.author,
    language: metadata.language,
    chapters: chapters.length,
    sourceCharacters: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
    archiveBytes: buffer.length,
    entries: 5 + chapters.length,
    modified,
  });
  return { buffer, report };
}

export async function buildEpubBuffer(input, options) {
  return (await buildEpub(input, options)).buffer;
}
