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
  const lastSpeechTimeRef = useRef<number>(0);
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

  // The interval is keyed on isRecording alone; `update` is read through a ref
  // so session mutations (interim/final/pause dispatches) never tear down the
  // timer or reset in-progress pause tracking.
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    if (!state.isRecording) return;

    lastSpeechTimeRef.current = Date.now();
    pauseStartRef.current = null;
    const intervalId = window.setInterval(() => updateRef.current(), 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [state.isRecording]);

  return state.prosody;
}
