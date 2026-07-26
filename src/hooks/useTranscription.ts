import { useState, useCallback } from 'react';

interface TranscriptionResponse {
  transcript: string;
  error?: string;
}

export function useTranscription() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  const transcribe = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    setTranscriptionError(null);

    try {
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': audioBlob.type || 'audio/webm' },
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
