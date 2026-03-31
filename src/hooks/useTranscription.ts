import { useState, useCallback } from 'react';
import { useRecording } from '../context/RecordingContext';

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

export function useTranscription() {
  const { dispatch } = useRecording();
  const [isTranscribing, setIsTranscribing] = useState(false);

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
          const err = await response.json();
          throw new Error(err.error || `Transcription failed: ${response.status}`);
        }

        const data: TranscriptionResponse = await response.json();

        if (data.error) throw new Error(data.error);

        dispatch({ type: 'SET_TRANSCRIPT', text: data.transcript });

        for (const w of data.words) {
          dispatch({
            type: 'ADD_WORD_TIMESTAMP',
            word: w.word,
            start: w.start,
            end: w.end,
          });
        }

        dispatch({ type: 'SET_AUDIO_BLOB', blob: audioBlob });

        return data;
      } catch (err) {
        console.error('Transcription failed:', err);
        throw err;
      } finally {
        setIsTranscribing(false);
      }
    },
    [dispatch]
  );

  return { isTranscribing, transcribe };
}
