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
  const intervalRef = useRef<number>(0);
  const lastSpeechTimeRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);

  // Local state for live prosody — avoids dispatching to context every 500ms
  // which would re-render all RecordingContext consumers.
  const [liveProsody, setLiveProsody] = useState<ProsodyDiagnostics>(defaultProsody);

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

    setLiveProsody({ pace, energy, fluency, lexicalDensity });
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
      // When recording stops, finalize prosody into context once
      if (liveProsody.pace > 0 || liveProsody.energy > 0 || liveProsody.fluency !== 1) {
        dispatch({ type: 'FINALIZE_PROSODY', prosody: liveProsody });
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRecording, update]);

  // The analyser owns the live display while recording. Once stopped, use the
  // finalized context snapshot so MainPanel's post-transcription correction is
  // reflected in the UI as well as the saved note and local voice profile.
  return state.isRecording ? liveProsody : state.prosody;
}
