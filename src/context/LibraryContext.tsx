/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchLibraryCatalog,
  fetchReaderShellTheme,
} from '../lib/libraryApi';
import type {
  LibraryPublication,
  ReaderShellTheme,
} from '../types/library';

interface LocationRequest {
  cfiRange: string;
  requestId: string;
}

interface LibraryContextValue {
  activePublication: LibraryPublication | null;
  catalog: LibraryPublication[];
  closePublication: () => void;
  error: string | null;
  isLoading: boolean;
  locationRequest: LocationRequest | null;
  openPublication: (publicationId: string, cfiRange?: string) => void;
  refresh: () => Promise<void>;
  theme: ReaderShellTheme;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

async function fetchLibrarySnapshot(): Promise<
  [LibraryPublication[], ReaderShellTheme]
> {
  return Promise.all([
    fetchLibraryCatalog(),
    fetchReaderShellTheme(),
  ]);
}

function cacheReaderTheme(theme: ReaderShellTheme): void {
  try {
    localStorage.setItem('readings-theme', theme);
  } catch {
    // The server profile remains authoritative when storage is restricted.
  }
}

function initialReaderTheme(): ReaderShellTheme {
  try {
    return localStorage.getItem('readings-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<LibraryPublication[]>([]);
  const [activePublicationId, setActivePublicationId] = useState<string | null>(
    null,
  );
  const [locationRequest, setLocationRequest] = useState<LocationRequest | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ReaderShellTheme>(initialReaderTheme);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextCatalog, nextTheme] = await fetchLibrarySnapshot();
      setCatalog(nextCatalog);
      setTheme(nextTheme);
      cacheReaderTheme(nextTheme);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The reading library could not be opened.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchLibrarySnapshot()
      .then(([nextCatalog, nextTheme]) => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        setTheme(nextTheme);
        cacheReaderTheme(nextTheme);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'The reading library could not be opened.',
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.readerTheme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const openPublication = useCallback(
    (publicationId: string, cfiRange?: string) => {
      setActivePublicationId(publicationId);
      setLocationRequest(
        cfiRange
          ? { cfiRange, requestId: crypto.randomUUID() }
          : null,
      );
    },
    [],
  );

  const closePublication = useCallback(() => {
    setActivePublicationId(null);
    setLocationRequest(null);
  }, []);

  const activePublication = useMemo(
    () =>
      catalog.find((publication) => publication.id === activePublicationId) ??
      null,
    [activePublicationId, catalog],
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      activePublication,
      catalog,
      closePublication,
      error,
      isLoading,
      locationRequest,
      openPublication,
      refresh,
      theme,
    }),
    [
      activePublication,
      catalog,
      closePublication,
      error,
      isLoading,
      locationRequest,
      openPublication,
      refresh,
      theme,
    ],
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used inside LibraryProvider');
  }
  return context;
}
