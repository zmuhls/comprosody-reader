import { Router, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { streamRefinement, refineComplete } from '../lib/claude.js';

export const refineRouter = Router();

interface RefineBody {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}

interface VariantsBody {
  systemPrompt: string;
  userMessage: string;
  temperatures: Array<{ label: string; temperature: number }>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function validateRefineBody(body: unknown): body is RefineBody {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Partial<RefineBody>;
  return (
    typeof b.systemPrompt === 'string' &&
    typeof b.userMessage === 'string' &&
    typeof b.temperature === 'number' &&
    b.temperature >= 0 &&
    b.temperature <= 1
  );
}

function validateVariantsBody(body: unknown): body is VariantsBody {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Partial<VariantsBody>;
  if (
    typeof b.systemPrompt !== 'string' ||
    typeof b.userMessage !== 'string' ||
    !Array.isArray(b.temperatures)
  ) {
    return false;
  }
  return b.temperatures.every(
    (t) =>
      typeof t === 'object' &&
      t !== null &&
      typeof (t as { label?: unknown }).label === 'string' &&
      typeof (t as { temperature?: unknown }).temperature === 'number' &&
      (t as { temperature: number }).temperature >= 0 &&
      (t as { temperature: number }).temperature <= 1
  );
}

function createAbortController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller;
}

function abortOnDisconnect(
  req: Request,
  res: Response,
  controller: AbortController,
): () => void {
  const abort = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);
  return () => {
    req.off('aborted', abort);
    res.off('close', abort);
  };
}

function classifyError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Rate limited — retry shortly' };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: 'Invalid API key' };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status ?? 500, message: err.message };
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { status: 504, message: 'Refinement request timed out' };
  }
  return {
    status: 500,
    message: err instanceof Error ? err.message : 'Unknown error',
  };
}

refineRouter.post('/refine', async (req, res) => {
  if (!validateRefineBody(req.body)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const { systemPrompt, userMessage, temperature } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const controller = createAbortController(DEFAULT_TIMEOUT_MS);
  const stopWatching = abortOnDisconnect(req, res, controller);

  try {
    for await (const chunk of streamRefinement({
      systemPrompt,
      userMessage,
      temperature,
      signal: controller.signal,
    })) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    if (!res.destroyed && !res.writableEnded) {
      const { message } = classifyError(err);
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    }
  } finally {
    stopWatching();
    controller.abort();
  }
  if (!res.destroyed && !res.writableEnded) res.end();
});

refineRouter.post('/refine/complete', async (req, res) => {
  if (!validateRefineBody(req.body)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const { systemPrompt, userMessage, temperature } = req.body;
  const controller = createAbortController(DEFAULT_TIMEOUT_MS);
  const stopWatching = abortOnDisconnect(req, res, controller);

  try {
    const text = await refineComplete({ systemPrompt, userMessage, temperature, signal: controller.signal });
    res.json({ text });
  } catch (err) {
    if (!res.destroyed && !res.writableEnded) {
      const { status, message } = classifyError(err);
      res.status(status).json({ error: message });
    }
  } finally {
    stopWatching();
    controller.abort();
  }
});

refineRouter.post('/variants', async (req, res) => {
  if (!validateVariantsBody(req.body)) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const { systemPrompt, userMessage, temperatures } = req.body;
  const controllers: AbortController[] = [];
  const disconnectController = new AbortController();
  const stopWatching = abortOnDisconnect(req, res, disconnectController);
  disconnectController.signal.addEventListener(
    'abort',
    () => controllers.forEach((controller) => controller.abort()),
    { once: true },
  );

  try {
    // Sequential generation to avoid tripling rate-limit exposure
    const results: Array<{ label: string; temperature: number; text: string }> = [];
    for (const { label, temperature } of temperatures) {
      const controller = createAbortController(DEFAULT_TIMEOUT_MS);
      controllers.push(controller);
      const text = await refineComplete({
        systemPrompt,
        userMessage,
        temperature,
        signal: controller.signal,
      });
      results.push({ label, temperature, text });
    }
    res.json({ variants: results });
  } catch (err) {
    controllers.forEach((c) => c.abort());
    if (!res.destroyed && !res.writableEnded) {
      const { status, message } = classifyError(err);
      res.status(status).json({ error: message });
    }
  } finally {
    stopWatching();
    disconnectController.abort();
    controllers.forEach((controller) => controller.abort());
  }
});
