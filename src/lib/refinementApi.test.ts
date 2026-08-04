import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamRefinement } from './refinementApi';

function responseStream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collectStream() {
  const values: string[] = [];
  for await (const value of streamRefinement({
    systemPrompt: 'Preserve the thought.',
    userMessage: 'A draft.',
    temperature: 0.2,
  })) {
    values.push(value);
  }
  return values;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('streamRefinement', () => {
  it('accepts a stream only after the explicit completion sentinel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseStream([
      'data: {"text":"Revised "}\n\n',
      'data: {"text":"draft."}\n\n',
      'data: [DONE]\n\n',
    ])));

    await expect(collectStream()).resolves.toEqual(['Revised ', 'draft.']);
  });

  it('rejects a truncated stream instead of applying partial prose', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseStream([
      'data: {"text":"Partial prose that must not be applied."}\n\n',
    ])));

    await expect(collectStream()).rejects.toThrow(
      'Refinement stream ended before completion.',
    );
  });

  it('fails closed when malformed JSON is followed by a completion sentinel', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseStream([
      'data: {"text":}\n\n',
      'data: [DONE]\n\n',
    ])));

    await expect(collectStream()).rejects.toThrow(
      'Malformed refinement stream payload.',
    );
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid payload instead of skipping to completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseStream([
      'data: {"text":42}\n\n',
      'data: [DONE]\n\n',
    ])));

    await expect(collectStream()).rejects.toThrow(
      'Malformed refinement stream payload.',
    );
  });

  it('rejects an incomplete event even when its JSON is otherwise valid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseStream([
      'data: {"text":"Uncommitted prose."}\n',
    ])));

    await expect(collectStream()).rejects.toThrow(
      'Refinement stream ended with an incomplete event.',
    );
  });
});
