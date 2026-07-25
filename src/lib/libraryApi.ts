import type {
  LibraryPublication,
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

export function readingShelfUrl(): string {
  const configured = import.meta.env.VITE_READINGS_SHELF_URL?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? 'http://127.0.0.1:3110/' : '/';
}
