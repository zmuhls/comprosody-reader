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

function expectRoomyTouchTarget(...selectors: string[]) {
  const declarations = declarationsFor(...selectors);
  const minWidths = [...declarations.matchAll(/min-width:\s*(\d+)px/g)].map(
    (match) => Number(match[1]),
  );
  const minHeights = [...declarations.matchAll(/min-height:\s*(\d+)px/g)].map(
    (match) => Number(match[1]),
  );
  expect(Math.max(...minWidths)).toBeGreaterThanOrEqual(48);
  expect(Math.max(...minHeights)).toBeGreaterThanOrEqual(48);
}

describe('mobile touch target stylesheet contract', () => {
  it('keeps icon controls inside roomy 48px mobile hit areas', () => {
    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expectRoomyTouchTarget(
      '.sidebar-header .icon-button',
      '.entry-folder-action',
      '.tree-rename-action',
      '.tree-delete',
      '.editor-topbar .icon-button',
      '.refinement-sidecar-header .icon-button',
    );
  });

  it('keeps the refinement, recording, and provider controls touch-sized', () => {
    expectRoomyTouchTarget('.refinement-send');
    expectRoomyTouchTarget('.mini-switch');
    expectRoomyTouchTarget('.record-button');
    expectRoomyTouchTarget('.refinement-guidance button');

    expect(declarationsFor('.refinement-input-shell', '.text-action')).toContain(
      'min-height: 48px',
    );
    expect(
      declarationsFor(
        '.refinement-preset',
        '.refinement-accept',
        '.refinement-reject',
        '.refinement-stop',
      ),
    ).toContain('min-height: 48px');
    expect(declarationsFor('.provider-trigger')).toContain('min-height: 48px');
    expect(declarationsFor('.background-limit-trigger')).toContain(
      'min-height: 48px',
    );
  });

  it('keeps title and full-row targets at least 48px high', () => {
    expect(declarationsFor('.document-title')).toContain('min-height: 50px');
    expect(
      declarationsFor(
        '.entry-primary-action',
        '.tree-primary-action',
        '.tree-row',
        '.breadcrumb',
        '.mobile-workspace-switch button',
      ),
    ).toContain('min-height: 48px');
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

    expect(dock).toContain('height: 100px');
    expect(control).toContain('top: 12px');
    expect(button).toContain('height: 48px');
    expect(12 + 48).toBeLessThan(100);
  });
});
