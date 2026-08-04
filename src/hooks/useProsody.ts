import { useRef, useCallback, useEffect, useState } from 'react';
import { useRecording } from '../context/RecordingContext';
import {
  computeWpm,
  computeEnergy,
  computeFluency,
  computeLexicalDensity,
} from '../lib/comprosody';
import type { ProsodyDiagnostics } from '../types/audio';
import { defaultProsody } from '../types/audio';

export function useProsody(getTimeDomainData: () => Uint8Array<ArrayBuffer> | null) {
  const { state, dispatch } = useRecording();
  const lastSpeechTimeRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);
  const wasRecordingRef = useRef(false);

  // Local state for live prosody — avoids dispatching to context every 500ms
  // which would re-render all RecordingContext consumers.
  const [liveProsody, setLiveProsody] = useState<ProsodyDiagnostics>(defaultProsody);
  const liveProsodyRef = useRef<ProsodyDiagnostics>(defaultProsody);

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

    const next = { pace, energy, fluency, lexicalDensity };
    liveProsodyRef.current = next;
    setLiveProsody(next);
  }, [state.session, getTimeDomainData, dispatch]);

  // The interval is keyed on isRecording alone; `update` is read through a ref
  // so session mutations (interim/final/pause dispatches) never tear down the
  // timer or reset in-progress pause tracking.
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    if (!state.isRecording) {
      if (wasRecordingRef.current) {
        wasRecordingRef.current = false;
        dispatch({ type: 'FINALIZE_PROSODY', prosody: liveProsodyRef.current });
      }
      return;
    }

    wasRecordingRef.current = true;
    lastSpeechTimeRef.current = Date.now();
    pauseStartRef.current = null;
    const intervalId = window.setInterval(() => updateRef.current(), 500);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [dispatch, state.isRecording]);

  // The analyser owns the live display while recording. Once stopped, use the
  // finalized context snapshot so MainPanel's post-transcription correction is
  // reflected in the UI as well as the saved note and local voice profile.
  return state.isRecording ? liveProsody : state.prosody;
}
