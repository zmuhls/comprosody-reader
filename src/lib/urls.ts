export function resolveCadenceApiBaseUrl(
  configuredValue: string | undefined,
  isProduction: boolean,
): string {
  const defaultValue = isProduction ? '/studio/api' : '/api';
  const trimmed = configuredValue?.trim() ?? '';
  if (!trimmed) return defaultValue;
  return trimmed.replace(/\/+$/, '');
}

/**
 * Cadence is mounted behind the Readings `/studio` gateway in production.
 * Local development continues to use Vite's `/api` proxy unless an explicit
 * VITE_CADENCE_API_BASE_URL is supplied (for example,
 * `http://127.0.0.1:3001/api`).
 */
export const CADENCE_API_BASE_URL = resolveCadenceApiBaseUrl(
  import.meta.env.VITE_CADENCE_API_BASE_URL,
  import.meta.env.PROD,
);

export function cadenceApiUrl(path: string): string {
  const normalizedPath = path.trim();
  if (!normalizedPath) return CADENCE_API_BASE_URL;
  return `${CADENCE_API_BASE_URL}${
    normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  }`;
}
