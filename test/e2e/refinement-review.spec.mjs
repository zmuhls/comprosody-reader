import { expect, test } from '@playwright/test';

const SOURCE =
  'The archive matters and I think maybe this is because public memory is not fixed. The point comes back later, though I am still finding its shape.';

async function installRealtimeBrowserMocks(page) {
  await page.addInitScript(() => {
    const track = {
      enabled: true,
      stop() {
        sessionStorage.setItem('cadence-e2e-track-stopped', 'yes');
      },
    };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => stream,
      },
    });

    class FakeNode {
      connect() {
        return this;
      }
      disconnect() {}
    }

    class FakeAnalyser extends FakeNode {
      frequencyBinCount = 1024;
      fftSize = 2048;
      getByteTimeDomainData(array) {
        array.fill(128);
      }
    }

    class FakeAudioContext {
      audioWorklet = { addModule: async () => undefined };
      destination = new FakeNode();
      createAnalyser() {
        return new FakeAnalyser();
      }
      createGain() {
        const node = new FakeNode();
        node.gain = { value: 1 };
        return node;
      }
      createMediaStreamSource() {
        return new FakeNode();
      }
      async close() {}
      async resume() {}
    }

    class FakeAudioWorkletNode extends FakeNode {
      constructor() {
        super();
        this.port = { onmessage: null };
        window.setTimeout(() => {
          this.port.onmessage?.({
            data: new Int16Array(1_600).buffer,
          });
        }, 80);
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      constructor() {
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.ondataavailable?.({
          data: new Blob(['recovery-audio'], {
            type: 'audio/webm',
          }),
        });
        this.state = 'inactive';
        queueMicrotask(() => this.onstop?.());
      }
    }

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;
      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();
        this.sent = [];
        window.__cadenceE2eSocket = this;
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.emit('open', {});
          this.emit('message', {
            data: JSON.stringify({
              message_type: 'session_started',
              session_id: 'e2e-session',
            }),
          });
        }, 30);
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      emit(type, event) {
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
      send(value) {
        this.sent.push(value);
        const message = JSON.parse(value);
        if (
          message.message_type === 'input_audio_chunk' &&
          message.audio_base_64 &&
          !this.hasTranscript
        ) {
          this.hasTranscript = true;
          this.emit('message', {
            data: JSON.stringify({
              message_type: 'partial_transcript',
              text: 'The archive',
            }),
          });
          window.setTimeout(() => {
            this.emit('message', {
              data: JSON.stringify({
                message_type: 'partial_transcript',
                text: 'The archive remembers us.',
              }),
            });
          }, 900);
        } else if (message.commit === true) {
          window.setTimeout(() => {
            this.emit('message', {
              data: JSON.stringify({
                message_type: 'committed_transcript',
                text: 'The archive remembers us.',
              }),
            });
          }, 30);
        }
      }
      close() {
        sessionStorage.setItem('cadence-e2e-socket-closed', 'yes');
        this.readyState = FakeWebSocket.CLOSED;
        this.emit('close', {
          code: 1000,
          reason: 'test complete',
          wasClean: true,
        });
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, 'AudioWorkletNode', {
      configurable: true,
      value: FakeAudioWorkletNode,
    });
    Object.defineProperty(window, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
    localStorage.setItem(
      'cadence:transcription-provider',
      'elevenlabs',
    );
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('streams realtime transcription')) {
    await installRealtimeBrowserMocks(page);
  }
  await page.goto('./');
  await expect(
    page.getByText('A quiet place for spoken thought.'),
  ).toBeVisible();
  const emptyState = page
    .getByText('A quiet place for spoken thought.')
    .locator('..');
  await emptyState.getByRole('button', { name: 'New note' }).click();
  const body = page.getByLabel('Note body');
  await expect(body).toBeVisible();
  await body.fill(SOURCE);
  await expect(body).toContainText('public memory is not fixed');
});

test('streams realtime transcription into the note and keeps batch audio only as recovery', async ({
  page,
}) => {
  await expect(
    page.getByLabel('Transcription provider'),
  ).toContainText('Cloud · Scribe v2');
  const body = page.getByLabel('Note body');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(
    page.getByRole('button', { name: 'Stop recording' }),
  ).toBeVisible();
  const liveTranscript = page.locator('.live-transcript');
  await expect(liveTranscript).toContainText('The archive');
  await expect(liveTranscript).not.toContainText('remembers us.', {
    timeout: 250,
  });
  await expect(body).toContainText(SOURCE);

  await expect(liveTranscript).toContainText('The archive remembers us.');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(body).toContainText('The archive remembers us.');
  await expect(body).toContainText(SOURCE);

  const sent = await page.evaluate(() =>
    window.__cadenceE2eSocket.sent.map((value) => JSON.parse(value)),
  );
  expect(
    sent.some(
      (message) =>
        message.message_type === 'input_audio_chunk' &&
        typeof message.audio_base_64 === 'string' &&
        message.audio_base_64.length > 0,
    ),
  ).toBe(true);
  expect(sent.filter((message) => message.commit === true)).toHaveLength(1);
});

test('streams realtime transcription and tears it down before logout completes', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.locator('.live-transcript')).toContainText('The archive');

  const logout = page.getByRole('button', { name: /Log out/i });
  if (!(await logout.isVisible())) {
    await page.getByRole('button', { name: 'Open note directory' }).click();
  }
  await logout.click();
  await expect(page).toHaveURL(/\/login\.html$/);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        socket: sessionStorage.getItem('cadence-e2e-socket-closed'),
        track: sessionStorage.getItem('cadence-e2e-track-stopped'),
      })),
    )
    .toEqual({ socket: 'yes', track: 'yes' });
});

test('streams a proposal, preserves the note through reject and retry, then accepts explicitly', async ({
  page,
}, testInfo) => {
  const body = page.getByLabel('Note body');
  const refinementTrigger = page.getByRole('button', {
    name: 'Open refinement',
  });
  await refinementTrigger.click();
  const sidecar = page.getByRole('dialog', { name: 'Refinement' });
  await expect(sidecar).toBeVisible();
  await expect(sidecar).toContainText('Nothing changes until you accept.');
  expect(
    await sidecar.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(sidecar).toBeHidden();
  await expect(refinementTrigger).toBeFocused();
  await refinementTrigger.click();
  await expect(sidecar).toBeVisible();

  const faithful = sidecar.getByRole('button', {
    name: /Faithful edit/,
  });
  await faithful.click();
  await expect(sidecar).toContainText('The archive matters because');
  await expect(sidecar).not.toContainText('public memory is not fixed.', {
    timeout: 250,
  });
  await expect(body).toContainText(SOURCE);

  await expect(sidecar).toContainText('Ready for your decision');
  await expect(sidecar).toContainText(
    'The archive matters because public memory is not fixed.',
  );
  await expect(body).toContainText(SOURCE);

  await sidecar.getByRole('button', { name: 'Reject' }).click();
  await expect(sidecar).toContainText(
    'Rejected — guide a retry if useful',
  );
  await expect(body).toContainText(SOURCE);

  const guidance = sidecar.getByLabel('Steer a new attempt');
  await guidance.fill(
    'Keep the opening and make the recurring claim explicit.',
  );
  await sidecar
    .getByRole('button', { name: 'Retry with guidance' })
    .click();
  await expect(sidecar).toContainText('Writing a proposal…');
  await expect(body).toContainText(SOURCE);
  await expect(sidecar).toContainText(
    'The archive matters; its recurring claim is that public memory remains contested.',
  );
  await expect(sidecar).toContainText('Ready for your decision');
  await expect(body).toContainText(SOURCE);

  await sidecar.getByRole('button', { name: 'Accept' }).click();
  await expect(body).toContainText(
    'The archive matters; its recurring claim is that public memory remains contested.',
  );
  await expect(body).not.toContainText('I think maybe');

  const box = await sidecar.boundingBox();
  expect(box).not.toBeNull();
  if (testInfo.project.name === 'webkit-phone') {
    expect(Math.round(box.width)).toBe(
      testInfo.project.use.viewport?.width ?? 390,
    );
    for (const control of [
      sidecar.getByRole('button', { name: /Faithful edit/ }),
      sidecar.getByRole('button', { name: /Full overhaul/ }),
      sidecar.getByRole('button', { name: 'Close refinement' }),
    ]) {
      const controlBox = await control.boundingBox();
      expect(controlBox?.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await sidecar
        .getByLabel('Focused guidance')
        .evaluate((input) => getComputedStyle(input).fontSize),
    ).toBe('16px');
  } else {
    expect(box.width).toBeGreaterThanOrEqual(390);
    expect(Math.round(box.x + box.width)).toBe(1280);
  }
});

test('rejects an accept raced by a writer edit and retries from current text', async ({
  page,
}) => {
  const body = page.getByLabel('Note body');
  await page.getByRole('button', { name: 'Open refinement' }).click();
  const sidecar = page.getByRole('dialog', { name: 'Refinement' });
  await sidecar.getByRole('button', { name: /Faithful edit/ }).click();
  await expect(sidecar).toContainText('Ready for your decision');

  const currentText = `${SOURCE}\n\nWriter's last-minute sentence.`;
  await sidecar.getByRole('button', { name: 'Close refinement' }).click();
  await body.fill(currentText);
  await page
    .getByRole('button', { name: 'Review refinement proposal' })
    .click();
  await expect(sidecar).toBeVisible();
  await sidecar.getByRole('button', { name: 'Accept' }).click();

  await expect(sidecar).toContainText(
    'The source changed — retry against the current note',
  );
  await expect(body).toContainText("Writer's last-minute sentence.");
  await expect(body).not.toContainText('The archive matters because');

  const guidance = sidecar.getByLabel('Steer a new attempt');
  await guidance.fill('Keep my final sentence and repair the transition.');
  await sidecar
    .getByRole('button', { name: 'Retry with guidance' })
    .click();
  await expect(sidecar).toContainText(
    "Writer's last-minute sentence remains while the transition is repaired.",
  );
  await expect(body).toContainText("Writer's last-minute sentence.");
  await sidecar.getByRole('button', { name: 'Accept' }).click();
  await expect(body).toContainText(
    "Writer's last-minute sentence remains while the transition is repaired.",
  );
});

test('exposes logout and replaces the authenticated page', async ({
  page,
}, testInfo) => {
  const logout = page.getByRole('button', { name: /Log out/i });
  if (!(await logout.isVisible())) {
    const opener = page.getByRole('button', { name: 'Open note directory' });
    await opener.click();
    if (testInfo.project.name === 'webkit-phone') {
      const close = page.getByRole('button', {
        name: 'Close note directory',
      }).last();
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await opener.click();
    }
  }
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page).toHaveURL(/\/login\.html$/);
});
