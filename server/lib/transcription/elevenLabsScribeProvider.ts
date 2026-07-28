import {
  TranscriptionConfigurationError,
  TranscriptionUpstreamError,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
} from './types.js';

const ELEVENLABS_SPEECH_TO_TEXT_URL =
  'https://api.elevenlabs.io/v1/speech-to-text';
const ELEVENLABS_REALTIME_SCRIBE_TOKEN_URL =
  'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';
const DEFAULT_ELEVENLABS_SCRIBE_MODEL = 'scribe_v2';
const DEFAULT_REALTIME_TOKEN_TIMEOUT_MS = 10_000;
const MAX_REALTIME_TOKEN_CHARACTERS = 8_192;
export const REALTIME_SCRIBE_TOKEN_TTL_SECONDS = 15 * 60;

type FetchImplementation = typeof globalThis.fetch;

interface ElevenLabsScribeProviderOptions {
  fetchImpl?: FetchImplementation;
  getApiKey?: () => string | undefined;
  getDefaultModel?: () => string | undefined;
}

interface ElevenLabsRealtimeTokenClientOptions {
  fetchImpl?: FetchImplementation;
  getApiKey?: () => string | undefined;
  timeoutMs?: number;
}

export interface RealtimeScribeTokenRequestOptions {
  signal?: AbortSignal;
}

export interface ElevenLabsRealtimeTokenClient {
  createToken(options?: RealtimeScribeTokenRequestOptions): Promise<string>;
}

interface ElevenLabsWord {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  type?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function upstreamErrorDetail(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;

  if (typeof body.message === 'string') return body.message;
  if (typeof body.error === 'string') return body.error;
  if (typeof body.detail === 'string') return body.detail;
  if (isRecord(body.detail) && typeof body.detail.message === 'string') {
    return body.detail.message;
  }

  return undefined;
}

function mediaMetadata(contentType?: string): { contentType: string; extension: string } {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const mediaTypes: Record<string, string> = {
    'audio/aac': 'aac',
    'audio/aiff': 'aiff',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mpeg3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/x-aac': 'aac',
    'audio/x-aiff': 'aiff',
    'audio/x-flac': 'flac',
    'audio/x-m4a': 'm4a',
    'audio/x-mpeg-3': 'mp3',
    'audio/x-wav': 'wav',
    'video/3gpp': '3gp',
    'video/mpeg': 'mpeg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-flv': 'flv',
    'video/x-matroska': 'mkv',
    'video/x-msvideo': 'avi',
    'video/x-ms-wmv': 'wmv',
  };

  if (normalized && mediaTypes[normalized]) {
    return { contentType: normalized, extension: mediaTypes[normalized] };
  }

  // The browser client currently sends MediaRecorder WebM as octet-stream.
  return { contentType: 'audio/webm', extension: 'webm' };
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeResponse(body: unknown): TranscriptionResult {
  if (!isRecord(body) || typeof body.text !== 'string' || !Array.isArray(body.words)) {
    throw new TranscriptionUpstreamError(
      502,
      'ElevenLabs returned an invalid transcription response'
    );
  }

  const timedItems = (body.words as ElevenLabsWord[]).filter(
    (item) =>
      isRecord(item) &&
      typeof item.start === 'number' &&
      Number.isFinite(item.start) &&
      typeof item.end === 'number' &&
      Number.isFinite(item.end)
  );

  const words = timedItems
    .filter((item) => item.type === 'word')
    .map((item) => ({
      word: String(item.text ?? '').trim(),
      start: roundMilliseconds(item.start as number),
      end: roundMilliseconds(item.end as number),
    }))
    .filter((item) => item.word.length > 0);

  const duration = timedItems.reduce(
    (maximum, item) => Math.max(maximum, item.end as number),
    0
  );

  return {
    transcript: body.text,
    words,
    language:
      typeof body.language_code === 'string' ? body.language_code : 'unknown',
    duration: roundMilliseconds(duration),
  };
}

function normalizeRealtimeScribeToken(body: unknown): string {
  if (!isRecord(body) || typeof body.token !== 'string') {
    throw new TranscriptionUpstreamError(
      502,
      'ElevenLabs returned an invalid realtime transcription token'
    );
  }

  const token = body.token;
  const isPrintableWithoutWhitespace = /^[\x21-\x7e]+$/u.test(token);
  if (
    token.length < 16 ||
    token.length > MAX_REALTIME_TOKEN_CHARACTERS ||
    !isPrintableWithoutWhitespace
  ) {
    throw new TranscriptionUpstreamError(
      502,
      'ElevenLabs returned an invalid realtime transcription token'
    );
  }

  return token;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_REALTIME_TOKEN_TIMEOUT_MS;
  return Math.max(1, Math.min(Math.floor(value as number), 30_000));
}

export function createElevenLabsRealtimeTokenClient(
  options: ElevenLabsRealtimeTokenClientOptions = {}
): ElevenLabsRealtimeTokenClient {
  const fetchImpl =
    options.fetchImpl ??
    ((input: Parameters<FetchImplementation>[0], init?: Parameters<FetchImplementation>[1]) =>
      globalThis.fetch(input, init));
  const getApiKey = options.getApiKey ?? (() => process.env.ELEVENLABS_API_KEY);
  const timeoutMs = boundedTimeout(options.timeoutMs);

  return {
    async createToken(
      requestOptions: RealtimeScribeTokenRequestOptions = {}
    ): Promise<string> {
      const apiKey = getApiKey()?.trim();
      if (!apiKey) {
        throw new TranscriptionConfigurationError(
          'ELEVENLABS_API_KEY is required for realtime transcription'
        );
      }

      const controller = new AbortController();
      let timedOut = false;
      const cancelFromCaller = () => controller.abort(requestOptions.signal?.reason);
      if (requestOptions.signal?.aborted) {
        cancelFromCaller();
      } else {
        requestOptions.signal?.addEventListener('abort', cancelFromCaller, {
          once: true,
        });
      }
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetchImpl(ELEVENLABS_REALTIME_SCRIBE_TOKEN_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'xi-api-key': apiKey,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new TranscriptionUpstreamError(
            response.status,
            `ElevenLabs realtime transcription token request failed (${response.status})`
          );
        }

        const body = await response.json().catch(() => undefined);
        return normalizeRealtimeScribeToken(body);
      } catch (error) {
        if (error instanceof TranscriptionUpstreamError) throw error;
        if (timedOut) {
          throw new TranscriptionUpstreamError(
            504,
            'ElevenLabs realtime transcription token service timed out'
          );
        }
        if (requestOptions.signal?.aborted) {
          throw new TranscriptionUpstreamError(
            499,
            'Realtime transcription token request was cancelled'
          );
        }
        throw new TranscriptionUpstreamError(
          502,
          'Could not reach ElevenLabs realtime transcription token service'
        );
      } finally {
        clearTimeout(timeout);
        requestOptions.signal?.removeEventListener('abort', cancelFromCaller);
      }
    },
  };
}

export function createElevenLabsScribeProvider(
  options: ElevenLabsScribeProviderOptions = {}
): TranscriptionProvider {
  const fetchImpl =
    options.fetchImpl ??
    ((input: Parameters<FetchImplementation>[0], init?: Parameters<FetchImplementation>[1]) =>
      globalThis.fetch(input, init));
  const getApiKey = options.getApiKey ?? (() => process.env.ELEVENLABS_API_KEY);
  const getDefaultModel =
    options.getDefaultModel ?? (() => process.env.ELEVENLABS_SCRIBE_MODEL);

  return {
    id: 'elevenlabs',
    async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
      const apiKey = getApiKey()?.trim();
      if (!apiKey) {
        throw new TranscriptionConfigurationError(
          'ELEVENLABS_API_KEY is required for the ElevenLabs transcription provider'
        );
      }

      const model =
        input.model?.trim() ||
        getDefaultModel()?.trim() ||
        DEFAULT_ELEVENLABS_SCRIBE_MODEL;
      const { contentType, extension } = mediaMetadata(input.contentType);
      const form = new FormData();
      const bytes = new Uint8Array(input.audioBuffer);

      form.append(
        'file',
        new Blob([bytes], { type: contentType }),
        `recording.${extension}`
      );
      form.append('model_id', model);
      form.append('timestamps_granularity', 'word');
      form.append('no_verbatim', 'false');
      for (const keyterm of input.keyterms ?? []) {
        form.append('keyterms', keyterm);
      }

      let response: Response;
      try {
        response = await fetchImpl(ELEVENLABS_SPEECH_TO_TEXT_URL, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: form,
        });
      } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : '';
        throw new TranscriptionUpstreamError(
          502,
          `Could not reach ElevenLabs transcription service${detail}`
        );
      }

      const body = await response.json().catch(() => undefined);
      if (!response.ok) {
        const detail = upstreamErrorDetail(body);
        throw new TranscriptionUpstreamError(
          response.status,
          `ElevenLabs transcription failed (${response.status})${
            detail ? `: ${detail}` : ''
          }`
        );
      }

      return normalizeResponse(body);
    },
  };
}

export const elevenLabsScribeProvider = createElevenLabsScribeProvider();
export const elevenLabsRealtimeTokenClient =
  createElevenLabsRealtimeTokenClient();
