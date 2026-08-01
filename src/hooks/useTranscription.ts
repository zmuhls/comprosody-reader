import { useState, useCallback } from 'react';
import { encodeLexiconHint } from '../lib/lexicon';

interface TranscriptionResponse {
  transcript: string;
  error?: string;
}

/** Mirrors the server's cap in server/routes/transcribe.ts. */
const MAX_LEXICON_HEADER_CHARS = 4096;

export function useTranscription() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  const transcribe = useCallback(async (audioBlob: Blob, vocabulary: string[] = []) => {
    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': audioBlob.type || 'audio/webm',
      };
      // The body is raw audio, so the vocabulary hint travels as a header.
      const hint = encodeLexiconHint(vocabulary, MAX_LEXICON_HEADER_CHARS);
      if (hint) headers['X-Lexicon'] = hint;

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers,
        body: audioBlob,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || `Transcription failed: ${response.status}`);
      }

      const data: TranscriptionResponse = await response.json();

      if (data.error) throw new Error(data.error);

      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Transcription failed';
      setTranscriptionError(message);
      console.error('Transcription failed:', err);
      throw err;
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const clearTranscriptionError = useCallback(() => {
    setTranscriptionError(null);
  }, []);

  return { isTranscribing, transcriptionError, clearTranscriptionError, transcribe };
}
