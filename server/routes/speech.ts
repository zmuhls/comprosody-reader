import { once } from 'node:events';
import { Router, type Request, type Response } from 'express';

const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io';
const ELEVENLABS_TTS_MODEL = 'eleven_multilingual_v2';
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

export const DEFAULT_VOICE_PAGE_SIZE = 100;
export const MAX_VOICE_PAGE_SIZE = 100;
export const MAX_SPEECH_TEXT_CHARACTERS = 10_000;
export const MIN_SPEECH_SPEED = 0.7;
export const MAX_SPEECH_SPEED = 1.2;

type FetchImplementation = typeof globalThis.fetch;

interface SpeechHandlerOptions {
  fetchImpl?: FetchImplementation;
  getApiKey?: () => string | undefined;
}

interface NormalizedVoice {
  id: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  description: string | null;
  previewUrl: string | null;
}

interface VoiceListResponse {
  voices: NormalizedVoice[];
  hasMore: boolean;
  nextPageToken: string | null;
}

class SpeechHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpeechHttpError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parsePageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_VOICE_PAGE_SIZE;
  if (typeof value !== 'string' || !/^\d{1,3}$/u.test(value)) {
    throw new SpeechHttpError(
      400,
      `pageSize must be an integer from 1 to ${MAX_VOICE_PAGE_SIZE}`,
    );
  }

  const pageSize = Number(value);
  if (pageSize < 1 || pageSize > MAX_VOICE_PAGE_SIZE) {
    throw new SpeechHttpError(
      400,
      `pageSize must be an integer from 1 to ${MAX_VOICE_PAGE_SIZE}`,
    );
  }
  return pageSize;
}

function normalizeLabels(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function normalizeVoice(value: unknown): NormalizedVoice | undefined {
  if (
    !isRecord(value) ||
    typeof value.voice_id !== 'string' ||
    typeof value.name !== 'string'
  ) {
    return undefined;
  }

  return {
    id: value.voice_id,
    name: value.name,
    category: typeof value.category === 'string' ? value.category : null,
    labels: normalizeLabels(value.labels),
    description:
      typeof value.description === 'string' ? value.description : null,
    previewUrl:
      typeof value.preview_url === 'string' ? value.preview_url : null,
  };
}

function normalizeVoiceList(value: unknown): VoiceListResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.voices) ||
    typeof value.has_more !== 'boolean'
  ) {
    throw new SpeechHttpError(
      502,
      'ElevenLabs returned an invalid voice list',
    );
  }

  return {
    voices: value.voices
      .map(normalizeVoice)
      .filter((voice): voice is NormalizedVoice => voice !== undefined),
    hasMore: value.has_more,
    nextPageToken:
      typeof value.next_page_token === 'string'
        ? value.next_page_token
        : null,
  };
}

function requireApiKey(getApiKey: () => string | undefined): string {
  const apiKey = getApiKey()?.trim();
  if (!apiKey) {
    throw new SpeechHttpError(
      503,
      'ELEVENLABS_API_KEY is required for ElevenLabs read-aloud',
    );
  }
  return apiKey;
}

function parseSynthesisBody(body: unknown): {
  voiceId: string;
  text: string;
  speed: number;
} {
  if (!isRecord(body)) {
    throw new SpeechHttpError(400, 'Invalid speech request body');
  }

  const { voiceId, text } = body;
  const speed = body.speed === undefined ? 1 : body.speed;

  if (
    typeof voiceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(voiceId)
  ) {
    throw new SpeechHttpError(400, 'Invalid ElevenLabs voice ID');
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new SpeechHttpError(400, 'Speech text must not be empty');
  }

  if (Array.from(text).length > MAX_SPEECH_TEXT_CHARACTERS) {
    throw new SpeechHttpError(
      400,
      `Speech text must not exceed ${MAX_SPEECH_TEXT_CHARACTERS} characters`,
    );
  }

  if (
    typeof speed !== 'number' ||
    !Number.isFinite(speed) ||
    speed < MIN_SPEECH_SPEED ||
    speed > MAX_SPEECH_SPEED
  ) {
    throw new SpeechHttpError(
      400,
      `Speech speed must be from ${MIN_SPEECH_SPEED} to ${MAX_SPEECH_SPEED}`,
    );
  }

  return { voiceId, text, speed };
}

function respondWithError(res: Response, error: unknown): void {
  const status = error instanceof SpeechHttpError ? error.status : 500;
  const message =
    error instanceof SpeechHttpError
      ? error.message
      : 'ElevenLabs read-aloud request failed';
  res.status(status).json({ error: message });
}

async function writeAudioResponse(
  upstream: globalThis.Response,
  res: Response,
): Promise<void> {
  if (!upstream.body) {
    throw new SpeechHttpError(502, 'ElevenLabs returned an empty audio stream');
  }

  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength && /^\d+$/u.test(contentLength)) {
    res.setHeader('Content-Length', contentLength);
  }

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await once(res, 'drain');
      }
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

export function createSpeechHandlers(options: SpeechHandlerOptions = {}): {
  listVoices: (req: Request, res: Response) => Promise<void>;
  synthesize: (req: Request, res: Response) => Promise<void>;
} {
  const fetchImpl =
    options.fetchImpl ??
    ((
      input: Parameters<FetchImplementation>[0],
      init?: Parameters<FetchImplementation>[1],
    ) => globalThis.fetch(input, init));
  const getApiKey =
    options.getApiKey ?? (() => process.env.ELEVENLABS_API_KEY);

  return {
    async listVoices(req: Request, res: Response): Promise<void> {
      try {
        const apiKey = requireApiKey(getApiKey);
        const pageSize = parsePageSize(
          req.query.pageSize ?? req.query.page_size,
        );
        const search = queryString(req.query.search)?.trim();
        const nextPageToken = queryString(
          req.query.nextPageToken ?? req.query.next_page_token,
        );
        const url = new URL('/v2/voices', ELEVENLABS_API_BASE_URL);

        url.searchParams.set('page_size', String(pageSize));
        if (search) url.searchParams.set('search', search);
        if (nextPageToken) {
          url.searchParams.set('next_page_token', nextPageToken);
        }

        let upstream: globalThis.Response;
        try {
          upstream = await fetchImpl(url, {
            headers: { 'xi-api-key': apiKey },
          });
        } catch {
          throw new SpeechHttpError(
            502,
            'Could not reach ElevenLabs voice service',
          );
        }

        if (!upstream.ok) {
          throw new SpeechHttpError(
            502,
            `ElevenLabs voice service failed (${upstream.status})`,
          );
        }

        const body: unknown = await upstream.json().catch(() => undefined);
        res.json(normalizeVoiceList(body));
      } catch (error) {
        respondWithError(res, error);
      }
    },

    async synthesize(req: Request, res: Response): Promise<void> {
      try {
        const apiKey = requireApiKey(getApiKey);
        const { voiceId, text, speed } = parseSynthesisBody(req.body);
        const url = new URL(
          `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
          ELEVENLABS_API_BASE_URL,
        );
        url.searchParams.set('output_format', ELEVENLABS_OUTPUT_FORMAT);

        const controller = new AbortController();
        const abort = () => controller.abort();
        req.once('aborted', abort);
        res.once('close', abort);

        let upstream: globalThis.Response;
        try {
          upstream = await fetchImpl(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey,
            },
            body: JSON.stringify({
              text,
              model_id: ELEVENLABS_TTS_MODEL,
              voice_settings: { speed },
            }),
            signal: controller.signal,
          });
        } catch {
          if (controller.signal.aborted) return;
          throw new SpeechHttpError(
            502,
            'Could not reach ElevenLabs text-to-speech service',
          );
        }

        if (!upstream.ok) {
          throw new SpeechHttpError(
            502,
            `ElevenLabs text-to-speech failed (${upstream.status})`,
          );
        }

        await writeAudioResponse(upstream, res);
      } catch (error) {
        if (!res.headersSent) {
          respondWithError(res, error);
        } else if (!res.writableEnded) {
          res.destroy(
            error instanceof Error ? error : new Error('Audio stream failed'),
          );
        }
      }
    },
  };
}

export const speechRouter = Router();
const speechHandlers = createSpeechHandlers();

speechRouter.get('/speech/voices', speechHandlers.listVoices);
speechRouter.post('/speech/synthesize', speechHandlers.synthesize);
