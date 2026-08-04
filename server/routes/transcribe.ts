import { Router, type Request, type Response } from 'express';
import {
  TranscriptionConfigurationError,
  TranscriptionUpstreamError,
  UnsupportedTranscriptionModelError,
  UnsupportedTranscriptionProviderError,
  resolveTranscriptionProvider,
  transcribe,
} from '../lib/transcribe.js';
import {
  REALTIME_SCRIBE_TOKEN_TTL_SECONDS,
  elevenLabsRealtimeTokenClient,
  type RealtimeScribeTokenRequestOptions,
} from '../lib/transcription/elevenLabsScribeProvider.js';
import { optHeaderStringArray } from '../lib/validate.js';

export const transcribeRouter = Router();

const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 MB
// Node's aggregate header limit is larger, but vocabulary is only an optional
// hint. Keep each supported hint header well below that ceiling so it can be
// rejected before the audio body is accepted.
const MAX_KEYTERM_HEADER_CHARACTERS = 4096;
const MAX_LEXICON_HEADER_TERMS = 200;
const MAX_LEXICON_HEADER_TERM_CHARACTERS = 64;
export const MAX_TRANSCRIPTION_KEYTERMS = 100;
export const MAX_KEYTERM_CHARACTERS = 50;
export const MAX_KEYTERM_WORDS = 5;

const UNSUPPORTED_KEYTERM_CHARACTERS = new Set([
  '<',
  '>',
  '{',
  '}',
  '[',
  ']',
  '\\',
]);

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sanitizeKeyterm(value: string): string | undefined {
  const supportedCharacters = Array.from(value.normalize('NFKC'))
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
        return ' ';
      }
      return UNSUPPORTED_KEYTERM_CHARACTERS.has(character) ? '' : character;
    })
    .join('');
  const normalized = supportedCharacters.replace(/\s+/gu, ' ').trim();

  if (!normalized) return undefined;

  const wordBounded = normalized
    .split(' ')
    .slice(0, MAX_KEYTERM_WORDS)
    .join(' ');
  const characterBounded = Array.from(wordBounded)
    .slice(0, MAX_KEYTERM_CHARACTERS)
    .join('')
    .trim();

  return characterBounded || undefined;
}

export function parseTranscriptionKeyterms(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [value];
  const keyterms: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') continue;

    const keyterm = sanitizeKeyterm(rawValue);
    if (!keyterm) continue;

    const deduplicationKey = keyterm.toLocaleLowerCase('en-US');
    if (seen.has(deduplicationKey)) continue;

    seen.add(deduplicationKey);
    keyterms.push(keyterm);
    if (keyterms.length === MAX_TRANSCRIPTION_KEYTERMS) break;
  }

  return keyterms;
}

export function parseTranscriptionKeytermHeader(value: string | undefined): unknown[] {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function transcriptionErrorStatus(error: unknown): number {
  if (
    error instanceof UnsupportedTranscriptionProviderError ||
    error instanceof UnsupportedTranscriptionModelError
  ) {
    return 400;
  }
  if (error instanceof TranscriptionConfigurationError) return 503;
  if (error instanceof TranscriptionUpstreamError) {
    return error.status === 504 ? 504 : 502;
  }
  return 500;
}

function transcriptionErrorMessage(error: unknown): string {
  if (
    error instanceof UnsupportedTranscriptionProviderError ||
    error instanceof UnsupportedTranscriptionModelError ||
    error instanceof TranscriptionConfigurationError ||
    error instanceof TranscriptionUpstreamError
  ) {
    return error.message;
  }
  return 'Transcription failed';
}

function realtimeTokenErrorStatus(error: unknown): number {
  if (error instanceof TranscriptionConfigurationError) return 503;
  if (error instanceof TranscriptionUpstreamError) {
    return error.status === 504 ? 504 : 502;
  }
  return 500;
}

export type CreateRealtimeScribeToken = (
  options?: RealtimeScribeTokenRequestOptions
) => Promise<string>;

export function createRealtimeTranscriptionTokenHandler(
  createToken: CreateRealtimeScribeToken = (options) =>
    elevenLabsRealtimeTokenClient.createToken(options)
) {
  return async function handleRealtimeTranscriptionToken(
    req: Request,
    res: Response
  ): Promise<void> {
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');

    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    const abortIfResponseClosed = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', abortRequest);
    res.once('close', abortIfResponseClosed);

    try {
      const token = await createToken({ signal: controller.signal });
      if (controller.signal.aborted || res.destroyed) return;

      res.json({
        token,
        expiresInSeconds: REALTIME_SCRIBE_TOKEN_TTL_SECONDS,
      });
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return;

      const message =
        error instanceof TranscriptionConfigurationError ||
        error instanceof TranscriptionUpstreamError
          ? error.message
          : 'Realtime transcription is unavailable';
      res.status(realtimeTokenErrorStatus(error)).json({ error: message });
    } finally {
      req.removeListener('aborted', abortRequest);
      res.removeListener('close', abortIfResponseClosed);
    }
  };
}

export const handleRealtimeTranscriptionToken =
  createRealtimeTranscriptionTokenHandler();

export async function handleTranscription(
  req: Request,
  res: Response
): Promise<void> {
  const declaredBytes = Number(req.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_AUDIO_BYTES) {
    res.status(413).json({ error: 'Audio exceeds 50 MB limit' });
    return;
  }

  const cadenceKeytermsHeader = req.get('x-cadence-keyterms');
  const lexiconHeader = req.get('x-lexicon');
  if (
    (cadenceKeytermsHeader?.length ?? 0) > MAX_KEYTERM_HEADER_CHARACTERS ||
    (lexiconHeader?.length ?? 0) > MAX_KEYTERM_HEADER_CHARACTERS
  ) {
    res.status(400).json({ error: 'Vocabulary hint exceeds 4 KB' });
    return;
  }

  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  const abortIfResponseClosed = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', abortRequest);
  res.once('close', abortIfResponseClosed);

  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_AUDIO_BYTES) {
        controller.abort();
        res.status(413).json({ error: 'Audio exceeds 50 MB limit' });
        // Once the response has flushed, close a chunked upload that ignored
        // the limit instead of continuing to buffer or transcribe it.
        res.once('finish', () => {
          if (!req.complete) req.destroy();
        });
        return;
      }
      chunks.push(chunk as Buffer);
    }

    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      res.status(400).json({ error: 'No audio data received' });
      return;
    }

    const provider = resolveTranscriptionProvider(queryString(req.query.provider));
    const requestedModel = queryString(req.query.model);
    const keyterms = parseTranscriptionKeyterms([
      ...parseTranscriptionKeytermHeader(cadenceKeytermsHeader),
      ...optHeaderStringArray(
        lexiconHeader,
        MAX_LEXICON_HEADER_TERMS,
        MAX_LEXICON_HEADER_TERM_CHARACTERS
      ),
      ...(Array.isArray(req.query.keyterm)
        ? req.query.keyterm
        : [req.query.keyterm]),
    ]);
    const result = await transcribe(audioBuffer, {
      provider,
      model: requestedModel,
      contentType: req.get('content-type'),
      keyterms,
      signal: controller.signal,
    });
    if (controller.signal.aborted || res.destroyed) return;
    res.json(result);
  } catch (err) {
    if (controller.signal.aborted || res.destroyed) return;
    res
      .status(transcriptionErrorStatus(err))
      .json({ error: transcriptionErrorMessage(err) });
  } finally {
    req.removeListener('aborted', abortRequest);
    res.removeListener('close', abortIfResponseClosed);
  }
}

transcribeRouter.post(
  '/transcribe/realtime-token',
  handleRealtimeTranscriptionToken
);
transcribeRouter.post('/transcribe', handleTranscription);
