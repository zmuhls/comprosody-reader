import { Router } from 'express';
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

refineRouter.post('/refine', async (req, res) => {
  const { systemPrompt, userMessage, temperature } = req.body as RefineBody;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const chunk of streamRefinement({
      systemPrompt,
      userMessage,
      temperature,
    })) {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refinement failed';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
  }
  res.end();
});

refineRouter.post('/refine/complete', async (req, res) => {
  const { systemPrompt, userMessage, temperature } = req.body as RefineBody;

  try {
    const text = await refineComplete({ systemPrompt, userMessage, temperature });
    res.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refinement failed';
    res.status(500).json({ error: message });
  }
});

refineRouter.post('/variants', async (req, res) => {
  const { systemPrompt, userMessage, temperatures } = req.body as VariantsBody;

  try {
    const results = await Promise.all(
      temperatures.map(async ({ label, temperature }) => {
        const text = await refineComplete({
          systemPrompt,
          userMessage,
          temperature,
        });
        return { label, temperature, text };
      })
    );
    res.json({ variants: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refinement failed';
    res.status(500).json({ error: message });
  }
});
