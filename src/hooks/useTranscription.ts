import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecording } from '../context/RecordingContext';
import { useApp } from '../context/AppContext';
import {
  recordImprovementEvent,
  wordCount,
} from '../lib/improvementMetrics';
import { cadenceApiUrl } from '../lib/urls';
import type { TranscriptionProviderId } from '../types/transcription';

interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptionResponse {
  transcript: string;
  words: TranscriptionWord[];
  language: string;
  duration: number;
  error?: string;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : 'Transcription failed';
}

interface UseTranscriptionOptions {
  provider: TranscriptionProviderId;
  keyterms?: readonly string[];
}

export interface TranscriptionRequestOverrides {
  provider?: TranscriptionProviderId;
  keyterms?: readonly string[];
}

export const MAX_TRANSCRIPTION_KEYTERMS = 100;
export const MAX_KEYTERMS_HEADER_BYTES = 4_096;

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
    if (!normalized || seen.has(normalized)) continue;

    const candidate = asciiSafeJson([...selected, normalized]);
    if (candidate.length > MAX_KEYTERMS_HEADER_BYTES) continue;
    selected.push(normalized);
    seen.add(normalized);
  }

  return asciiSafeJson(selected);
}

export function buildTranscriptionRequestMetadata(
  provider: TranscriptionProviderId,
  keyterms: readonly string[],
): { url: string; keytermsHeader: string } {
  const query = new URLSearchParams({ provider });
  return {
    url: cadenceApiUrl(`/transcribe?${query.toString()}`),
    keytermsHeader: serializeKeytermsHeader(keyterms),
  };
}

export function useTranscription({
  provider,
  keyterms = [],
}: UseTranscriptionOptions) {
  const { dispatch: recordingDispatch } = useRecording();
  const { dispatch: appDispatch } = useApp();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const requestControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    requestControllerRef.current?.abort();
    setIsTranscribing(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const setError = useCallback(
    (message: string) => {
      appDispatch({
        type: 'SET_ERROR',
        error: { id: crypto.randomUUID(), message, type: 'transcription' },
      });
    },
    [appDispatch]
  );

  const transcribe = useCallback(
    async (
      audioBlob: Blob,
      overrides: TranscriptionRequestOverrides = {},
    ) => {
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      setIsTranscribing(true);
      const startedAt = performance.now();
      const requestProvider = overrides.provider ?? provider;
      const requestKeyterms = overrides.keyterms ?? keyterms;

      try {
        const request = buildTranscriptionRequestMetadata(
          requestProvider,
          requestKeyterms,
        );

        const response = await fetch(request.url, {
          method: 'POST',
          headers: {
            'Content-Type': audioBlob.type || 'application/octet-stream',
            'X-Cadence-Keyterms': request.keytermsHeader,
          },
          body: audioBlob,
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || `Transcription failed: ${response.status}`);
        }

        const data: TranscriptionResponse = await response.json();

        if (data.error) throw new Error(data.error);

        recordingDispatch({ type: 'SET_TRANSCRIPT', text: data.transcript });

        for (const w of data.words) {
          recordingDispatch({
            type: 'ADD_WORD_TIMESTAMP',
            word: w.word,
            start: w.start,
            end: w.end,
          });
        }

        void recordImprovementEvent({
          eventType: 'transcription',
          outcome: 'succeeded',
          provider: requestProvider,
          durationMs: performance.now() - startedAt,
          outputUnits: wordCount(data.transcript),
          audioDurationMs: data.duration * 1_000,
          keytermCount: Math.min(
            MAX_TRANSCRIPTION_KEYTERMS,
            requestKeyterms.length,
          ),
        });
        return data;
      } catch (err) {
        const cancelled = controller.signal.aborted;
        void recordImprovementEvent({
          eventType: 'transcription',
          outcome: cancelled ? 'cancelled' : 'failed',
          provider: requestProvider,
          durationMs: performance.now() - startedAt,
          keytermCount: Math.min(
            MAX_TRANSCRIPTION_KEYTERMS,
            requestKeyterms.length,
          ),
        });
        if (!cancelled) {
          console.error('Transcription failed:', err);
          setError(formatError(err));
        }
        throw err;
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setIsTranscribing(false);
        }
      }
    },
    [recordingDispatch, keyterms, provider, setError]
  );

  return { cancel, isTranscribing, transcribe };
}
