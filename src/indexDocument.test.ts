import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const documentMarkup = readFileSync(
  path.join(process.cwd(), 'index.html'),
  'utf8',
);

describe('production document', () => {
  it('uses CSP-compatible local font stacks without remote stylesheets', () => {
    expect(documentMarkup).not.toContain('fonts.googleapis.com');
    expect(documentMarkup).not.toContain('fonts.gstatic.com');
    expect(documentMarkup).not.toMatch(/<link[^>]+rel=["']stylesheet["'][^>]+https?:/iu);
  });
});
