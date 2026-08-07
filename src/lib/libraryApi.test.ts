import {
  fetchReaderShellTheme,
  readSourceFormat,
  resolvePublicationPdf,
} from './libraryApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchReaderShellTheme', () => {
  it('uses the authenticated Readings profile as the shared shell theme', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ preferences: { theme: 'dark' } }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchReaderShellTheme()).resolves.toBe('dark');
    expect(fetchMock).toHaveBeenCalledWith('/api/profile', {
      credentials: 'include',
    });
  });

  it('falls back to the Readings light shell for unknown profile values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ preferences: { theme: 'system' } }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
      ),
    );

    await expect(fetchReaderShellTheme()).resolves.toBe('light');
  });
});

describe('publication source resolution', () => {
  it('reads the ingestion format from any spelling the catalog uses', () => {
    expect(readSourceFormat({ sourceFormat: 'PDF' })).toBe('pdf');
    expect(readSourceFormat({ source_format: 'epub' })).toBe('epub');
    expect(readSourceFormat({ source: 'uploads/thesis.pdf' })).toBe('pdf');
    expect(readSourceFormat({ pdfUrl: '/books/solaris.pdf' })).toBe('pdf');
    expect(readSourceFormat({ format: 'epub' })).toBe('epub');
    expect(readSourceFormat({})).toBeUndefined();
  });

  it('prefers an explicit catalog PDF over probing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolvePublicationPdf({ id: 'solaris', sourceUrl: '/files/solaris.pdf' }),
    ).resolves.toBe('/files/solaris.pdf');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips the probe for publications known to be EPUB-sourced', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      resolvePublicationPdf({ id: 'solaris', sourceFormat: 'epub' }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes the conventional path when the catalog reports no format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          headers: { 'Content-Type': 'application/pdf' },
          status: 200,
        }),
      ),
    );

    await expect(resolvePublicationPdf({ id: 'barn burning' })).resolves.toBe(
      '/books/barn%20burning.pdf',
    );
  });

  it('rejects an HTML SPA fallback answering the probe with 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          headers: { 'Content-Type': 'text/html' },
          status: 200,
        }),
      ),
    );

    await expect(resolvePublicationPdf({ id: 'solaris' })).resolves.toBeNull();
  });

  it('reports no PDF when the probe fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(resolvePublicationPdf({ id: 'solaris' })).resolves.toBeNull();
  });
});
