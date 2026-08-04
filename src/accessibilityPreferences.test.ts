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

  it('keeps pre-recording options directly available on touch layouts', () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.recording-options-trigger\s*\{[\s\S]*?display:\s*inline-flex;/,
    );
    expect(stylesheet).toMatch(
      /\.recording-row\[data-options-open="true"\] \.recording-options-panel\s*\{\s*display:\s*grid;/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.recording-options-panel \.provider-trigger,[\s\S]*?font-size:\s*14px;/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.recording-options-panel > strong\s*\{[\s\S]*?font-size:\s*16px;/,
    );
    expect(stylesheet).toMatch(
      /\.interaction-dock:has\(\.recording-row\[data-options-open="true"\]\) \.refinement-composer\s*\{[\s\S]*?visibility:\s*hidden;/,
    );
  });
});
