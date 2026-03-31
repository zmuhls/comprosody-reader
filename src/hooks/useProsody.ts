import { useRef, useCallback, useEffect } from 'react';
import { useRecording } from '../context/RecordingContext';
import {
  computeWpm,
  computeEnergy,
  computeFluency,
  computeLexicalDensity,
} from '../lib/comprosody';

export function useProsody(getTimeDomainData: () => Uint8Array<ArrayBuffer> | null) {
  const { state, dispatch } = useRecording();
  const intervalRef = useRef<number>(0);
  const lastSpeechTimeRef = useRef<number>(Date.now());
  const pauseStartRef = useRef<number | null>(null);

  const update = useCallback(() => {
    if (!state.session) return;

    const now = Date.now();
    const elapsed = now - state.session.startedAt;
    const fullText =
      state.session.finalTranscript +
      (state.session.interimTranscript
        ? ' ' + state.session.interimTranscript
        : '');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    // Pace
    const pace = computeWpm(wordCount, elapsed);

    // Energy from audio data
    const audioData = getTimeDomainData();
    const energy = audioData ? computeEnergy(audioData) : 0;

    // Detect pauses for fluency
    if (energy > 0.05) {
      if (pauseStartRef.current !== null) {
        const pauseEnd = now;
        if (pauseEnd - pauseStartRef.current > 500) {
          dispatch({
            type: 'ADD_PAUSE',
            start: pauseStartRef.current,
            end: pauseEnd,
          });
        }
        pauseStartRef.current = null;
      }
      lastSpeechTimeRef.current = now;
    } else if (pauseStartRef.current === null && now - lastSpeechTimeRef.current > 500) {
      pauseStartRef.current = lastSpeechTimeRef.current;
    }

    const fluency = computeFluency(state.session.pauses, elapsed);
    const lexicalDensity = computeLexicalDensity(fullText);

    dispatch({
      type: 'UPDATE_PROSODY',
      prosody: { pace, energy, fluency, lexicalDensity },
    });
  }, [state.session, getTimeDomainData, dispatch]);

  useEffect(() => {
    if (state.isRecording) {
      intervalRef.current = window.setInterval(update, 500);
      lastSpeechTimeRef.current = Date.now();
      pauseStartRef.current = null;
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = 0;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = 0;
      }
    };
  }, [state.isRecording, update]);

  return state.prosody;
}
