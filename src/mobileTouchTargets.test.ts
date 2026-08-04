import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const mobileStart = stylesheet.indexOf('@media (max-width: 900px)');
const mobileEnd = stylesheet.indexOf(
  '@media (prefers-reduced-motion: reduce)',
  mobileStart,
);
const mobileStyles = stylesheet.slice(mobileStart, mobileEnd);

function declarationsFor(...selectors: string[]) {
  const blocks = [...mobileStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const rules = blocks.filter((match) =>
    selectors.every((selector) => match[1].includes(selector)),
  );

  expect(
    rules.length,
    `Expected a mobile rule for ${selectors.join(', ')}`,
  ).toBeGreaterThan(0);
  return rules.map((rule) => rule[2]).join('\n');
}

function expectFortyFourPixelTarget(...selectors: string[]) {
  const declarations = declarationsFor(...selectors);
  expect(declarations).toContain('min-width: 44px');
  expect(declarations).toContain('min-height: 44px');
}

describe('mobile touch target stylesheet contract', () => {
  it('keeps compact icon controls inside 44px mobile hit areas', () => {
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expectFortyFourPixelTarget(
      '.sidebar-header .icon-button',
      '.entry-folder-action',
      '.tree-rename-action',
      '.tree-delete',
      '.editor-topbar .icon-button',
      '.refinement-sidecar-header .icon-button',
    );
  });

  it('keeps the refinement, recording, and provider controls touch-sized', () => {
    expectFortyFourPixelTarget('.refinement-send');
    expectFortyFourPixelTarget('.mini-switch');
    expectFortyFourPixelTarget('.record-button');
    expectFortyFourPixelTarget('.refinement-guidance button');

    expect(declarationsFor('.refinement-input-shell', '.text-action')).toContain(
      'min-height: 44px',
    );
    expect(
      declarationsFor(
        '.refinement-preset',
        '.refinement-accept',
        '.refinement-reject',
        '.refinement-stop',
      ),
    ).toContain('min-height: 44px');
    expect(declarationsFor('.provider-trigger')).toContain('min-height: 44px');
    expect(declarationsFor('.background-limit-trigger')).toContain(
      'min-height: 44px',
    );
  });

  it('keeps title and full-row targets at least 44px high', () => {
    expect(declarationsFor('.document-title')).toContain('min-height: 44px');
    expect(
      declarationsFor(
        '.entry-primary-action',
        '.tree-primary-action',
        '.tree-row',
        '.breadcrumb',
        '.mobile-workspace-switch button',
      ),
    ).toContain('min-height: 44px');
  });

  it('keeps the microphone fully inside its keyboard-open dock', () => {
    const dock = declarationsFor(
      'html[data-virtual-keyboard="open"] .interaction-dock',
    );
    const control = declarationsFor(
      'html[data-virtual-keyboard="open"] .record-control',
    );
    const button = declarationsFor(
      'html[data-virtual-keyboard="open"] .record-button',
    );

    expect(dock).toContain('height: 82px');
    expect(control).toContain('top: 8px');
    expect(button).toContain('height: 50px');
    expect(8 + 50).toBeLessThan(82);
  });
});
