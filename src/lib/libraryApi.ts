import type {
  LibraryPublication,
  PublicationSourceFormat,
  ReaderAnnotation,
  ReaderLocation,
  ReaderShellTheme,
} from '../types/library';

interface ReadingsCatalogRecord {
  book?: unknown;
  title?: unknown;
  author?: unknown;
  words?: unknown;
  sections?: unknown;
  status?: unknown;
  // Ingestion metadata. The upstream catalog has used several spellings for
  // this, so every known key is accepted rather than pinning one.
  sourceFormat?: unknown;
  source_format?: unknown;
  source?: unknown;
  format?: unknown;
  sourceUrl?: unknown;
  source_url?: unknown;
  pdf?: unknown;
  pdfUrl?: unknown;
}

interface ReadingsBookState {
  annotations?: unknown;
  progress?: unknown;
}

interface ReadingsProfile {
  preferences?: {
    theme?: unknown;
  };
}

const AUTHORS: Record<string, string> = {
  'barn-burning': 'William Faulkner',
  'good-country-people': "Flannery O'Connor",
  solaris: 'Stanisław Lem',
};

async function requireJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    credentials: 'include',
    ...init,
  });

  if (response.status === 401) {
    window.location.assign('/login.html');
    throw new Error('Your reading session expired. Sign in again to continue.');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // A status code is still useful when the upstream body is not JSON.
    }
    throw new Error(detail || `The reading service returned ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Reads the ingestion format out of whichever key the catalog used. A record
 * that merely carries a `.pdf` source path counts as PDF-ingested.
 */
export function readSourceFormat(
  record: ReadingsCatalogRecord,
): PublicationSourceFormat | undefined {
  const candidates = [
    record.sourceFormat,
    record.source_format,
    record.source,
    record.format,
    record.sourceUrl,
    record.source_url,
    record.pdf,
    record.pdfUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'pdf' || normalized.endsWith('.pdf')) return 'pdf';
    if (normalized === 'epub' || normalized.endsWith('.epub')) return 'epub';
  }
  return undefined;
}

function readSourceUrl(record: ReadingsCatalogRecord): string | undefined {
  for (const candidate of [record.sourceUrl, record.source_url, record.pdfUrl]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function isReaderAnnotation(value: unknown): value is ReaderAnnotation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReaderAnnotation>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.cfiRange === 'string' &&
    typeof candidate.text === 'string'
  );
}

export async function fetchLibraryCatalog(): Promise<LibraryPublication[]> {
  const records = await requireJson<ReadingsCatalogRecord[]>('/api/catalog');

  return records.flatMap((record) => {
    if (typeof record.book !== 'string' || typeof record.title !== 'string') {
      return [];
    }

    return [{
      id: record.book,
      title: record.title,
      author:
        typeof record.author === 'string'
          ? record.author
          : AUTHORS[record.book] ?? 'Unknown',
      words: finiteNumber(record.words),
      sections: finiteNumber(record.sections),
      status: record.status === 'pass' ? 'ready' : 'processing',
      ...(readSourceFormat(record)
        ? { sourceFormat: readSourceFormat(record) }
        : {}),
      ...(readSourceUrl(record) ? { sourceUrl: readSourceUrl(record) } : {}),
    } satisfies LibraryPublication];
  });
}

export async function fetchReaderShellTheme(): Promise<ReaderShellTheme> {
  const profile = await requireJson<ReadingsProfile>('/api/profile');
  return profile.preferences?.theme === 'dark' ? 'dark' : 'light';
}

export async function fetchReadingState(publicationId: string): Promise<{
  annotations: ReaderAnnotation[];
  location: ReaderLocation | null;
}> {
  const state = await requireJson<ReadingsBookState>(
    `/api/annotations/${encodeURIComponent(publicationId)}`,
  );
  const progress = typeof state.progress === 'string' ? state.progress : null;

  return {
    annotations: Array.isArray(state.annotations)
      ? state.annotations.filter(isReaderAnnotation)
      : [],
    location: progress ? { cfi: progress, progress: 0 } : null,
  };
}

export async function saveReadingState(
  publicationId: string,
  annotations: readonly ReaderAnnotation[],
  location: ReaderLocation | null,
): Promise<void> {
  await requireJson<{ ok: true }>(
    `/api/annotations/${encodeURIComponent(publicationId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        annotations,
        progress: location?.cfi ?? null,
      }),
    },
  );
}

export function publicationFileUrl(publicationId: string): string {
  return `/books/${encodeURIComponent(publicationId)}.epub`;
}

export function publicationPdfUrl(publicationId: string): string {
  return `/books/${encodeURIComponent(publicationId)}.pdf`;
}

/**
 * Resolves the original PDF for a publication. An explicit catalog `sourceUrl`
 * wins; otherwise the conventional `/books/<id>.pdf` path is probed, because
 * the catalog does not always report the ingestion format. Returns null when
 * no PDF is reachable, so callers can simply omit the control.
 */
export async function resolvePublicationPdf(
  publication: Pick<LibraryPublication, 'id' | 'sourceFormat' | 'sourceUrl'>,
  signal?: AbortSignal,
): Promise<string | null> {
  if (publication.sourceUrl?.toLowerCase().endsWith('.pdf')) {
    return publication.sourceUrl;
  }
  if (publication.sourceFormat === 'epub') return null;

  const candidate = publicationPdfUrl(publication.id);
  try {
    const response = await fetch(candidate, {
      credentials: 'include',
      method: 'HEAD',
      signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    // A SPA fallback answers 200 with HTML; only a real PDF counts.
    if (contentType && !contentType.toLowerCase().includes('pdf')) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function readingShelfUrl(): string {
  const configured = import.meta.env.VITE_READINGS_SHELF_URL?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? 'http://127.0.0.1:3110/' : '/';
}
