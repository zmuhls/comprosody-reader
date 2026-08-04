export const BACKGROUND_RECORDING_LIMITS = [30_000, 60_000, 120_000, 300_000] as const;
export const DEFAULT_BACKGROUND_RECORDING_LIMIT_MS = 120_000;
export const BACKGROUND_RECORDING_LIMIT_KEY = 'comprosody:background-recording-limit-ms';

export function normalizeBackgroundRecordingLimit(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return BACKGROUND_RECORDING_LIMITS.includes(
    numeric as (typeof BACKGROUND_RECORDING_LIMITS)[number],
  )
    ? numeric
    : DEFAULT_BACKGROUND_RECORDING_LIMIT_MS;
}

export function formatBackgroundRecordingLimit(milliseconds: number): string {
  if (milliseconds < 60_000) return `${milliseconds / 1_000} sec`;
  return `${milliseconds / 60_000} min`;
}
