import {
  HttpError,
  reqObject,
  reqString,
  reqNumber,
  optHeaderStringArray,
} from './validate.js';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

describe('optHeaderStringArray', () => {
  it('decodes a base64 JSON string array', () => {
    expect(optHeaderStringArray(encode(['comprosody', 'zmuhls']), 10, 64)).toEqual([
      'comprosody',
      'zmuhls',
    ]);
  });

  // Pinned literal, asserted identically in src/lib/lexicon.test.ts.
  it('decodes the exact wire format the client encoder produces', () => {
    expect(
      optHeaderStringArray('WyJjb21wcm9zb2R5Iiwiem11aGxzIiwibmHDr3ZlIl0=', 10, 64)
    ).toEqual(['comprosody', 'zmuhls', 'naïve']);
  });

  it('round-trips non-ASCII terms', () => {
    expect(optHeaderStringArray(encode(['naïve', '中文']), 10, 64)).toEqual([
      'naïve',
      '中文',
    ]);
  });

  it('returns an empty array for a missing or empty header', () => {
    expect(optHeaderStringArray(undefined, 10, 64)).toEqual([]);
    expect(optHeaderStringArray('', 10, 64)).toEqual([]);
    expect(optHeaderStringArray(['a', 'b'], 10, 64)).toEqual([]);
  });

  // A corrupt hint must never block a transcription the user is waiting on.
  it('returns an empty array rather than throwing on malformed input', () => {
    expect(optHeaderStringArray('not-base64!!', 10, 64)).toEqual([]);
    expect(optHeaderStringArray(encode({ not: 'an array' }), 10, 64)).toEqual([]);
    expect(optHeaderStringArray(encode('a string'), 10, 64)).toEqual([]);
  });

  it('drops non-string, empty, and over-long items', () => {
    expect(
      optHeaderStringArray(encode(['ok', 42, null, '  ', 'toolong']), 10, 5)
    ).toEqual(['ok']);
  });

  it('trims surrounding whitespace', () => {
    expect(optHeaderStringArray(encode(['  padded  ']), 10, 64)).toEqual(['padded']);
  });

  it('caps the number of items', () => {
    expect(optHeaderStringArray(encode(['a', 'b', 'c', 'd']), 2, 64)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('HttpError', () => {
  it('carries status and message', () => {
    const err = new HttpError(413, 'too large');
    expect(err.status).toBe(413);
    expect(err.message).toBe('too large');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('reqObject', () => {
  it('returns the object when given a plain object', () => {
    const body = { a: 1 };
    expect(reqObject(body)).toBe(body);
  });

  it('throws 400 for undefined, null, arrays, and primitives', () => {
    for (const bad of [undefined, null, [], 'x', 42, true]) {
      let caught: unknown;
      try {
        reqObject(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).status).toBe(400);
    }
  });

  it('uses a custom message when provided', () => {
    expect(() => reqObject(null, 'item must be an object')).toThrowError(
      'item must be an object'
    );
  });
});

describe('reqString', () => {
  it('returns the string when valid', () => {
    expect(reqString({ key: 'hello' }, 'key', 10)).toBe('hello');
  });

  it('throws when missing, non-string, blank, or too long', () => {
    expect(() => reqString({}, 'key', 10)).toThrowError(HttpError);
    expect(() => reqString({ key: 3 }, 'key', 10)).toThrowError(HttpError);
    expect(() => reqString({ key: '   ' }, 'key', 10)).toThrowError(HttpError);
    expect(() => reqString({ key: 'x'.repeat(11) }, 'key', 10)).toThrowError(HttpError);
  });

  it('accepts a string exactly at maxLen', () => {
    expect(reqString({ key: 'x'.repeat(10) }, 'key', 10)).toBe('x'.repeat(10));
  });
});

describe('reqNumber', () => {
  it('returns the number when in range', () => {
    expect(reqNumber({ t: 0.7 }, 't', 0, 2)).toBe(0.7);
    expect(reqNumber({ t: 0 }, 't', 0, 2)).toBe(0);
    expect(reqNumber({ t: 2 }, 't', 0, 2)).toBe(2);
  });

  it('throws when missing, non-number, non-finite, or out of range', () => {
    expect(() => reqNumber({}, 't', 0, 2)).toThrowError(HttpError);
    expect(() => reqNumber({ t: '1' }, 't', 0, 2)).toThrowError(HttpError);
    expect(() => reqNumber({ t: NaN }, 't', 0, 2)).toThrowError(HttpError);
    expect(() => reqNumber({ t: Infinity }, 't', 0, 2)).toThrowError(HttpError);
    expect(() => reqNumber({ t: -0.1 }, 't', 0, 2)).toThrowError(HttpError);
    expect(() => reqNumber({ t: 2.1 }, 't', 0, 2)).toThrowError(HttpError);
  });
});
