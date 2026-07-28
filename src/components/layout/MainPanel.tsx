import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from '../../context/AppContext';
import { useRecording } from '../../context/RecordingContext';
import { useAudioAnalyser } from '../../hooks/useAudioAnalyser';
import { useMediaRecorder } from '../../hooks/useMediaRecorder';
import { useRealtimeTranscription } from '../../hooks/useRealtimeTranscription';
import { useTranscription } from '../../hooks/useTranscription';
import { useProsody } from '../../hooks/useProsody';
import { useRefinement } from '../../hooks/useRefinement';
import {
  appendProsodySnapshot,
  appendRecordingTranscript,
} from '../../lib/recordingDocument';
import { completeTranscriptProsody } from '../../lib/comprosody';
import { selectTranscriptionHints } from '../../lib/voiceProfile';
import { SESSION_LOGOUT_INTENT_EVENT } from '../../lib/session';
import type { TranscriptionProviderId } from '../../types/transcription';
import { Editor } from '../editor/Editor';

interface MainPanelProps {
  onOpenSidebar: (returnFocusTarget?: HTMLElement) => void;
}

const PROVIDER_STORAGE_KEY = 'cadence:transcription-provider';

interface RecordingTarget {
  entryId: string;
  epoch: number;
  provider: TranscriptionProviderId;
  keyterms: readonly string[];
}

function initialProvider(): TranscriptionProviderId {
  try {
    return localStorage.getItem(PROVIDER_STORAGE_KEY) === 'elevenlabs'
      ? 'elevenlabs'
      : 'local';
  } catch {
    return 'local';
  }
}

export function MainPanel({ onOpenSidebar }: MainPanelProps) {
  const { state, dispatch, voiceProfile } = useApp();
  const { state: recordingState, dispatch: recordingDispatch } = useRecording();
  const [provider, setProvider] = useState<TranscriptionProviderId>(initialProvider);
  const audio = useAudioAnalyser();
  const recorder = useMediaRecorder();
  const realtime = useRealtimeTranscription();
  const realtimeError = realtime.liveError;
  const realtimeStatus = realtime.status;
  const surfaceRealtimeError = realtime.surfaceError;
  const prosody = useProsody(audio.getTimeDomainData);
  const refinement = useRefinement();

  const keyterms = useMemo(() => {
    const hints = selectTranscriptionHints(voiceProfile, {
      maxTerms: 60,
      maxPhrases: 40,
      minTermCount: 2,
      minPhraseCount: 2,
    });
    return [...hints.terms, ...hints.phrases];
  }, [voiceProfile]);

  const {
    cancel: cancelTranscription,
    isTranscribing,
    transcribe,
  } = useTranscription({
    provider,
    keyterms,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const recordingTargetRef = useRef<RecordingTarget | null>(null);
  const privateWorkEpochRef = useRef(0);
  const stateRef = useRef(state);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
    } catch {
      // Provider selection remains in memory if storage is unavailable.
    }
  }, [provider]);

  useEffect(() => {
    const target = recordingTargetRef.current;
    if (target && !state.entries[target.entryId]) {
      recordingTargetRef.current = null;
    }
  }, [state.entries]);

  useEffect(() => {
    if (realtimeStatus === 'degraded' && realtimeError) {
      surfaceRealtimeError();
    }
  }, [realtimeError, realtimeStatus, surfaceRealtimeError]);

  useEffect(() => {
    const stopPrivateWork = () => {
      privateWorkEpochRef.current += 1;
      recordingTargetRef.current = null;
      recordingDispatch({ type: 'STOP_RECORDING' });
      cancelTranscription();
      recorder.cancel();
      refinement.cancel();
      void realtime.cancel();
      audio.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    window.addEventListener(SESSION_LOGOUT_INTENT_EVENT, stopPrivateWork);
    return () =>
      window.removeEventListener(
        SESSION_LOGOUT_INTENT_EVENT,
        stopPrivateWork,
      );
  }, [
    audio,
    cancelTranscription,
    recorder,
    recordingDispatch,
    realtime,
    refinement,
  ]);

  const setRecordingError = useCallback(
    (error: unknown) => {
      dispatch({
        type: 'SET_ERROR',
        error: {
          id: crypto.randomUUID(),
          message:
            error instanceof Error
              ? error.message
              : 'Microphone access could not be started.',
          type: 'transcription',
        },
      });
    },
    [dispatch],
  );

  const handleStart = useCallback(async () => {
    if (
      !activeEntry ||
      recordingTargetRef.current ||
      recordingState.isRecording ||
      isTranscribing
    ) {
      return;
    }

    const target: RecordingTarget = {
      entryId: activeEntry.id,
      epoch: privateWorkEpochRef.current,
      provider,
      keyterms: [...keyterms],
    };
    recordingTargetRef.current = target;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (
        recordingTargetRef.current !== target ||
        !stateRef.current.entries[target.entryId]
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      recordingDispatch({ type: 'START_RECORDING', startedAt: Date.now() });
      await audio.start(stream);
      recorder.start(stream);
      if (target.provider === 'elevenlabs') {
        void realtime.start(stream, target.keyterms);
      }
    } catch (error) {
      audio.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (recordingTargetRef.current === target) {
        recordingTargetRef.current = null;
      }
      recordingDispatch({ type: 'STOP_RECORDING' });
      setRecordingError(error);
    }
  }, [
    activeEntry,
    audio,
    isTranscribing,
    keyterms,
    provider,
    realtime,
    recorder,
    recordingDispatch,
    recordingState.isRecording,
    setRecordingError,
  ]);

  const handleStop = useCallback(async () => {
    if (!recordingState.isRecording) return;

    const target = recordingTargetRef.current;
    const stoppedAt = Date.now();
    const recordingDurationMs = recordingState.session
      ? Math.max(0, stoppedAt - recordingState.session.startedAt)
      : 0;
    const capturedProsody = { ...prosody };
    const capturedVoiceConfig = { ...recordingState.voiceConfig };
    recordingDispatch({ type: 'STOP_RECORDING' });
    let audioBlob: Blob;
    let realtimeTranscript = '';
    let shouldUseBatch = target?.provider !== 'elevenlabs';

    try {
      audioBlob = await recorder.stop();
      if (!target || target.epoch !== privateWorkEpochRef.current) {
        if (target?.provider === 'elevenlabs') {
          await realtime.cancel();
        }
        return;
      }
      if (target?.provider === 'elevenlabs') {
        try {
          const realtimeResult = await realtime.stop();
          if (target.epoch !== privateWorkEpochRef.current) return;
          realtimeTranscript = realtimeResult.transcript;
          shouldUseBatch = realtimeResult.shouldFallback;
        } catch {
          shouldUseBatch = true;
        }
      }
    } catch (error) {
      if (target && target.epoch !== privateWorkEpochRef.current) return;
      if (target?.provider === 'elevenlabs') {
        await realtime.cancel();
      }
      setRecordingError(error);
      if (recordingTargetRef.current === target) {
        recordingTargetRef.current = null;
      }
      return;
    } finally {
      audio.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (
      !target ||
      target.epoch !== privateWorkEpochRef.current ||
      !stateRef.current.entries[target.entryId]
    ) {
      if (recordingTargetRef.current === target) {
        recordingTargetRef.current = null;
      }
      return;
    }

    let snapshotSaved = false;
    const saveSnapshot = (
      metrics: typeof capturedProsody,
      entry = stateRef.current.entries[target.entryId],
    ) => {
      if (!entry) return;
      dispatch({
        type: 'UPDATE_ENTRY',
        id: target.entryId,
        updates: {
          prosody: { ...metrics },
          prosodyHistory: appendProsodySnapshot(
            entry.prosodyHistory,
            metrics,
            stoppedAt,
          ),
          voiceConfig: capturedVoiceConfig,
        },
      });
      recordingDispatch({ type: 'FINALIZE_PROSODY', prosody: metrics });
      snapshotSaved = true;
    };

    try {
      if (audioBlob.size === 0) {
        saveSnapshot(capturedProsody);
        return;
      }

      const result =
        target.provider === 'elevenlabs' &&
        !shouldUseBatch &&
        realtimeTranscript
          ? {
              duration: recordingDurationMs / 1_000,
              language: 'en',
              transcript: realtimeTranscript,
              words: [],
            }
          : await transcribe(audioBlob, {
              provider: target.provider,
              keyterms: target.keyterms,
            });
      if (target.epoch !== privateWorkEpochRef.current) return;
      const transcript = result.transcript.trim();
      if (!transcript) {
        saveSnapshot(capturedProsody);
        return;
      }

      const latestEntry = stateRef.current.entries[target.entryId];
      if (!latestEntry) return;

      const appended = appendRecordingTranscript(latestEntry, transcript);
      const correctedProsody = completeTranscriptProsody(
        capturedProsody,
        transcript,
        recordingDurationMs,
      );
      dispatch({
        type: 'UPDATE_ENTRY',
        id: target.entryId,
        updates: {
          rawTranscript: appended.rawTranscript,
          refinedText: appended.documentText,
          prosody: correctedProsody,
          prosodyHistory: appendProsodySnapshot(
            latestEntry.prosodyHistory,
            correctedProsody,
            stoppedAt,
          ),
          voiceConfig: capturedVoiceConfig,
        },
      });
      recordingDispatch({
        type: 'FINALIZE_PROSODY',
        prosody: correctedProsody,
      });
      snapshotSaved = true;

      if (recordingTargetRef.current === target) {
        recordingTargetRef.current = null;
      }
      if (stateRef.current.refinementSettings.autoRefine !== false) {
        void refinement.refine({
          entryId: target.entryId,
          mode: 'faithful',
          sourceText: appended.documentText,
          autoTriggered: true,
        });
      }
    } catch {
      if (target.epoch !== privateWorkEpochRef.current) return;
      // useTranscription reports the request error. The unverified speech is
      // deliberately not inserted or reconstructed through a cloud fallback.
      if (!snapshotSaved) saveSnapshot(capturedProsody);
    } finally {
      if (recordingTargetRef.current === target) {
        recordingTargetRef.current = null;
      }
    }
  }, [
    audio,
    dispatch,
    prosody,
    realtime,
    recorder,
    recordingDispatch,
    recordingState,
    refinement,
    setRecordingError,
    transcribe,
  ]);

  return (
    <div className="main-panel">
      <Editor
        key={state.activeEntryId ?? 'no-active-entry'}
        drawWaveform={audio.drawWaveform}
        interimTranscript={realtime.liveTranscript}
        isRecording={recordingState.isRecording}
        isTranscribing={
          isTranscribing || realtime.status === 'finalizing'
        }
        onOpenSidebar={onOpenSidebar}
        onProviderChange={setProvider}
        onStart={handleStart}
        onStop={handleStop}
        prosody={prosody}
        provider={provider}
        refinement={refinement}
        startedAt={recordingState.session?.startedAt}
      />
    </div>
  );
}
