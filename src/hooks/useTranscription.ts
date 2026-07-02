import { useState, useCallback } from 'react';
import { useRecording } from '../context/RecordingContext';
import { useApp } from '../context/AppContext';

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

export function useTranscription() {
  const { dispatch: recordingDispatch } = useRecording();
  const { dispatch: appDispatch } = useApp();
  const [isTranscribing, setIsTranscribing] = useState(false);

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
    async (audioBlob: Blob) => {
      setIsTranscribing(true);

      try {
        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: audioBlob,
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

        recordingDispatch({ type: 'SET_AUDIO_BLOB', blob: audioBlob });

        return data;
      } catch (err) {
        console.error('Transcription failed:', err);
        setError(formatError(err));
        throw err;
      } finally {
        setIsTranscribing(false);
      }
    },
    [recordingDispatch, appDispatch, setError]
  );

  return { isTranscribing, transcribe };
}
