import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const NOTE_SOURCE =
  'Archival absence reshapes how public memory returns through the documents we preserve.';

async function attachScreenshot(page, testInfo, name) {
  const directory = process.env.COMPROSODY_E2E_SCREENSHOT_DIR
    || path.join(os.tmpdir(), 'comprosody-workspace-e2e-screenshots');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${testInfo.project.name}-${name}`);
  await testInfo.attach(name, {
    body: await page.screenshot({
      animations: 'disabled',
      fullPage: false,
      path: filename,
    }),
    contentType: 'image/png',
  });
}

async function createNote(page) {
  await page.goto('./');
  const emptyMessage = page.getByText('A quiet place for spoken thought.');
  await expect(emptyMessage).toBeVisible();
  await emptyMessage.locator('..').getByRole('button', { name: 'New note' }).click();
  const body = page.getByLabel('Note body');
  await expect(body).toBeVisible();
  return body;
}

async function beginRename(locator, projectName) {
  if (projectName === 'webkit-phone') {
    await locator.tap();
    await locator.tap();
  } else {
    await locator.dblclick();
  }
}

async function openDirectoryIfNeeded(page) {
  const newFolder = page.getByRole('button', { name: 'New folder' });
  if (!(await newFolder.isVisible())) {
    await page.getByRole('button', { name: 'Open note directory' }).click();
  }
  await expect(newFolder).toBeVisible();
}

test('titles a private note in the background without blocking writing', async ({
  page,
}) => {
  const body = await createNote(page);
  await body.fill(NOTE_SOURCE);
  await expect(body).toContainText('Archival absence reshapes');
  await expect(
    page.getByRole('button', {
      name: 'Rename note title: Archive and Public Memory',
    }),
  ).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('Titled by Comprosody')).toBeVisible();
});

test('manual title editing suspends background titling in every browser engine', async ({
  page,
}, testInfo) => {
  let titleRequests = 0;
  await page.route('**/studio/api/refine/complete', async (route) => {
    titleRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'Automatic title must not win' }),
    });
  });
  const body = await createNote(page);
  await body.fill(NOTE_SOURCE);
  await beginRename(page.getByRole('button', {
    name: /Rename note title:/,
  }), testInfo.project.name);
  const input = page.getByRole('textbox', { name: 'Note title' });
  await input.fill('Manual title in progress');
  await page.waitForTimeout(1_400);
  await expect(input).toHaveValue('Manual title in progress');
  expect(titleRequests).toBe(0);

  await input.press('Enter');
  await expect(page.getByRole('button', {
    name: 'Rename note title: Manual title in progress',
  })).toBeVisible();
  await page.waitForTimeout(1_400);
  expect(titleRequests).toBe(0);
});

test('double activation renames notes and folders, then places a note by touch-safe controls', async ({
  page,
}, testInfo) => {
  const body = await createNote(page);
  await body.fill(NOTE_SOURCE);
  const titleDisplay = page.getByRole('button', {
    name: /Rename note title:/,
  });
  await beginRename(titleDisplay, testInfo.project.name);
  const titleInput = page.getByRole('textbox', { name: 'Note title' });
  await titleInput.fill('Public Memory Note');
  await titleInput.press('Enter');
  await expect(
    page.getByRole('button', {
      name: 'Rename note title: Public Memory Note',
    }),
  ).toBeVisible();

  await openDirectoryIfNeeded(page);
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('button', { name: 'Rename directory New Folder' }).click();
  const folderInput = page.getByRole('textbox', { name: 'Rename directory' });
  await folderInput.fill('Archive');
  await folderInput.press('Enter');

  await page.getByRole('button', { name: 'Move Public Memory Note' }).click();
  await page.getByRole('button', { name: 'place here' }).click();
  await expect(page.locator('.tree-move-status')).toContainText(
    'Public Memory Note moved to Archive.',
  );
  const archiveBranch = page
    .getByRole('button', { name: 'Archive', exact: true })
    .locator('..')
    .locator('..');
  await expect(
    archiveBranch
      .locator('.tree-children')
      .getByRole('button', { name: 'Public Memory Note', exact: true }),
  ).toBeVisible();
  await attachScreenshot(page, testInfo, 'renamed-and-organized-note.png');
});

test('resizes and persists the note directory on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'webkit-phone', 'The phone directory is an overlay.');
  await createNote(page);
  const sidebar = page.locator('.sidebar');
  const separator = page.getByRole('separator', {
    name: 'Resize note directory',
  });
  const before = await sidebar.boundingBox();
  const handle = await separator.boundingBox();
  expect(before).not.toBeNull();
  expect(handle).not.toBeNull();

  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 64, handle.y + 80);
  await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(
    before.width + 50,
  );
  const resized = await sidebar.boundingBox();

  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeCloseTo(
    resized.width,
    0,
  );
});

test('keeps the microphone inside its dock above an iOS visual keyboard', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-phone', 'iOS visual viewport contract.');
  await page.addInitScript(() => {
    localStorage.setItem('readings-theme', 'dark');
    const listeners = new Map();
    const viewport = {
      height: 360,
      width: 390,
      offsetTop: 0,
      offsetLeft: 0,
      addEventListener(type, listener) {
        const current = listeners.get(type) ?? [];
        current.push(listener);
        listeners.set(type, current);
      },
      removeEventListener(type, listener) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((current) => current !== listener),
        );
      },
    };
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    window.setTestVisualViewport = (next) => {
      Object.assign(viewport, next);
      for (const listener of listeners.get('resize') ?? []) listener();
    };
  });
  const body = await createNote(page);
  await body.fill(NOTE_SOURCE);
  await body.focus();
  await expect(page.locator('html')).toHaveAttribute('data-virtual-keyboard', 'open');

  const dock = await page.locator('.interaction-dock').boundingBox();
  const microphone = await page
    .getByRole('button', { name: 'Start recording' })
    .boundingBox();
  expect(dock).not.toBeNull();
  expect(microphone).not.toBeNull();
  expect(microphone.y).toBeGreaterThanOrEqual(dock.y);
  expect(microphone.y + microphone.height).toBeLessThanOrEqual(
    dock.y + dock.height,
  );
  expect(microphone.width).toBeGreaterThanOrEqual(50);
  await attachScreenshot(page, testInfo, 'ios-keyboard-microphone.png');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    window.setTestVisualViewport({ height: 250, width: 844 });
  });
  await expect(page.locator('.sidebar')).toHaveRole('dialog');
  await expect(page.locator('html')).toHaveAttribute('data-virtual-keyboard', 'open');
  const landscapeDock = await page.locator('.interaction-dock').boundingBox();
  const landscapeMicrophone = await page
    .getByRole('button', { name: 'Start recording' })
    .boundingBox();
  expect(landscapeDock).not.toBeNull();
  expect(landscapeMicrophone).not.toBeNull();
  expect(landscapeMicrophone.y).toBeGreaterThanOrEqual(landscapeDock.y);
  expect(landscapeMicrophone.y + landscapeMicrophone.height).toBeLessThanOrEqual(
    landscapeDock.y + landscapeDock.height,
  );
  await attachScreenshot(page, testInfo, 'ios-landscape-keyboard-microphone.png');
});
