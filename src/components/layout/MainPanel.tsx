import { useRef, useCallback, useEffect, useState } from 'react';
import { useApp, newEntry } from '../../context/AppContext';
import { useRecording } from '../../context/RecordingContext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAudioAnalyser } from '../../hooks/useAudioAnalyser';
import { useMediaRecorder } from '../../hooks/useMediaRecorder';
import { useTranscription } from '../../hooks/useTranscription';
import { useProsody } from '../../hooks/useProsody';
import { deriveEntryName } from '../../lib/entries';
import { RecordingFooter } from '../dictation/RecordingFooter';
import { Editor } from '../editor/Editor';

export function MainPanel() {
  const { state, dispatch } = useApp();
  const { state: recState, dispatch: recDispatch } = useRecording();
  const speech = useSpeechRecognition();
  const audio = useAudioAnalyser();
  const recorder = useMediaRecorder();
  const { isTranscribing, transcriptionError, transcribe } = useTranscription();
  const prosody = useProsody(audio.getTimeDomainData);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const stateRef = useRef(state);
  const recordingEntryIdRef = useRef<string | null>(null);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!activeEntry || recState.isRecording) return;

    recDispatch({
      type: 'SET_VOICE_CONFIG',
      config: activeEntry.voiceConfig,
    });
    recDispatch({
      type: 'FINALIZE_PROSODY',
      prosody: activeEntry.prosody,
    });
  }, [activeEntry, recDispatch, recState.isRecording]);

  const appendTranscript = useCallback(
    (entryId: string, transcript: string) => {
      const entry = stateRef.current.entries[entryId];
      if (!entry || !transcript.trim()) return;

      const nextTranscript = entry.rawTranscript
        ? `${entry.rawTranscript}\n\n${transcript.trim()}`
        : transcript.trim();

      dispatch({
        type: 'UPDATE_ENTRY',
        id: entryId,
        updates: {
          rawTranscript: nextTranscript,
          name:
            entry.name === 'Untitled'
              ? deriveEntryName(nextTranscript)
              : entry.name,
        },
      });
    },
    [dispatch]
  );

  const handleStart = useCallback(async () => {
    setRecordingError(null);

    const entry = activeEntry ?? newEntry(null);
    if (!activeEntry) {
      dispatch({ type: 'CREATE_ENTRY', entry });
    }

    recordingEntryIdRef.current = entry.id;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      await audio.start(stream);
      recorder.start(stream);
      recDispatch({ type: 'START_RECORDING', startedAt: Date.now() });
      speech.start();
    } catch (err) {
      recordingEntryIdRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      audio.stop();
      const message =
        err instanceof Error ? err.message : 'Unable to start recording.';
      setRecordingError(message);
    }
  }, [activeEntry, audio, dispatch, recDispatch, recorder, speech]);

  const handleStop = useCallback(async () => {
    const entryId = recordingEntryIdRef.current ?? state.activeEntryId;
    const entry = entryId ? stateRef.current.entries[entryId] : null;

    speech.stop();
    recDispatch({ type: 'FINALIZE_PROSODY', prosody: { ...prosody } });
    recDispatch({ type: 'STOP_RECORDING' });
    const audioBlob = await recorder.stop();
    audio.stop();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Save prosody + voice config
    if (entry && recState.session) {
      dispatch({
        type: 'UPDATE_ENTRY',
        id: entry.id,
        updates: {
          prosody: { ...prosody },
          voiceConfig: { ...recState.voiceConfig },
        },
      });
    }

    // Send to OpenRouter for transcription, fall back to Web Speech API
    if (entry && audioBlob.size > 0) {
      try {
        const result = await transcribe(audioBlob);
        appendTranscript(entry.id, result.transcript);
      } catch {
        // Fall back to Web Speech API transcript
        const fallbackText = recState.session?.finalTranscript ?? '';
        if (fallbackText) {
          appendTranscript(entry.id, fallbackText);
        }
      }
    } else if (entry) {
      const fallbackText = recState.session?.finalTranscript ?? '';
      if (fallbackText) {
        appendTranscript(entry.id, fallbackText);
      }
    }

    recordingEntryIdRef.current = null;
  }, [
    appendTranscript,
    audio,
    dispatch,
    prosody,
    recDispatch,
    recState.session,
    recState.voiceConfig,
    recorder,
    speech,
    state.activeEntryId,
    transcribe,
  ]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Editor
        interimTranscript={speech.interimTranscript}
        isRecording={recState.isRecording}
      />

      <RecordingFooter
        activeEntryName={activeEntry?.name ?? null}
        isRecording={recState.isRecording}
        isTranscribing={isTranscribing}
        isSpeechSupported={speech.isSupported}
        recordingError={recordingError}
        transcriptionError={transcriptionError}
        prosody={prosody}
        drawWaveform={audio.drawWaveform}
        onStart={handleStart}
        onStop={handleStop}
      />
    </div>
  );
}
