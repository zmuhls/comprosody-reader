import { useRef, useCallback } from 'react';
import { useRecording } from '../context/RecordingContext';

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

  const start = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('SpeechRecognition not supported');
      return;
    }

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
          dispatch({ type: 'APPEND_FINAL', text: transcript.trim() });
          // Add word timestamps for final results
          const words = transcript.trim().split(/\s+/);
          const now = Date.now();
          words.forEach((word, idx) => {
            dispatch({
              type: 'ADD_WORD_TIMESTAMP',
              word,
              time: now - (words.length - idx) * 200, // approximate
            });
          });
        } else {
          interim += transcript;
        }
      }
      if (interim) {
        dispatch({ type: 'UPDATE_INTERIM', text: interim });
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('Speech recognition error:', event.error);
    };

    recognition.onend = () => {
      // Auto-restart if still recording (browser stops after silence)
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
    dispatch({ type: 'START_RECORDING', startedAt: Date.now() });

    try {
      recognition.start();
    } catch {
      // Already started
    }
  }, [dispatch]);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    dispatch({ type: 'STOP_RECORDING' });
  }, [dispatch]);

  return {
    isRecording: state.isRecording,
    start,
    stop,
    interimTranscript: state.session?.interimTranscript ?? '',
    finalTranscript: state.session?.finalTranscript ?? '',
  };
}
