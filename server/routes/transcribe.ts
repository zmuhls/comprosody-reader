import { Router } from 'express';
import { transcribe } from '../lib/transcribe.js';

export const transcribeRouter = Router();

transcribeRouter.post('/transcribe', async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      res.status(400).json({ error: 'No audio data received' });
      return;
    }

    const modelSize = (req.query.model as string) || 'base';
    const result = await transcribe(audioBuffer, modelSize);

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed';
    res.status(500).json({ error: message });
  }
});
