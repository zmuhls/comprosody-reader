import { Router } from 'express';
import { transcribe } from '../lib/transcribe.js';

export const transcribeRouter = Router();

const ALLOWED_MODELS = new Set(['tiny', 'base', 'small', 'medium', 'large-v1', 'large-v2', 'large-v3']);
const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB

transcribeRouter.post('/transcribe', async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AUDIO_BYTES) {
        res.status(413).json({ error: 'Audio file too large' });
        return;
      }
      chunks.push(chunk as Buffer);
    }

    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      res.status(400).json({ error: 'No audio data received' });
      return;
    }

    const requestedModel = (req.query.model as string) || 'base';
    if (!ALLOWED_MODELS.has(requestedModel)) {
      res.status(400).json({ error: `Invalid model size: ${requestedModel}` });
      return;
    }

    const result = await transcribe(audioBuffer, requestedModel);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed';
    res.status(500).json({ error: message });
  }
});
