import { once } from 'node:events';
import { Router, type Request, type Response } from 'express';

const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io';
const ELEVENLABS_TTS_MODEL = 'eleven_multilingual_v2';
const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
const TIMED_SPEECH_INVALID_RESPONSE =
  'ElevenLabs returned an invalid timed speech response';

export const DEFAULT_VOICE_PAGE_SIZE = 100;
export const MAX_VOICE_PAGE_SIZE = 100;
export const MAX_SPEECH_TEXT_CHARACTERS = 10_000;
export const MAX_SPEECH_AUDIO_BYTES = 25 * 1024 * 1024;
export const DEFAULT_SPEECH_PROVIDER_TIMEOUT_MS = 45_000;
export const MIN_SPEECH_SPEED = 0.7;
export const MAX_SPEECH_SPEED = 1.2;

type FetchImplementation = typeof globalThis.fetch;

interface SpeechHandlerOptions {
  fetchImpl?: FetchImplementation;
  getApiKey?: () => string | undefined;
  providerTimeoutMs?: number;
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

interface TimedSpeechAlignment {
  characters: string[];
  startTimesSeconds: number[];
  endTimesSeconds: number[];
}

interface TimedSpeechResponse {
  schemaVersion: 1;
  mediaType: 'audio/mpeg';
  audioBase64: string;
  alignment: TimedSpeechAlignment;
  normalizedAlignment: TimedSpeechAlignment | null;
}

class SpeechHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpeechHttpError';
    this.status = status;
  }
}

interface SpeechErrorContext {
  inputCharacters?: number;
  operation: 'synthesize' | 'synthesize_with_timestamps' | 'voices';
  phase: string;
  startedAt: number;
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

function invalidTimedSpeechResponse(): never {
  throw new SpeechHttpError(502, TIMED_SPEECH_INVALID_RESPONSE);
}

function normalizeAlignment(
  value: unknown,
  expectedText?: string,
): TimedSpeechAlignment {
  if (
    !isRecord(value) ||
    !Array.isArray(value.characters) ||
    !Array.isArray(value.character_start_times_seconds) ||
    !Array.isArray(value.character_end_times_seconds)
  ) {
    return invalidTimedSpeechResponse();
  }

  const characters = value.characters;
  const startTimesSeconds = value.character_start_times_seconds;
  const endTimesSeconds = value.character_end_times_seconds;
  if (
    characters.length === 0 ||
    characters.length > MAX_SPEECH_TEXT_CHARACTERS ||
    startTimesSeconds.length !== characters.length ||
    endTimesSeconds.length !== characters.length ||
    characters.some(
      (character) => typeof character !== 'string' || character.length === 0,
    ) ||
    (expectedText !== undefined && characters.join('') !== expectedText)
  ) {
    return invalidTimedSpeechResponse();
  }

  for (let index = 0; index < characters.length; index += 1) {
    const start = startTimesSeconds[index];
    const end = endTimesSeconds[index];
    if (
      typeof start !== 'number' ||
      !Number.isFinite(start) ||
      start < 0 ||
      typeof end !== 'number' ||
      !Number.isFinite(end) ||
      end < start ||
      (index > 0 && start < (startTimesSeconds[index - 1] as number)) ||
      (index > 0 && end < (endTimesSeconds[index - 1] as number))
    ) {
      return invalidTimedSpeechResponse();
    }
  }

  return {
    characters: [...characters] as string[],
    startTimesSeconds: [...startTimesSeconds] as number[],
    endTimesSeconds: [...endTimesSeconds] as number[],
  };
}

function normalizeAudioBase64(value: unknown): string {
  const maximumBase64Length = Math.ceil(MAX_SPEECH_AUDIO_BYTES / 3) * 4;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumBase64Length ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return invalidTimedSpeechResponse();
  }

  const audio = Buffer.from(value, 'base64');
  if (
    audio.byteLength === 0 ||
    audio.byteLength > MAX_SPEECH_AUDIO_BYTES ||
    audio.toString('base64') !== value
  ) {
    return invalidTimedSpeechResponse();
  }
  return value;
}

function normalizeTimedSpeechResponse(
  value: unknown,
  expectedText: string,
): TimedSpeechResponse {
  if (!isRecord(value)) return invalidTimedSpeechResponse();
  return {
    schemaVersion: 1,
    mediaType: 'audio/mpeg',
    audioBase64: normalizeAudioBase64(value.audio_base64),
    alignment: normalizeAlignment(value.alignment, expectedText),
    normalizedAlignment:
      value.normalized_alignment === null ||
      value.normalized_alignment === undefined
        ? null
        : normalizeAlignment(value.normalized_alignment),
  };
}

function diagnosticCode(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(value)
    ? value
    : null;
}

function logUnexpectedSpeechError(
  error: unknown,
  context: SpeechErrorContext,
): void {
  if (error instanceof SpeechHttpError) return;
  const candidate = error as {
    cause?: { code?: unknown; name?: unknown };
    code?: unknown;
    name?: unknown;
  };
  console.error('[speech-route-error]', JSON.stringify({
    event: 'speech_route_error',
    operation: context.operation,
    phase: context.phase,
    durationMs: Math.max(0, Date.now() - context.startedAt),
    inputCharacters: context.inputCharacters,
    errorClass: diagnosticCode(candidate?.name) || typeof error,
    errorCode: diagnosticCode(candidate?.code),
    causeClass: diagnosticCode(candidate?.cause?.name),
    causeCode: diagnosticCode(candidate?.cause?.code),
  }));
}

function respondWithError(
  res: Response,
  error: unknown,
  context: SpeechErrorContext,
): void {
  logUnexpectedSpeechError(error, context);
  const status = error instanceof SpeechHttpError ? error.status : 500;
  const message =
    error instanceof SpeechHttpError
      ? error.message
      : 'ElevenLabs read-aloud request failed';
  res.status(status).json({ error: message });
}

function providerAbortReason(
  error: unknown,
  signal: AbortSignal | undefined,
): unknown {
  return signal?.aborted && signal.reason instanceof SpeechHttpError
    ? signal.reason
    : error;
}

function synthesisRequest(
  apiKey: string,
  text: string,
  speed: number,
  signal: AbortSignal,
): RequestInit {
  return {
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
    signal,
  };
}

function synthesisUrl(voiceId: string, suffix = ''): URL {
  const url = new URL(
    `/v1/text-to-speech/${encodeURIComponent(voiceId)}${suffix}`,
    ELEVENLABS_API_BASE_URL,
  );
  url.searchParams.set('output_format', ELEVENLABS_OUTPUT_FORMAT);
  return url;
}

function requestAbortController(
  req: Request,
  res: Response,
  timeoutMs: number,
  serviceName: string,
): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new SpeechHttpError(504, `ElevenLabs ${serviceName} timed out`),
    );
  }, timeoutMs);
  timer.unref?.();
  const cleanup = () => clearTimeout(timer);
  const abort = () => {
    cleanup();
    controller.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);
  res.once('finish', cleanup);
  return controller;
}

async function fetchSpeech(
  fetchImpl: FetchImplementation,
  url: URL,
  init: RequestInit,
  signal: AbortSignal,
  serviceName: string,
): Promise<globalThis.Response | undefined> {
  try {
    return await fetchImpl(url, init);
  } catch {
    if (signal.aborted) {
      if (signal.reason instanceof SpeechHttpError) throw signal.reason;
      return undefined;
    }
    throw new SpeechHttpError(502, `Could not reach ElevenLabs ${serviceName}`);
  }
}

async function writeAudioResponse(
  upstream: globalThis.Response,
  res: Response,
): Promise<void> {
  if (!upstream.body) {
    throw new SpeechHttpError(502, 'ElevenLabs returned an empty audio stream');
  }

  const contentLength = upstream.headers.get('content-length');
  if (contentLength && /^\d+$/u.test(contentLength)) {
    if (BigInt(contentLength) > BigInt(MAX_SPEECH_AUDIO_BYTES)) {
      throw new SpeechHttpError(
        502,
        'ElevenLabs returned an oversized audio stream',
      );
    }
  }

  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  if (contentLength && /^\d+$/u.test(contentLength)) {
    res.setHeader('Content-Length', contentLength);
  }

  const reader = upstream.body.getReader();
  let receivedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_SPEECH_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new SpeechHttpError(
          502,
          'ElevenLabs returned an oversized audio stream',
        );
      }
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
  synthesizeWithTimestamps: (req: Request, res: Response) => Promise<void>;
} {
  const fetchImpl =
    options.fetchImpl ??
    ((
      input: Parameters<FetchImplementation>[0],
      init?: Parameters<FetchImplementation>[1],
    ) => globalThis.fetch(input, init));
  const getApiKey =
    options.getApiKey ?? (() => process.env.ELEVENLABS_API_KEY);
  const providerTimeoutMs = Number.isFinite(options.providerTimeoutMs)
    && Number(options.providerTimeoutMs) > 0
    ? Number(options.providerTimeoutMs)
    : DEFAULT_SPEECH_PROVIDER_TIMEOUT_MS;

  return {
    async listVoices(req: Request, res: Response): Promise<void> {
      const context: SpeechErrorContext = {
        operation: 'voices',
        phase: 'input',
        startedAt: Date.now(),
      };
      let controller: AbortController | undefined;
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

        context.phase = 'provider_fetch';
        controller = requestAbortController(
          req,
          res,
          providerTimeoutMs,
          'voice service',
        );
        const upstream = await fetchSpeech(
          fetchImpl,
          url,
          {
            headers: { 'xi-api-key': apiKey },
            signal: controller.signal,
          },
          controller.signal,
          'voice service',
        );
        if (!upstream) return;
        if (!upstream.ok) {
          throw new SpeechHttpError(
            502,
            `ElevenLabs voice service failed (${upstream.status})`,
          );
        }

        context.phase = 'provider_parse';
        const body: unknown = await upstream.json().catch(() => undefined);
        context.phase = 'response_send';
        res.json(normalizeVoiceList(body));
      } catch (error) {
        respondWithError(
          res,
          providerAbortReason(error, controller?.signal),
          context,
        );
      }
    },

    async synthesize(req: Request, res: Response): Promise<void> {
      const context: SpeechErrorContext = {
        operation: 'synthesize',
        phase: 'input',
        startedAt: Date.now(),
      };
      let controller: AbortController | undefined;
      try {
        const apiKey = requireApiKey(getApiKey);
        const { voiceId, text, speed } = parseSynthesisBody(req.body);
        context.inputCharacters = Array.from(text).length;
        controller = requestAbortController(
          req,
          res,
          providerTimeoutMs,
          'text-to-speech service',
        );
        context.phase = 'provider_fetch';
        const upstream = await fetchSpeech(
          fetchImpl,
          synthesisUrl(voiceId),
          synthesisRequest(apiKey, text, speed, controller.signal),
          controller.signal,
          'text-to-speech service',
        );
        if (!upstream) return;
        if (!upstream.ok) {
          throw new SpeechHttpError(
            502,
            `ElevenLabs text-to-speech failed (${upstream.status})`,
          );
        }
        context.phase = 'response_stream';
        await writeAudioResponse(upstream, res);
      } catch (error) {
        if (!res.headersSent) {
          respondWithError(
            res,
            providerAbortReason(error, controller?.signal),
            context,
          );
        } else if (!res.writableEnded) {
          res.destroy(
            error instanceof Error ? error : new Error('Audio stream failed'),
          );
        }
      }
    },

    async synthesizeWithTimestamps(
      req: Request,
      res: Response,
    ): Promise<void> {
      const context: SpeechErrorContext = {
        operation: 'synthesize_with_timestamps',
        phase: 'input',
        startedAt: Date.now(),
      };
      let controller: AbortController | undefined;
      try {
        const apiKey = requireApiKey(getApiKey);
        const { voiceId, text, speed } = parseSynthesisBody(req.body);
        context.inputCharacters = Array.from(text).length;
        controller = requestAbortController(
          req,
          res,
          providerTimeoutMs,
          'timed text-to-speech service',
        );
        context.phase = 'provider_fetch';
        const upstream = await fetchSpeech(
          fetchImpl,
          synthesisUrl(voiceId, '/with-timestamps'),
          synthesisRequest(apiKey, text, speed, controller.signal),
          controller.signal,
          'timed text-to-speech service',
        );
        if (!upstream) return;
        if (!upstream.ok) {
          throw new SpeechHttpError(
            502,
            `ElevenLabs timed text-to-speech failed (${upstream.status})`,
          );
        }

        context.phase = 'provider_parse';
        const body: unknown = await upstream.json().catch(() => undefined);
        context.phase = 'response_validate';
        const response = normalizeTimedSpeechResponse(body, text);
        context.phase = 'response_send';
        res.status(200);
        res.setHeader('Cache-Control', 'no-store');
        res.json(response);
      } catch (error) {
        if (!res.headersSent) {
          respondWithError(
            res,
            providerAbortReason(error, controller?.signal),
            context,
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
speechRouter.post(
  '/speech/synthesize-with-timestamps',
  speechHandlers.synthesizeWithTimestamps,
);
