import { Router } from 'express';
import { streamRefinement, refineComplete } from '../lib/claude.js';
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

function parseRefineBody(raw: unknown): RefineBody {
  const body = reqObject(raw);
  return {
    systemPrompt: reqString(body, 'systemPrompt', 50_000),
    userMessage: reqString(body, 'userMessage', 200_000),
    temperature: reqNumber(body, 'temperature', 0, 2),
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
      temperature: reqNumber(entry, 'temperature', 0, 2),
    };
  });
  return { systemPrompt, userMessage, temperatures };
}

refineRouter.post('/refine', async (req, res) => {
  const { systemPrompt, userMessage, temperature } = parseRefineBody(req.body);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const upstream = new AbortController();
  res.on('close', () => upstream.abort());

  let chunks = 0;
  try {
    for await (const chunk of streamRefinement({
      systemPrompt,
      userMessage,
      temperature,
      signal: upstream.signal,
    })) {
      chunks += 1;
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    if (chunks === 0) {
      res.write(`data: ${JSON.stringify({ error: 'model returned an empty refinement' })}\n\n`);
    } else {
      res.write('data: [DONE]\n\n');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refinement failed';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  }
  res.end();
});

refineRouter.post('/variants', async (req, res) => {
  const { systemPrompt, userMessage, temperatures } = parseVariantsBody(req.body);

  const settled = await Promise.allSettled(
    temperatures.map(({ label, temperature }) =>
      refineComplete({ systemPrompt, userMessage, temperature }).then((text) => ({
        label,
        temperature,
        text,
      }))
    )
  );

  const variants = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []
  );
  const errors = settled.flatMap((result, i) =>
    result.status === 'rejected'
      ? [
          {
            label: temperatures[i].label,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          },
        ]
      : []
  );

  if (variants.length === 0) {
    res.status(502).json({ error: errors[0]?.error ?? 'All variant generations failed' });
    return;
  }
  res.json({ variants, errors });
});
