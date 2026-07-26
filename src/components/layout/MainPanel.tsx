import { useRef, useCallback, useEffect, useState } from 'react';
import { useApp, newEntry } from '../../context/AppContext';
import { useRecording } from '../../context/RecordingContext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAudioAnalyser } from '../../hooks/useAudioAnalyser';
import { useMediaRecorder } from '../../hooks/useMediaRecorder';
import { useTranscription } from '../../hooks/useTranscription';
import { useProsody } from '../../hooks/useProsody';
import { deriveEntryName, countWords } from '../../lib/entries';
import { saveRecording } from '../../lib/audioStore';
import { RecordingFooter } from '../dictation/RecordingFooter';
import { Editor } from '../editor/Editor';

interface FailedTake {
  blob: Blob;
  entryId: string;
  liveTranscript: string;
}

export function MainPanel() {
  const { state, dispatch } = useApp();
  const { state: recState, dispatch: recDispatch } = useRecording();
  const speech = useSpeechRecognition();
  const audio = useAudioAnalyser();
  const recorder = useMediaRecorder();
  const { isTranscribing, transcriptionError, clearTranscriptionError, transcribe } =
    useTranscription();
  const prosody = useProsody(audio.getTimeDomainData);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [failedTake, setFailedTake] = useState<FailedTake | null>(null);

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

    // Rescue a pending failed take before its live transcript is lost —
    // the audio itself is already persisted in IndexedDB.
    if (failedTake) {
      if (failedTake.liveTranscript) {
        appendTranscript(failedTake.entryId, failedTake.liveTranscript);
      }
      setFailedTake(null);
      clearTranscriptionError();
    }

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
  }, [
    activeEntry,
    appendTranscript,
    audio,
    clearTranscriptionError,
    dispatch,
    failedTake,
    recDispatch,
    recorder,
    speech,
  ]);

  const handleStop = useCallback(async () => {
    const entryId = recordingEntryIdRef.current ?? state.activeEntryId;
    const entry = entryId ? stateRef.current.entries[entryId] : null;
    const session = recState.session;

    speech.stop();
    recDispatch({ type: 'FINALIZE_PROSODY', prosody: { ...prosody } });
    recDispatch({ type: 'STOP_RECORDING' });
    const audioBlob = await recorder.stop();
    audio.stop();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    const durationMs = session ? Date.now() - session.startedAt : 0;

    // Persist the take to IndexedDB — non-fatal on quota or availability errors.
    if (entry && session && audioBlob.size > 0) {
      void saveRecording(entry.id, audioBlob, {
        recordedAt: session.startedAt,
        durationMs,
      }).catch((err) => {
        console.error('Failed to persist recording:', err);
      });
    }

    // Save prosody + voice config, and bump take stats when audio was captured
    if (entry && session) {
      dispatch({
        type: 'UPDATE_ENTRY',
        id: entry.id,
        updates: {
          prosody: { ...prosody },
          voiceConfig: { ...recState.voiceConfig },
          ...(audioBlob.size > 0
            ? {
                recordedDurationMs:
                  (entry.recordedDurationMs ?? 0) + durationMs,
                audioTakes: (entry.audioTakes ?? 0) + 1,
              }
            : {}),
        },
      });
    }

    // Send to the server for transcription; on failure hold the take for a
    // user-chosen retry instead of silently appending the live transcript.
    if (entry && audioBlob.size > 0) {
      try {
        const result = await transcribe(audioBlob);
        appendTranscript(entry.id, result.transcript);
      } catch {
        setFailedTake({
          blob: audioBlob,
          entryId: entry.id,
          liveTranscript: speech.getFinalTranscript(),
        });
      }
    } else if (entry) {
      const fallbackText = speech.getFinalTranscript();
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

  const handleRetryTranscription = useCallback(async () => {
    const take = failedTake;
    if (!take) return;

    try {
      const result = await transcribe(take.blob);
      appendTranscript(take.entryId, result.transcript);
      setFailedTake(null);
    } catch {
      // transcriptionError is re-set by transcribe(); the take stays armed
    }
  }, [appendTranscript, failedTake, transcribe]);

  const handleUseLiveTranscript = useCallback(() => {
    const take = failedTake;
    if (!take) return;

    if (take.liveTranscript) {
      appendTranscript(take.entryId, take.liveTranscript);
    }
    setFailedTake(null);
    clearTranscriptionError();
  }, [appendTranscript, clearTranscriptionError, failedTake]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.code !== 'Space') return;
      e.preventDefault();
      if (recState.isRecording) {
        void handleStop();
      } else if (!isTranscribing) {
        void handleStart();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleStart, handleStop, isTranscribing, recState.isRecording]);

  const liveWordCount = recState.session
    ? countWords(
        `${recState.session.finalTranscript} ${recState.session.interimTranscript}`
      )
    : 0;

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
        canRetryTranscription={failedTake !== null}
        prosody={prosody}
        sessionStartedAt={recState.session?.startedAt ?? null}
        liveWordCount={liveWordCount}
        drawWaveform={audio.drawWaveform}
        onStart={handleStart}
        onStop={handleStop}
        onRetryTranscription={handleRetryTranscription}
        onUseLiveTranscript={handleUseLiveTranscript}
      />
    </div>
  );
}
