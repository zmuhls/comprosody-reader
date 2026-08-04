import { Router, type Request, type Response } from 'express';
import {
  OllamaRefinementError,
  streamRefinement,
  refineComplete,
} from '../lib/ollama.js';
import { HttpError, reqNumber, reqObject, reqString } from '../lib/validate.js';

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

function parseRefineBody(raw: unknown): RefineBody {
  const body = reqObject(raw);
  return {
    systemPrompt: reqString(body, 'systemPrompt', 50_000),
    userMessage: reqString(body, 'userMessage', 200_000),
    temperature: reqNumber(body, 'temperature', 0, 1),
  };
}

function parseVariantsBody(raw: unknown): VariantsBody {
  const body = reqObject(raw);
  const systemPrompt = reqString(body, 'systemPrompt', 50_000);
  const userMessage = reqString(body, 'userMessage', 200_000);
  const items = body.temperatures;
  if (!Array.isArray(items) || items.length < 1 || items.length > 5) {
    throw new HttpError(400, 'temperatures must be an array of 1 to 5 items');
  }
  const temperatures = items.map((item) => {
    const entry = reqObject(item, 'each temperatures item must be an object');
    return {
      label: reqString(entry, 'label', 32),
      temperature: reqNumber(entry, 'temperature', 0, 1),
    };
  });
  return { systemPrompt, userMessage, temperatures };
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
  if (err instanceof OllamaRefinementError) {
    return { status: err.status, message: err.message };
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
  const { systemPrompt, userMessage, temperature } = parseRefineBody(req.body);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = createAbortController(DEFAULT_TIMEOUT_MS);
  const stopWatching = abortOnDisconnect(req, res, controller);
  let chunks = 0;

  try {
    for await (const chunk of streamRefinement({
      systemPrompt,
      userMessage,
      temperature,
      signal: controller.signal,
    })) {
      chunks += 1;
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    if (chunks === 0) {
      res.write(`data: ${JSON.stringify({ error: 'Model returned an empty refinement' })}\n\n`);
    } else {
      res.write('data: [DONE]\n\n');
    }
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
  const { systemPrompt, userMessage, temperature } = parseRefineBody(req.body);
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
  const { systemPrompt, userMessage, temperatures } = parseVariantsBody(req.body);
  const controllers: AbortController[] = [];
  const disconnectController = new AbortController();
  const stopWatching = abortOnDisconnect(req, res, disconnectController);
  disconnectController.signal.addEventListener(
    'abort',
    () => controllers.forEach((controller) => controller.abort()),
    { once: true },
  );

  try {
    // Sequential generation bounds provider pressure while still returning any
    // successful alternatives when one temperature fails.
    const results: Array<{ label: string; temperature: number; text: string }> = [];
    const errors: Array<{ label: string; error: string }> = [];
    for (const { label, temperature } of temperatures) {
      const controller = createAbortController(DEFAULT_TIMEOUT_MS);
      controllers.push(controller);
      try {
        const text = await refineComplete({
          systemPrompt,
          userMessage,
          temperature,
          signal: controller.signal,
        });
        results.push({ label, temperature, text });
      } catch (error) {
        errors.push({
          label,
          error: classifyError(error).message,
        });
      } finally {
        controller.abort();
      }
    }
    if (results.length === 0) {
      res.status(502).json({ error: errors[0]?.error ?? 'All variant generations failed' });
      return;
    }
    res.json({ variants: results, errors });
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
