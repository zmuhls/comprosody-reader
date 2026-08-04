import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('accessibility preference stylesheet contracts', () => {
  it('supports increased contrast without decorative grid interference', () => {
    expect(stylesheet).toMatch(/@media \(prefers-contrast: more\)/);
    expect(stylesheet).toMatch(
      /@media \(prefers-contrast: more\)[\s\S]*?\.app-frame\s*\{\s*background-image:\s*none;/,
    );
  });

  it('honors reduced transparency with opaque overlays and menus', () => {
    expect(stylesheet).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
    expect(stylesheet).toMatch(
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?backdrop-filter:\s*none;/,
    );
    expect(stylesheet).toMatch(
      /\.speech-search,[\s\S]*?\.speech-voice-list\s*\{\s*background:\s*var\(--color-surface-raised\);/,
    );
  });
});
