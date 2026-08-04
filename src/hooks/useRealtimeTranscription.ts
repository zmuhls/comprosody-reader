import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RealtimeConnection } from '@elevenlabs/client';
import { useApp } from '../context/AppContext';
import {
  recordImprovementEvent,
  wordCount,
} from '../lib/improvementMetrics';
import { cadenceApiUrl } from '../lib/urls';

const REALTIME_SAMPLE_RATE = 16_000;
const REALTIME_MODEL_ID = 'scribe_v2_realtime';
const FINAL_COMMIT_WAIT_MS = 900;
const MAX_REALTIME_KEYTERMS = 50;
const MAX_REALTIME_KEYTERM_CHARACTERS = 20;

export type RealtimeTranscriptionStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'degraded'
  | 'finalizing';

interface ActiveRealtimeSession {
  committedEventCount: number;
  connected: boolean;
  degraded: boolean;
  epoch: number;
  finalCommitConfirmation: {
    baselineEventCount: number;
    settle: (confirmed: boolean) => void;
  } | null;
  keytermCount: number;
  startedAt: number;
  stopping: boolean;
  stream: MediaStream;
  tokenController: AbortController;
}

export interface RealtimeStopResult {
  shouldFallback: boolean;
  transcript: string;
}

interface RealtimeTokenResponse {
  token?: unknown;
  expiresInSeconds?: unknown;
}

interface CaptureNodes {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  silentGain: GainNode;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Live transcription could not be started.';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function awaitPostCommitConfirmation(
  session: ActiveRealtimeSession,
  commit: () => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (session.finalCommitConfirmation?.settle === settle) {
        session.finalCommitConfirmation = null;
      }
      resolve(confirmed);
    };
    const timeoutId = window.setTimeout(
      () => settle(false),
      FINAL_COMMIT_WAIT_MS,
    );

    session.finalCommitConfirmation = {
      baselineEventCount: session.committedEventCount,
      settle,
    };
    try {
      commit();
    } catch {
      session.degraded = true;
      settle(false);
    }
  });
}

export function selectRealtimeKeyterms(
  keyterms: readonly string[],
): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const value of keyterms) {
    if (selected.length >= MAX_REALTIME_KEYTERMS) break;
    const normalized = Array.from(value.normalize('NFKC').trim())
      .slice(0, MAX_REALTIME_KEYTERM_CHARACTERS)
      .join('')
      .replace(/\s+/gu, ' ');
    if (!normalized) continue;
    const identity = normalized.toLocaleLowerCase('en-US');
    if (seen.has(identity)) continue;
    seen.add(identity);
    selected.push(normalized);
  }

  return selected;
}

async function requestRealtimeToken(
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(
    cadenceApiUrl('/transcribe/realtime-token'),
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    },
  );
  const payload = (await response.json().catch(() => ({}))) as
    RealtimeTokenResponse & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : `Live transcription unavailable (${response.status}).`,
    );
  }
  if (
    typeof payload.token !== 'string' ||
    payload.token.length < 16 ||
    payload.token.length > 8_192
  ) {
    throw new Error('Live transcription returned an invalid session token.');
  }
  return payload.token;
}

export function useRealtimeTranscription() {
  const { dispatch: appDispatch } = useApp();
  const [status, setStatus] =
    useState<RealtimeTranscriptionStatus>('idle');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [committedTranscript, setCommittedTranscript] = useState('');
  const [liveError, setLiveError] = useState<string | null>(null);
  const epochRef = useRef(0);
  const activeRef = useRef<ActiveRealtimeSession | null>(null);
  const captureRef = useRef<CaptureNodes | null>(null);
  const connectionRef = useRef<RealtimeConnection | null>(null);
  const committedPartsRef = useRef<string[]>([]);
  const partialRef = useRef('');
  const startCaptureRef = useRef<
    ((session: ActiveRealtimeSession) => Promise<void>) | null
  >(null);

  const stopCapture = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) return;
    capture.worklet.port.onmessage = null;
    capture.worklet.disconnect();
    capture.source.disconnect();
    capture.silentGain.disconnect();
    await capture.context.close().catch(() => undefined);
  }, []);

  const reportLiveFailure = useCallback(
    (error: unknown) => {
      const active = activeRef.current;
      if (!active || active.stopping || active.degraded) return;
      active.degraded = true;
      const message = errorMessage(error);
      setLiveError(message);
      setStatus('degraded');
      void stopCapture();
    },
    [stopCapture],
  );

  useEffect(
    () => () => {
      const active = activeRef.current;
      if (active) {
        active.stopping = true;
        active.tokenController.abort();
        active.finalCommitConfirmation?.settle(false);
      }
      void stopCapture();
      connectionRef.current?.close();
      connectionRef.current = null;
      activeRef.current = null;
    },
    [stopCapture],
  );

  const startCapture = useCallback(
    async (session: ActiveRealtimeSession) => {
      if (
        activeRef.current !== session ||
        session.stopping ||
        session.degraded
      ) {
        return;
      }
      await stopCapture();
      const context = new AudioContext();
      await context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}cadence-pcm-processor.js`,
      );
      if (
        activeRef.current !== session ||
        session.stopping ||
        session.degraded
      ) {
        await context.close();
        return;
      }
      const source = context.createMediaStreamSource(session.stream);
      const worklet = new AudioWorkletNode(
        context,
        'cadence-pcm-processor',
        {
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: {
            frameDurationSeconds: 0.1,
            targetSampleRate: REALTIME_SAMPLE_RATE,
          },
        },
      );
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (
          activeRef.current !== session ||
          session.stopping ||
          session.degraded
        ) {
          return;
        }
        try {
          connectionRef.current?.send({
            audioBase64: arrayBufferToBase64(event.data),
            sampleRate: REALTIME_SAMPLE_RATE,
          });
        } catch (error) {
          reportLiveFailure(error);
        }
      };
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);
      captureRef.current = { context, source, worklet, silentGain };
      await context.resume();
    },
    [reportLiveFailure, stopCapture],
  );
  useEffect(() => {
    startCaptureRef.current = startCapture;
  }, [startCapture]);

  const start = useCallback(
    async (
      stream: MediaStream,
      keyterms: readonly string[],
    ): Promise<boolean> => {
      const previous = activeRef.current;
      if (previous) {
        previous.stopping = true;
        previous.tokenController.abort();
        previous.finalCommitConfirmation?.settle(false);
        connectionRef.current?.close();
        connectionRef.current = null;
        await stopCapture();
      }

      const selectedKeyterms = selectRealtimeKeyterms(keyterms);
      const tokenController = new AbortController();
      const session: ActiveRealtimeSession = {
        committedEventCount: 0,
        connected: false,
        degraded: false,
        epoch: ++epochRef.current,
        finalCommitConfirmation: null,
        keytermCount: selectedKeyterms.length,
        startedAt: performance.now(),
        stopping: false,
        stream,
        tokenController,
      };
      activeRef.current = session;
      committedPartsRef.current = [];
      partialRef.current = '';
      setCommittedTranscript('');
      setPartialTranscript('');
      setLiveError(null);
      setStatus('connecting');

      try {
        const [token, client] = await Promise.all([
          requestRealtimeToken(tokenController.signal),
          import('@elevenlabs/client'),
        ]);
        if (activeRef.current !== session || session.stopping) return false;
        const connection = client.Scribe.connect({
          audioFormat: client.AudioFormat.PCM_16000,
          // Manual commit makes the one post-stop committed event causally
          // attributable to our final commit. VAD can have an older commit in
          // flight and therefore cannot provide a lossless completion gate.
          commitStrategy: client.CommitStrategy.MANUAL,
          keyterms: selectedKeyterms,
          modelId: REALTIME_MODEL_ID,
          sampleRate: REALTIME_SAMPLE_RATE,
          token,
        });
        connectionRef.current = connection;
        connection.on(client.RealtimeEvents.SESSION_STARTED, () => {
          if (activeRef.current !== session || session.stopping) return;
          session.connected = true;
          setStatus('streaming');
          void startCaptureRef.current?.(session).catch(reportLiveFailure);
        });
        connection.on(
          client.RealtimeEvents.PARTIAL_TRANSCRIPT,
          ({ text }) => {
            if (activeRef.current !== session || session.stopping) return;
            partialRef.current = text;
            setPartialTranscript(text);
          },
        );
        connection.on(
          client.RealtimeEvents.COMMITTED_TRANSCRIPT,
          ({ text }) => {
            if (activeRef.current !== session) return;
            session.committedEventCount += 1;
            const normalized = text.trim();
            if (normalized) {
              committedPartsRef.current.push(normalized);
              partialRef.current = '';
              setPartialTranscript('');
              setCommittedTranscript(
                committedPartsRef.current.join(' '),
              );
            }
            const confirmation = session.finalCommitConfirmation;
            if (
              confirmation &&
              session.committedEventCount >
                confirmation.baselineEventCount
            ) {
              confirmation.settle(true);
            }
          },
        );
        connection.on(client.RealtimeEvents.ERROR, ({ error }) => {
          if (activeRef.current !== session) return;
          reportLiveFailure(new Error(error));
        });
        connection.on(client.RealtimeEvents.CLOSE, () => {
          if (
            activeRef.current !== session ||
            session.stopping
          ) {
            return;
          }
          reportLiveFailure(
            new Error(
              'Live preview paused. The complete recording remains available for final transcription.',
            ),
          );
        });
        return true;
      } catch (error) {
        if (tokenController.signal.aborted) return false;
        reportLiveFailure(error);
        return false;
      }
    },
    [reportLiveFailure, stopCapture],
  );

  const stop = useCallback(async (): Promise<RealtimeStopResult> => {
    const session = activeRef.current;
    if (!session) {
      return { shouldFallback: true, transcript: '' };
    }

    session.stopping = true;
    setStatus('finalizing');
    session.tokenController.abort();
    await stopCapture();

    let finalCommitConfirmed = false;
    if (session.connected && !session.degraded) {
      const connection = connectionRef.current;
      if (connection) {
        finalCommitConfirmed = await awaitPostCommitConfirmation(
          session,
          () => connection.commit(),
        );
      } else {
        session.degraded = true;
      }
    }

    const transcript = committedPartsRef.current.join(' ').trim();
    const shouldFallback =
      session.degraded ||
      !session.connected ||
      !finalCommitConfirmed ||
      !transcript;
    connectionRef.current?.close();
    connectionRef.current = null;
    if (activeRef.current === session) activeRef.current = null;
    partialRef.current = '';
    setPartialTranscript('');
    setStatus('idle');

    if (!shouldFallback) {
      void recordImprovementEvent({
        eventType: 'transcription',
        outcome: 'succeeded',
        provider: 'elevenlabs',
        durationMs: performance.now() - session.startedAt,
        outputUnits: wordCount(transcript),
        keytermCount: session.keytermCount,
      });
    } else {
      void recordImprovementEvent({
        eventType: 'transcription',
        outcome: 'failed',
        provider: 'elevenlabs',
        durationMs: performance.now() - session.startedAt,
        keytermCount: session.keytermCount,
      });
    }

    return { shouldFallback, transcript };
  }, [stopCapture]);

  const cancel = useCallback(async () => {
    const session = activeRef.current;
    if (session) {
      session.stopping = true;
      session.tokenController.abort();
      session.finalCommitConfirmation?.settle(false);
    }
    await stopCapture();
    connectionRef.current?.close();
    connectionRef.current = null;
    activeRef.current = null;
    committedPartsRef.current = [];
    partialRef.current = '';
    setCommittedTranscript('');
    setPartialTranscript('');
    setStatus('idle');
  }, [stopCapture]);

  const liveTranscript = useMemo(
    () =>
      [committedTranscript, partialTranscript]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' '),
    [committedTranscript, partialTranscript],
  );

  const surfaceError = useCallback(() => {
    if (!liveError) return;
    appDispatch({
      type: 'SET_ERROR',
      error: {
        id: crypto.randomUUID(),
        message: liveError,
        type: 'transcription',
      },
    });
  }, [appDispatch, liveError]);

  return {
    cancel,
    liveError,
    liveTranscript,
    status,
    start,
    stop,
    surfaceError,
  };
}

export type RealtimeTranscriptionController = ReturnType<
  typeof useRealtimeTranscription
>;
