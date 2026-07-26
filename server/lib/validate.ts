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
