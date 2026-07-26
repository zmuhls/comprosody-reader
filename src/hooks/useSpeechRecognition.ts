import { useRef, useCallback } from 'react';
import { useRecording } from '../context/RecordingContext';

/**
 * Web Speech API wrapper for interim transcript display during recording.
 * Final transcription is handled by the server endpoint (useTranscription) after
 * recording stops. This hook provides real-time interim text feedback while the
 * user is speaking, and keeps the accumulated final text in a ref so callers can
 * read it synchronously after stop() without stale-closure loss.
 */

// Web Speech API type augmentation
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

export function useSpeechRecognition() {
  const { state, dispatch } = useRecording();
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldRestartRef = useRef(false);
  const finalTranscriptRef = useRef('');
  const isSupported =
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const start = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // Web Speech API not available — interim display won't work,
      // but Whisper will still provide the final transcript.
      return;
    }

    finalTranscriptRef.current = '';

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          const text = transcript.trim();
          // Mirror the APPEND_FINAL reducer join so the ref stays in sync even
          // when results flush after stop() (the closure-free rescue path).
          finalTranscriptRef.current = finalTranscriptRef.current
            ? finalTranscriptRef.current + ' ' + text
            : text;
          dispatch({ type: 'APPEND_FINAL', text });
        } else {
          interim += transcript;
        }
      }
      if (interim && shouldRestartRef.current) {
        dispatch({ type: 'UPDATE_INTERIM', text: interim });
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      if (shouldRestartRef.current) {
        try {
          recognition.start();
        } catch {
          // Already started
        }
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;

    try {
      recognition.start();
    } catch {
      // Already started
    }
  }, [dispatch]);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      // Keep onresult attached — the engine's trailing flush still delivers the
      // last final phrase into finalTranscriptRef after stop.
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    dispatch({ type: 'UPDATE_INTERIM', text: '' });
  }, [dispatch]);

  const getFinalTranscript = useCallback(() => finalTranscriptRef.current, []);

  return {
    isRecording: state.isRecording,
    isSupported,
    start,
    stop,
    getFinalTranscript,
    interimTranscript: state.session?.interimTranscript ?? '',
  };
}
