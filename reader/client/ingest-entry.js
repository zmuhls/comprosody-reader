import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_PAGES = 1_500;

function pageText(content) {
  const lines = [];
  let line = '';
  let lastY = null;

  for (const item of content.items) {
    if (!item || typeof item.str !== 'string') continue;
    const y = Number(item.transform?.[5]);
    const startsNewLine = lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > 2;
    if (startsNewLine && line.trim()) {
      lines.push(line.trimEnd());
      line = '';
    }
    if (line && !/\s$/u.test(line) && item.str && !/^[,.;:!?)}\]]/u.test(item.str)) line += ' ';
    line += item.str;
    if (item.hasEOL && line.trim()) {
      lines.push(line.trimEnd());
      line = '';
    }
    if (Number.isFinite(y)) lastY = y;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join('\n').normalize('NFC');
}

function cancelled() {
  return new DOMException('cancelled.', 'AbortError');
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancelled();
}

async function extract(file, { onProgress = () => {}, signal } = {}) {
  if (!(file instanceof File)) {
    throw new Error('choose a pdf.');
  }
  if (!file.size || file.size > MAX_PDF_BYTES) {
    throw new Error('pdf must be between 1 byte and 80 mb.');
  }

  throwIfCancelled(signal);
  const data = new Uint8Array(await file.arrayBuffer());
  throwIfCancelled(signal);
  if (String.fromCharCode(...data.subarray(0, 5)) !== '%PDF-') {
    throw new Error('the selected file is not a valid pdf.');
  }
  const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false });
  const cancelLoading = () => { void loadingTask.destroy(); };
  signal?.addEventListener('abort', cancelLoading, { once: true });
  let document;
  try {
    document = await loadingTask.promise;
    throwIfCancelled(signal);
    if (document.numPages > MAX_PAGES) throw new Error(`pdfs may contain at most ${MAX_PAGES} pages.`);
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      throwIfCancelled(signal);
      const page = await document.getPage(number);
      const content = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      pages.push({ pageNumber: number, text: pageText(content) });
      page.cleanup();
      onProgress({ current: number, total: document.numPages });
    }
    const characterCount = pages.reduce((total, page) => total + page.text.trim().length, 0);
    if (characterCount < Math.max(80, document.numPages * 20)) {
      throw new Error('this pdf has too little readable text. run ocr first.');
    }
    return {
      filename: file.name,
      pageCount: document.numPages,
      pages,
    };
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelLoading);
    await Promise.allSettled([document?.destroy(), loadingTask.destroy()]);
    data.fill(0);
  }
}

window.ReadingsPdfIngest = Object.freeze({ extract });
