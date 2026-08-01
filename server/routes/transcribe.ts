import { Router } from 'express';
import { transcribe, audioFormatFromContentType } from '../lib/transcribe.js';
import { optHeaderStringArray } from '../lib/validate.js';

export const transcribeRouter = Router();

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// Node's default max header size is 16 KB across all headers; stay well under.
const MAX_LEXICON_HEADER_CHARS = 4096;
const MAX_LEXICON_TERMS = 200;
const MAX_LEXICON_TERM_LEN = 64;

transcribeRouter.post('/transcribe', async (req, res) => {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    res.status(413).json({ error: 'Audio exceeds 25 MB limit' });
    return;
  }

  // Checked before the body is streamed so an oversized hint fails fast.
  const lexiconHeader = req.headers['x-lexicon'];
  if (
    typeof lexiconHeader === 'string' &&
    lexiconHeader.length > MAX_LEXICON_HEADER_CHARS
  ) {
    res.status(400).json({ error: 'Lexicon hint exceeds 4 KB' });
    return;
  }
  const vocabulary = optHeaderStringArray(
    lexiconHeader,
    MAX_LEXICON_TERMS,
    MAX_LEXICON_TERM_LEN
  );

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
  const result = await transcribe(audioBuffer, format, vocabulary);

  res.json(result);
});
