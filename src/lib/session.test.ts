import {
  announceLogoutIntent,
  clearSession,
  redirectToLogin,
  SESSION_LOGOUT_INTENT_EVENT,
} from './session';

describe('session logout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the root Readings session without resolving under /studio', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    await clearSession(fetchMock);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('fails closed when the logout endpoint rejects the request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));

    await expect(clearSession(fetchMock)).rejects.toThrow('Could not log out.');
  });

  it('replaces history with the login screen', () => {
    const locationTarget = {
      replace: vi.fn(),
    };

    redirectToLogin(locationTarget);

    expect(locationTarget.replace).toHaveBeenCalledWith('/login.html');
  });

  it('announces logout intent before the network boundary', () => {
    const dispatchEvent = vi.fn();

    announceLogoutIntent({ dispatchEvent });

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: SESSION_LOGOUT_INTENT_EVENT }),
    );
  });

  it('aborts a logout request that exceeds its deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const request = clearSession(fetchMock, 20);
    const rejection = expect(request).rejects.toThrow('Could not log out.');
    await vi.advanceTimersByTimeAsync(21);

    await rejection;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});
