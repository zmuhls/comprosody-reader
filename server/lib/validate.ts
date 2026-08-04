export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function reqObject(
  value: unknown,
  message = 'JSON body required'
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, message);
  }
  return value as Record<string, unknown>;
}

export function reqString(
  body: Record<string, unknown>,
  key: string,
  maxLen: number
): string {
  const value = body[key];
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxLen
  ) {
    throw new HttpError(
      400,
      `${key} must be a non-empty string of at most ${maxLen} chars`
    );
  }
  return value;
}

/**
 * Decode an optional base64-encoded JSON string array from a request header.
 *
 * Returns [] rather than throwing on anything malformed: this carries an
 * optional transcription hint, and a corrupt hint must never block a
 * transcription the user is waiting on.
 */
export function optHeaderStringArray(
  value: unknown,
  maxItems: number,
  maxItemLen: number
): string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64').toString('utf8')
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= maxItemLen)
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

export function reqNumber(
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, `${key} must be a number between ${min} and ${max}`);
  }
  return value;
}
