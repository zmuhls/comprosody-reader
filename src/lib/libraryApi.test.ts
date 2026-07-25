import { fetchReaderShellTheme } from './libraryApi';

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
