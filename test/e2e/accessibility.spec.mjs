import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ACCESSIBILITY_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

function formatViolations(label, violations) {
  return [
    `${label}: ${violations.length} accessibility violation group(s)`,
    ...violations.flatMap((violation) => [
      `- ${violation.id} (${violation.impact || 'unknown'}): ${violation.help}`,
      ...violation.nodes.map((node) => (
        `  ${node.target.join(' ')} :: ${node.failureSummary || node.html}`
      )),
    ]),
  ].join('\n');
}

async function expectNoViolations(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(ACCESSIBILITY_TAGS)
    .analyze();
  expect(
    results.violations,
    formatViolations(label, results.violations),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.bodyWidth, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
  expect(
    geometry.documentWidth,
    `${label}: ${JSON.stringify(geometry)}`,
  ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

async function expectMinimumTargets(page, label, minimum = 24) {
  const undersized = await page.evaluate((minimumSize) => {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'summary',
      '[role="button"]',
      '[role="separator"]',
    ].join(',');
    return [...document.querySelectorAll(selector)].flatMap((element) => {
      if (element.closest('[hidden], [inert]')) return [];
      const style = getComputedStyle(element);
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || (element.classList.contains('skip-link') && document.activeElement !== element)
      ) return [];
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return [];
      if (rect.width >= minimumSize && rect.height >= minimumSize) return [];
      return [{
        height: Math.round(rect.height * 10) / 10,
        name: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 70),
        selector: element.id ? `#${element.id}` : element.outerHTML.slice(0, 130),
        width: Math.round(rect.width * 10) / 10,
      }];
    });
  }, minimum);
  expect(undersized, `${label}: ${JSON.stringify(undersized, null, 2)}`).toEqual([]);
}

async function expectWithinViewport(page, selector, label) {
  const locator = page.locator(selector);
  await expect.poll(async () => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1
      && rect.right <= innerWidth + 1
      && rect.top >= -1
      && rect.bottom <= innerHeight + 1;
  }), { message: `${label}: element should settle inside the viewport` }).toBe(true);
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
      width: rect.width,
    };
  });
  expect(geometry.left, `${label}: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
  expect(geometry.top, `${label}: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(
    geometry.viewportHeight + 1,
  );
}

async function expectFocusTrap(page, selector, label) {
  const count = await page.locator(selector).evaluate((overlay) => {
    const focusable = [...overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.closest('[hidden], [inert]') && element.getClientRects().length);
    if (focusable.length < 2) return 0;
    focusable[0].dataset.a11yEdge = 'first';
    focusable.at(-1).dataset.a11yEdge = 'last';
    return focusable.length;
  });
  expect(count, `${label} focusable controls`).toBeGreaterThan(1);
  const first = page.locator(`${selector} [data-a11y-edge="first"]`);
  const last = page.locator(`${selector} [data-a11y-edge="last"]`);
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
}

function cssTimeListInMilliseconds(value) {
  return value.split(',').map((part) => {
    const normalized = part.trim();
    const duration = Number.parseFloat(normalized);
    return normalized.endsWith('ms') ? duration : duration * 1000;
  });
}

async function createNote(page) {
  await page.goto('./');
  const emptyState = page.getByText('A quiet place for spoken thought.').locator('..');
  await expect(emptyState).toBeVisible();
  await emptyState.getByRole('button', { name: 'New note' }).click();
  const body = page.getByLabel('Note body');
  await expect(body).toBeVisible();
  await body.fill('Accessibility needs to remain visible while spoken thought becomes a note.');
  return body;
}

test('empty workspace and active editor satisfy automated accessibility checks', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('A quiet place for spoken thought.')).toBeVisible();
  await expectNoViolations(page, 'empty workspace');

  await createNote(page);
  await expectNoViolations(page, 'active editor');
  await expectMinimumTargets(page, 'active editor');

  await page.getByRole('button', { name: 'Open source transcript' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Source transcript' }),
  ).toBeVisible();
  await expectNoViolations(page, 'source transcript');

  await page.getByRole('button', { name: 'Open refinement' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectNoViolations(page, 'refinement');
  await expectMinimumTargets(page, 'refinement');
});

test('note directory satisfies automated accessibility checks', async ({ page }, testInfo) => {
  await page.goto('./');
  if (testInfo.project.name === 'webkit-phone') {
    await page.getByRole('button', { name: 'Notes' }).click();
    await expect(page.getByRole('dialog', { name: 'Note directory' })).toBeVisible();
  }
  await expectNoViolations(page, 'note directory');
  await expectMinimumTargets(page, 'note directory');
});

test('keyboard navigation exposes a skip link and editable controls restore focus', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(testInfo.project.name === 'webkit-phone' ? 'Alt+Tab' : 'Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to note' });
  await expect(skipLink).toBeFocused();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.locator('#main-content').getByRole('button', { name: 'New note' }).click();
  const title = page.getByRole('button', { name: /Rename note title:/ });
  await title.focus();
  await page.keyboard.press('Space');
  const titleInput = page.getByRole('textbox', { name: 'Note title' });
  await expect(titleInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(title).toBeFocused();

  const refineInput = page.getByRole('textbox', { name: 'Refine this note' });
  await refineInput.focus();
  const refineFocus = await refineInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(refineFocus.outlineStyle).not.toBe('none');
  expect(refineFocus.outlineWidth).toBeGreaterThanOrEqual(2);

  await page.keyboard.press('Control+k');
  await expect(
    page.getByRole('dialog', { name: 'Comprosody commands and note search' }),
  ).toBeVisible();
  const commandInput = page.getByPlaceholder('Open a note or run a command…');
  await expect(commandInput).toBeFocused();
  const commandFocus = await commandInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(commandFocus.outlineStyle).not.toBe('none');
  expect(commandFocus.outlineWidth).toBeGreaterThanOrEqual(2);
  await expectNoViolations(page, 'command palette');
  await page.keyboard.press('Escape');
});

test('dark theme and reduced motion remain accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('readings-theme', 'dark'));
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'dark');
  await expectNoViolations(page, 'dark empty workspace');
  await createNote(page);
  await expectNoViolations(page, 'dark editor');
  const motion = await page.locator('.interaction-dock').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.animationDuration, style.transitionDuration];
  });
  for (const duration of motion.flatMap(cssTimeListInMilliseconds)) {
    expect(duration).toBeLessThanOrEqual(0.011);
  }
  await page.getByRole('button', { name: 'Open refinement' }).click();
  await expectNoViolations(page, 'dark refinement');
});

test('320px reflow and text spacing preserve the writing workspace', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await createNote(page);
  await page.addStyleTag({
    content: `
      * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-bottom: 2em !important; }
    `,
  });
  await expectNoHorizontalOverflow(page, '320px text spacing');
  await expectMinimumTargets(page, '320px editor', 44);
  await expectWithinViewport(page, '.interaction-dock', '320px recording dock');
  const microphone = page.getByRole('button', { name: 'Start recording' });
  await expect(microphone).toBeVisible();
  const microphoneBox = await microphone.boundingBox();
  expect(microphoneBox?.width).toBeGreaterThanOrEqual(44);
  expect(microphoneBox?.height).toBeGreaterThanOrEqual(44);

  const trigger = page.getByRole('button', { name: 'Open note directory' });
  await trigger.click();
  const sidebar = page.getByRole('dialog', { name: 'Note directory' });
  await expect(sidebar).toHaveClass(/is-open/u);
  await expect(page.locator('.workspace-stage')).toHaveAttribute('inert', '');
  await expectWithinViewport(page, '.sidebar', '320px note directory');
  await expectNoHorizontalOverflow(page, '320px note directory');
  await expectFocusTrap(page, '.sidebar', '320px note directory');
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('responsive breakpoint matrix preserves navigation and recording geometry', async ({
  page,
}) => {
  await createNote(page);
  const cases = [
    { width: 320, height: 568, compact: true },
    { width: 390, height: 844, compact: true },
    { width: 600, height: 900, compact: true },
    { width: 820, height: 900, compact: true },
    { width: 900, height: 900, compact: true },
    { width: 901, height: 900, compact: false },
    { width: 980, height: 800, compact: false },
    { width: 1120, height: 800, compact: false },
    { width: 1280, height: 800, compact: false },
    { width: 844, height: 390, compact: true },
  ];

  for (const entry of cases) {
    const label = `${entry.width}x${entry.height}`;
    await page.setViewportSize({ width: entry.width, height: entry.height });
    await page.waitForFunction((width) => window.innerWidth === width, entry.width);
    await expect(page.getByLabel('Note body')).toBeVisible();
    await expectNoHorizontalOverflow(page, `${label} editor`);
    await expectWithinViewport(page, '.interaction-dock', `${label} recording dock`);
    await expectMinimumTargets(page, `${label} editor`, entry.compact ? 44 : 24);
    const sidebar = page.locator('.sidebar');
    if (entry.compact) {
      await expect(sidebar).toHaveRole('dialog');
      await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
      await page.getByRole('button', { name: 'Open note directory' }).click();
      await expect(sidebar).toHaveClass(/is-open/u);
      await expect(sidebar).toHaveAttribute('aria-modal', 'true');
      await expectWithinViewport(page, '.sidebar', `${label} note directory`);
      await page.getByRole('button', { name: 'Close note directory' }).click();
    } else {
      await expect(sidebar).toHaveRole('complementary');
      await expect(sidebar).toBeVisible();
    }
  }
});

test('forced-colors mode preserves focus and operable controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.goto('./');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to note' });
  await expect(skipLink).toBeFocused();
  const focusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe('none');
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.locator('#main-content').getByRole('button', { name: 'New note' }).click();
  await expectNoViolations(page, 'forced-colors editor');
  await expectMinimumTargets(page, 'forced-colors editor');
});
