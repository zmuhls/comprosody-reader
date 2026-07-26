import { Router } from 'express';
import { transcribe, audioFormatFromContentType } from '../lib/transcribe.js';

export const transcribeRouter = Router();

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

transcribeRouter.post('/transcribe', async (req, res) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    res.status(413).json({ error: 'Audio exceeds 25 MB limit' });
    return;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_AUDIO_BYTES) {
      res.status(413).json({ error: 'Audio exceeds 25 MB limit' });
      req.destroy();
      return;
    }
    chunks.push(chunk as Buffer);
  }
  const audioBuffer = Buffer.concat(chunks);

  if (audioBuffer.length === 0) {
    res.status(400).json({ error: 'No audio data received' });
    return;
  }

  const format = audioFormatFromContentType(req.headers['content-type']);
  const result = await transcribe(audioBuffer, format);

  res.json(result);
});
