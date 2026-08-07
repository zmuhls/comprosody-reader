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
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useTranscription } from '../../hooks/useTranscription';
import { newEntry } from '../../lib/entries';
import { useProsody } from '../../hooks/useProsody';
import { useRefinement } from '../../hooks/useRefinement';
import {
  appendProsodySnapshot,
  appendRecordingTranscript,
} from '../../lib/recordingDocument';
import { completeTranscriptProsody } from '../../lib/comprosody';
import { selectTranscriptionHints } from '../../lib/voiceProfile';
import { SESSION_LOGOUT_INTENT_EVENT } from '../../lib/session';
import { attachTranscript, saveRecording } from '../../lib/audioStore';
import type { TranscriptionProviderId } from '../../types/transcription';
import { Editor } from '../editor/Editor';
import {
  BACKGROUND_RECORDING_LIMIT_KEY,
  DEFAULT_BACKGROUND_RECORDING_LIMIT_MS,
  formatBackgroundRecordingLimit,
  normalizeBackgroundRecordingLimit,
} from '../../lib/backgroundRecording';

interface MainPanelProps {
  onOpenSidebar: (returnFocusTarget?: HTMLElement) => void;
  /** Tags dictation started from here to the book being read. */
  publicationId?: string | null;
}

const PROVIDER_STORAGE_KEY = 'cadence:transcription-provider';

function initialBackgroundRecordingLimit(): number {
  try {
    return normalizeBackgroundRecordingLimit(
      localStorage.getItem(BACKGROUND_RECORDING_LIMIT_KEY),
    );
  } catch {
    return DEFAULT_BACKGROUND_RECORDING_LIMIT_MS;
  }
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
}

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

export function MainPanel({
  onOpenSidebar,
  publicationId = null,
}: MainPanelProps) {
  const { state, dispatch, voiceProfile } = useApp();
  const { state: recordingState, dispatch: recordingDispatch } = useRecording();
  const [provider, setProvider] = useState<TranscriptionProviderId>(initialProvider);
  const [backgroundLimitMs, setBackgroundLimitMs] = useState(
    initialBackgroundRecordingLimit,
  );
  const [backgroundNotice, setBackgroundNotice] = useState('');
  const audio = useAudioAnalyser();
  const recorder = useMediaRecorder();
  const realtime = useRealtimeTranscription();
  // The private default (Faster Whisper) can only transcribe a finished file, so
  // the browser recognizer carries the on-screen stream while it records. Its
  // text is display-only; the batch transcript remains authoritative on stop.
  const speech = useSpeechRecognition();
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
  const handleStartRef = useRef<(entryId?: unknown) => Promise<void>>(
    async () => undefined,
  );
  const handleStopRef = useRef<() => Promise<void>>(async () => undefined);
  const stopInFlightRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);
  const backgroundStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      speech.stop();
      void realtime.cancel();
      audio.stop();
      stopMediaStream(streamRef.current);
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
    speech,
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

  const handleStart = useCallback(async (entryIdOverride?: unknown) => {
    // RecordButton wires this straight to onClick, so the first argument is a
    // MouseEvent unless an explicit entry id was passed. Only a string counts.
    const entryId =
      typeof entryIdOverride === 'string' ? entryIdOverride : activeEntry?.id;
    if (
      !entryId ||
      recordingTargetRef.current ||
      recordingState.isRecording ||
      isTranscribing
    ) {
      return;
    }

    const target: RecordingTarget = {
      entryId,
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
        stopMediaStream(stream);
        return;
      }

      streamRef.current = stream;
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (recordingTargetRef.current !== target) return;
          recorder.checkpoint();
          setBackgroundNotice('Microphone interrupted · saving captured audio');
          void handleStopRef.current();
        };
      });
      recordingDispatch({ type: 'START_RECORDING', startedAt: Date.now() });
      await audio.start(stream);
      recorder.start(stream);
      if (target.provider === 'elevenlabs') {
        void realtime.start(stream, target.keyterms);
      } else {
        speech.start();
      }
    } catch (error) {
      audio.stop();
      stopMediaStream(streamRef.current);
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
    speech,
  ]);

  const handleStop = useCallback(async () => {
    if (!recordingState.isRecording || stopInFlightRef.current) return;
    stopInFlightRef.current = true;

    try {
      const target = recordingTargetRef.current;
      const stoppedAt = Date.now();
      const recordingDurationMs = recordingState.session
        ? Math.max(0, stoppedAt - recordingState.session.startedAt)
        : 0;
      const capturedProsody = { ...prosody };
      const capturedVoiceConfig = { ...recordingState.voiceConfig };
      speech.stop();
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
        if (target.provider === 'elevenlabs') {
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
        stopMediaStream(streamRef.current);
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

      const recordedAt = recordingState.session?.startedAt ?? stoppedAt;
      let takeSaved = false;
      if (audioBlob.size > 0) {
        try {
          await saveRecording(target.entryId, audioBlob, {
            recordedAt,
            durationMs: recordingDurationMs,
          });
          takeSaved = true;
          const entry = stateRef.current.entries[target.entryId];
          if (entry) {
            dispatch({
              type: 'UPDATE_ENTRY',
              id: target.entryId,
              updates: {
                recordedDurationMs:
                  (entry.recordedDurationMs ?? 0) + recordingDurationMs,
                audioTakes: (entry.audioTakes ?? 0) + 1,
              },
              recordHistory: false,
            });
          }
        } catch (error) {
          console.error('Failed to persist recording:', error);
        }
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

        if (takeSaved) {
          void attachTranscript(target.entryId, recordedAt, transcript).catch(
            (error) => console.error('Failed to attach take transcript:', error),
          );
        }

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
    } finally {
      stopInFlightRef.current = false;
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
    speech,
    transcribe,
  ]);

  useLayoutEffect(() => {
    handleStartRef.current = handleStart;
    handleStopRef.current = handleStop;
  }, [handleStart, handleStop]);

  useEffect(() => {
    if (!recordingState.isRecording) {
      if (backgroundStopTimerRef.current) {
        clearTimeout(backgroundStopTimerRef.current);
        backgroundStopTimerRef.current = null;
      }
      backgroundedAtRef.current = null;
      return;
    }

    const startBackgroundGrace = () => {
      if (backgroundedAtRef.current !== null) return;
      backgroundedAtRef.current = Date.now();
      recorder.checkpoint();
      setBackgroundNotice(
        `Recording while away · up to ${formatBackgroundRecordingLimit(backgroundLimitMs)}`,
      );
      backgroundStopTimerRef.current = setTimeout(() => {
        backgroundStopTimerRef.current = null;
        backgroundedAtRef.current = null;
        setBackgroundNotice('Away limit reached · finalizing recording');
        void handleStopRef.current();
      }, backgroundLimitMs);
    };

    const finishBackgroundGrace = () => {
      if (backgroundedAtRef.current === null) return;
      const elapsed = Date.now() - backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (backgroundStopTimerRef.current) {
        clearTimeout(backgroundStopTimerRef.current);
        backgroundStopTimerRef.current = null;
      }
      setBackgroundNotice(
        elapsed >= backgroundLimitMs
          ? 'Away limit reached · finalizing recording'
          : 'Returned · finalizing background recording',
      );
      void handleStopRef.current();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') startBackgroundGrace();
      else finishBackgroundGrace();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', startBackgroundGrace);
    window.addEventListener('pageshow', finishBackgroundGrace);
    if (document.visibilityState === 'hidden') startBackgroundGrace();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', startBackgroundGrace);
      window.removeEventListener('pageshow', finishBackgroundGrace);
      if (backgroundStopTimerRef.current) {
        clearTimeout(backgroundStopTimerRef.current);
        backgroundStopTimerRef.current = null;
      }
    };
  }, [backgroundLimitMs, recorder, recordingState.isRecording]);

  useEffect(() => {
    if (recordingState.isRecording || isTranscribing || realtime.status === 'finalizing') return;
    if (!backgroundNotice) return;
    const timer = setTimeout(() => setBackgroundNotice(''), 2_000);
    return () => clearTimeout(timer);
  }, [backgroundNotice, isTranscribing, realtime.status, recordingState.isRecording]);

  // Dictation should not require picking a destination first. The entry is
  // created, and recording starts on the render that first observes it, so the
  // target is guaranteed to exist by the time the stream opens.
  const pendingDictationRef = useRef<string | null>(null);
  const startNewDictation = useCallback(() => {
    if (recordingState.isRecording || isTranscribing) return;
    const entry = newEntry(null, 'writing', publicationId);
    pendingDictationRef.current = entry.id;
    dispatch({ type: 'CREATE_ENTRY', entry });
  }, [dispatch, isTranscribing, publicationId, recordingState.isRecording]);

  useEffect(() => {
    const pendingId = pendingDictationRef.current;
    if (!pendingId || !state.entries[pendingId]) return;
    pendingDictationRef.current = null;
    void handleStartRef.current(pendingId);
  }, [state.entries]);

  const liveTranscript =
    provider === 'elevenlabs'
      ? realtime.liveTranscript
      : [
          recordingState.session?.finalTranscript ?? '',
          recordingState.session?.interimTranscript ?? '',
        ]
          .filter(Boolean)
          .join(' ');

  const updateBackgroundLimit = useCallback((milliseconds: number) => {
    const normalized = normalizeBackgroundRecordingLimit(milliseconds);
    setBackgroundLimitMs(normalized);
    try {
      localStorage.setItem(BACKGROUND_RECORDING_LIMIT_KEY, String(normalized));
    } catch {
      // The selected limit remains active for this session.
    }
  }, []);

  return (
    <div className="main-panel">
      <Editor
        backgroundLimitMs={backgroundLimitMs}
        backgroundNotice={backgroundNotice}
        key={state.activeEntryId ?? 'no-active-entry'}
        drawWaveform={audio.drawWaveform}
        interimTranscript={liveTranscript}
        isRecording={recordingState.isRecording}
        isTranscribing={
          isTranscribing || realtime.status === 'finalizing'
        }
        onBackgroundLimitChange={updateBackgroundLimit}
        onOpenSidebar={onOpenSidebar}
        onProviderChange={setProvider}
        onStart={handleStart}
        onStartNewDictation={startNewDictation}
        onStop={handleStop}
        publicationId={publicationId}
        prosody={prosody}
        provider={provider}
        refinement={refinement}
        startedAt={recordingState.session?.startedAt}
      />
    </div>
  );
}
