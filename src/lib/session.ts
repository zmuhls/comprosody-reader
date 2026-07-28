export const SESSION_LOGOUT_INTENT_EVENT =
  'cadence:session-logout-intent';

const DEFAULT_LOGOUT_TIMEOUT_MS = 8_000;

export function announceLogoutIntent(
  target: Pick<Window, 'dispatchEvent'> = window,
): void {
  target.dispatchEvent(new Event(SESSION_LOGOUT_INTENT_EVENT));
}

export async function clearSession(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_LOGOUT_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const request = fetchImpl('/api/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
    },
    signal: controller.signal,
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Could not log out.'));
    }, Math.max(1, timeoutMs));
  });

  try {
    const response = await Promise.race([request, deadline]);
    if (!response.ok) {
      throw new Error('Could not log out.');
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function redirectToLogin(
  locationTarget: Pick<Location, 'replace'> = window.location,
): void {
  locationTarget.replace('/login.html');
}
