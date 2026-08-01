import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp, newEntry } from '../../context/AppContext';
import { useRecording } from '../../context/RecordingContext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAudioAnalyser } from '../../hooks/useAudioAnalyser';
import { useMediaRecorder } from '../../hooks/useMediaRecorder';
import { useTranscription } from '../../hooks/useTranscription';
import { useProsody } from '../../hooks/useProsody';
import { deriveEntryName, countWords } from '../../lib/entries';
import { saveRecording, attachTranscript } from '../../lib/audioStore';
import { applyLexicon, rankForHint } from '../../lib/lexicon';
import { LEXICON_HINT_CAP, LEXICON_TERM_MAX_LEN } from '../../constants';
import type { AppliedSubstitution } from '../../types/lexicon';
import { RecordingFooter } from '../dictation/RecordingFooter';
import { AutoCorrectionNotice } from '../editor/AutoCorrectionNotice';
import { Editor } from '../editor/Editor';

interface FailedTake {
  blob: Blob;
  entryId: string;
  recordedAt: number;
  liveTranscript: string;
}

interface MainPanelProps {
  onToggleSidebar: () => void;
}

export function MainPanel({ onToggleSidebar }: MainPanelProps) {
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
  // Tagged with the entry so a revert edits the transcript it actually changed.
  const [applied, setApplied] = useState<{
    entryId: string;
    substitutions: AppliedSubstitution[];
  } | null>(null);

  const vocabulary = useMemo(
    () => rankForHint(state.lexicon, LEXICON_HINT_CAP, LEXICON_TERM_MAX_LEN),
    [state.lexicon]
  );

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

  // Record what a take contributed, so later edits to the transcript can be
  // diffed against it to isolate the user's corrections.
  const recordTakeText = useCallback(
    (entryId: string, recordedAt: number, text: string) => {
      void attachTranscript(entryId, recordedAt, text).catch((err) => {
        console.error('Failed to record take transcript:', err);
      });
    },
    []
  );

  /**
   * Run confirmed substitutions over a fresh transcript before it lands in the
   * entry. The corrected text — not the model's raw output — becomes the take's
   * baseline, so the pass is not re-proposed as a correction on the next diff.
   */
  const ingestTranscript = useCallback(
    (entryId: string, recordedAt: number | null, transcript: string) => {
      const result = applyLexicon(transcript, stateRef.current.lexicon);
      appendTranscript(entryId, result.text);
      if (recordedAt !== null) recordTakeText(entryId, recordedAt, result.text);
      if (result.applied.length > 0) {
        setApplied({ entryId, substitutions: result.applied });
      }
    },
    [appendTranscript, recordTakeText]
  );

  const handleStart = useCallback(async () => {
    setRecordingError(null);

    // Rescue a pending failed take before its live transcript is lost —
    // the audio itself is already persisted in IndexedDB.
    if (failedTake) {
      if (failedTake.liveTranscript) {
        ingestTranscript(
          failedTake.entryId,
          failedTake.recordedAt,
          failedTake.liveTranscript
        );
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
    audio,
    clearTranscriptionError,
    dispatch,
    failedTake,
    ingestTranscript,
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
    // Held so the transcript can be attached to the same record once it lands.
    const takeSaved =
      entry && session && audioBlob.size > 0
        ? saveRecording(entry.id, audioBlob, {
            recordedAt: session.startedAt,
            durationMs,
          }).catch((err) => {
            console.error('Failed to persist recording:', err);
          })
        : null;

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

    // The take record must exist before its transcript can be attached.
    if (takeSaved) await takeSaved;

    // Send to the server for transcription; on failure hold the take for a
    // user-chosen retry instead of silently appending the live transcript.
    if (entry && audioBlob.size > 0) {
      try {
        const result = await transcribe(audioBlob, vocabulary);
        ingestTranscript(entry.id, session?.startedAt ?? null, result.transcript);
      } catch {
        setFailedTake({
          blob: audioBlob,
          entryId: entry.id,
          recordedAt: session?.startedAt ?? Date.now(),
          liveTranscript: speech.getFinalTranscript(),
        });
      }
    } else if (entry) {
      const fallbackText = speech.getFinalTranscript();
      if (fallbackText) {
        ingestTranscript(entry.id, null, fallbackText);
      }
    }

    recordingEntryIdRef.current = null;
  }, [
    audio,
    dispatch,
    ingestTranscript,
    prosody,
    recDispatch,
    recState.session,
    recState.voiceConfig,
    recorder,
    speech,
    state.activeEntryId,
    transcribe,
    vocabulary,
  ]);

  const handleRetryTranscription = useCallback(async () => {
    const take = failedTake;
    if (!take) return;

    try {
      const result = await transcribe(take.blob, vocabulary);
      ingestTranscript(take.entryId, take.recordedAt, result.transcript);
      setFailedTake(null);
    } catch {
      // transcriptionError is re-set by transcribe(); the take stays armed
    }
  }, [failedTake, ingestTranscript, transcribe, vocabulary]);

  const handleUseLiveTranscript = useCallback(() => {
    const take = failedTake;
    if (!take) return;

    if (take.liveTranscript) {
      ingestTranscript(take.entryId, take.recordedAt, take.liveTranscript);
    }
    setFailedTake(null);
    clearTranscriptionError();
  }, [clearTranscriptionError, failedTake, ingestTranscript]);

  /**
   * Undo one substitution and demote the rule behind it. The demotion is the
   * point: a rule the user reverts stops firing, which is what keeps a bad
   * lexicon entry from rewriting every future transcript.
   */
  const handleRevertSubstitution = useCallback(
    (substitution: AppliedSubstitution) => {
      dispatch({ type: 'RECORD_LEXICON_MISFIRE', id: substitution.termId });

      const entryId = applied?.entryId;
      const entry = entryId ? stateRef.current.entries[entryId] : null;
      if (entryId && entry) {
        dispatch({
          type: 'UPDATE_ENTRY',
          id: entryId,
          updates: {
            rawTranscript: entry.rawTranscript
              .split(substitution.canonical)
              .join(substitution.heard),
          },
        });
      }

      setApplied((prev) => {
        if (!prev) return null;
        const rest = prev.substitutions.filter(
          (s) => s.termId !== substitution.termId || s.heard !== substitution.heard
        );
        return rest.length > 0 ? { ...prev, substitutions: rest } : null;
      });
    },
    [applied, dispatch]
  );

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
        onToggleSidebar={onToggleSidebar}
      />

      <AutoCorrectionNotice
        applied={
          applied && applied.entryId === state.activeEntryId
            ? applied.substitutions
            : []
        }
        onRevert={handleRevertSubstitution}
        onDismiss={() => setApplied(null)}
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
