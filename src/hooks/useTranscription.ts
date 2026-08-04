import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeLexiconHint } from '../lib/lexicon';
import { recordImprovementEvent, wordCount } from '../lib/improvementMetrics';
import { cadenceApiUrl } from '../lib/urls';
import type { TranscriptionProviderId } from '../types/transcription';

interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResponse {
  transcript: string;
  words?: TranscriptionWord[];
  language?: string;
  duration?: number;
  error?: string;
}

interface UseTranscriptionOptions {
  provider?: TranscriptionProviderId;
  keyterms?: readonly string[];
}

export interface TranscriptionRequestOverrides {
  provider?: TranscriptionProviderId;
  keyterms?: readonly string[];
}

export const MAX_TRANSCRIPTION_KEYTERMS = 100;
export const MAX_KEYTERMS_HEADER_BYTES = 4_096;
const EMPTY_KEYTERMS: readonly string[] = [];

function asciiSafeJson(values: readonly string[]): string {
  return JSON.stringify(values).replace(
    /[^\x20-\x7e]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function serializeKeytermsHeader(keyterms: readonly string[]): string {
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const value of keyterms) {
    if (selected.length >= MAX_TRANSCRIPTION_KEYTERMS) break;
    const normalized = value.trim();
    const key = normalized.toLocaleLowerCase('en-US');
    if (!normalized || seen.has(key)) continue;
    const candidate = asciiSafeJson([...selected, normalized]);
    if (candidate.length > MAX_KEYTERMS_HEADER_BYTES) continue;
    selected.push(normalized);
    seen.add(key);
  }
  return asciiSafeJson(selected);
}

export function buildTranscriptionRequestMetadata(
  provider: TranscriptionProviderId,
  keyterms: readonly string[],
): { url: string; keytermsHeader: string; lexiconHeader: string } {
  const query = new URLSearchParams({ provider });
  return {
    url: cadenceApiUrl(`/transcribe?${query.toString()}`),
    keytermsHeader: serializeKeytermsHeader(keyterms),
    lexiconHeader: encodeLexiconHint([...keyterms], MAX_KEYTERMS_HEADER_BYTES),
  };
}

export function useTranscription(options: UseTranscriptionOptions = {}) {
  const provider = options.provider ?? 'local';
  const defaultKeyterms = options.keyterms ?? EMPTY_KEYTERMS;
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setIsTranscribing(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const transcribe = useCallback(
    async (
      audioBlob: Blob,
      vocabularyOrOverrides: string[] | TranscriptionRequestOverrides = [],
    ): Promise<TranscriptionResponse> => {
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      setIsTranscribing(true);
      setTranscriptionError(null);
      const startedAt = performance.now();
      const overrides = Array.isArray(vocabularyOrOverrides)
        ? { keyterms: vocabularyOrOverrides }
        : vocabularyOrOverrides;
      const requestProvider = overrides.provider ?? provider;
      const requestKeyterms = overrides.keyterms ?? defaultKeyterms;

      try {
        const request = buildTranscriptionRequestMetadata(
          requestProvider,
          requestKeyterms,
        );
        const headers: Record<string, string> = {
          'Content-Type': audioBlob.type || 'application/octet-stream',
        };
        if (request.keytermsHeader !== '[]') {
          headers['X-Cadence-Keyterms'] = request.keytermsHeader;
        }
        if (request.lexiconHeader) headers['X-Lexicon'] = request.lexiconHeader;

        const response = await fetch(request.url, {
          method: 'POST',
          headers,
          body: audioBlob,
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || `Transcription failed: ${response.status}`);
        }
        const data = (await response.json()) as TranscriptionResponse;
        if (data.error) throw new Error(data.error);

        void recordImprovementEvent({
          eventType: 'transcription',
          outcome: 'succeeded',
          provider: requestProvider,
          durationMs: performance.now() - startedAt,
          outputUnits: wordCount(data.transcript),
          audioDurationMs:
            typeof data.duration === 'number' ? data.duration * 1_000 : undefined,
          keytermCount: Math.min(MAX_TRANSCRIPTION_KEYTERMS, requestKeyterms.length),
        });
        return data;
      } catch (error) {
        const cancelled = controller.signal.aborted;
        void recordImprovementEvent({
          eventType: 'transcription',
          outcome: cancelled ? 'cancelled' : 'failed',
          provider: requestProvider,
          durationMs: performance.now() - startedAt,
          keytermCount: Math.min(MAX_TRANSCRIPTION_KEYTERMS, requestKeyterms.length),
        });
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Transcription failed';
          setTranscriptionError(message);
          console.error('Transcription failed:', error);
        }
        throw error;
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setIsTranscribing(false);
        }
      }
    },
    [defaultKeyterms, provider],
  );

  const clearTranscriptionError = useCallback(() => {
    setTranscriptionError(null);
  }, []);

  return {
    cancel,
    isTranscribing,
    transcriptionError,
    clearTranscriptionError,
    transcribe,
  };
}
