import { cadenceApiUrl } from './urls';
import type { SpeechVoicePage } from '../types/speech';

interface VoiceQuery {
  nextPageToken?: string | null;
  pageSize?: number;
  search?: string;
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Fall through to the status-aware message.
  }
  return `Read-aloud request failed (${response.status})`;
}

export async function fetchSpeechVoices(
  query: VoiceQuery = {},
  signal?: AbortSignal,
): Promise<SpeechVoicePage> {
  const params = new URLSearchParams();
  params.set('pageSize', String(query.pageSize ?? 100));
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.nextPageToken) params.set('nextPageToken', query.nextPageToken);

  const response = await fetch(
    cadenceApiUrl(`/speech/voices?${params.toString()}`),
    {
      headers: { Accept: 'application/json' },
      signal,
    },
  );
  if (!response.ok) throw new Error(await responseError(response));

  const payload = (await response.json()) as Partial<SpeechVoicePage>;
  if (
    !Array.isArray(payload.voices) ||
    typeof payload.hasMore !== 'boolean'
  ) {
    throw new Error('Read-aloud returned an invalid voice catalog');
  }

  return {
    voices: payload.voices,
    hasMore: payload.hasMore,
    nextPageToken:
      typeof payload.nextPageToken === 'string'
        ? payload.nextPageToken
        : null,
  };
}

export async function synthesizeSpeech(
  input: {
    signal?: AbortSignal;
    speed: number;
    text: string;
    voiceId: string;
  },
): Promise<Blob> {
  const response = await fetch(cadenceApiUrl('/speech/synthesize'), {
    body: JSON.stringify({
      voiceId: input.voiceId,
      text: input.text,
      speed: input.speed,
    }),
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: input.signal,
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.blob();
}
