/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchSpeechVoices,
  synthesizeSpeech,
} from '../lib/speechApi';
import {
  recordImprovementEvent,
} from '../lib/improvementMetrics';
import type {
  SpeechPlaybackState,
  SpeechVoice,
} from '../types/speech';

const VOICE_KEY = 'cadence:listening-voice:v1';
const SPEED_KEY = 'cadence:listening-speed:v1';
const MIN_SPEED = 0.7;
const MAX_SPEED = 1.2;

interface SpeechContextValue {
  error: string | null;
  hasMoreVoices: boolean;
  loadMoreVoices: () => Promise<void>;
  loadVoices: () => Promise<void>;
  playbackState: SpeechPlaybackState;
  selectedVoiceId: string | null;
  setSelectedVoiceId: (voiceId: string) => void;
  setSpeed: (speed: number) => void;
  speak: (text: string) => Promise<void>;
  speed: number;
  stop: () => void;
  voices: SpeechVoice[];
}

const SpeechContext = createContext<SpeechContextValue | null>(null);

function storedSpeed(): number {
  const value = Number(localStorage.getItem(SPEED_KEY));
  return Number.isFinite(value) && value >= MIN_SPEED && value <= MAX_SPEED
    ? value
    : 1;
}

export function SpeechProvider({ children }: { children: ReactNode }) {
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceIdState] = useState<string | null>(
    () => localStorage.getItem(VOICE_KEY),
  );
  const [speed, setSpeedState] = useState(storedSpeed);
  const [playbackState, setPlaybackState] =
    useState<SpeechPlaybackState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [hasMoreVoices, setHasMoreVoices] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const voicesRequestRef = useRef<Promise<void> | null>(null);

  const releaseAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    releaseAudio();
    setPlaybackState('idle');
  }, [releaseAudio]);

  useEffect(() => stop, [stop]);

  const setSelectedVoiceId = useCallback((voiceId: string) => {
    setSelectedVoiceIdState(voiceId);
    localStorage.setItem(VOICE_KEY, voiceId);
  }, []);

  const setSpeed = useCallback((value: number) => {
    const nextSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
    setSpeedState(nextSpeed);
    localStorage.setItem(SPEED_KEY, String(nextSpeed));
  }, []);

  const loadVoices = useCallback(async () => {
    if (voices.length > 0) return;
    if (voicesRequestRef.current) return voicesRequestRef.current;

    const request = (async () => {
      setPlaybackState('loading-voices');
      setError(null);
      try {
        const page = await fetchSpeechVoices();
        setVoices(page.voices);
        setNextPageToken(page.nextPageToken);
        setHasMoreVoices(page.hasMore);
        setSelectedVoiceIdState((current) => {
          if (current && page.voices.some((voice) => voice.id === current)) {
            return current;
          }
          const firstVoiceId = page.voices[0]?.id ?? null;
          if (firstVoiceId) localStorage.setItem(VOICE_KEY, firstVoiceId);
          return firstVoiceId;
        });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'The voice catalog could not be loaded.',
        );
      } finally {
        setPlaybackState('idle');
        voicesRequestRef.current = null;
      }
    })();

    voicesRequestRef.current = request;
    return request;
  }, [voices.length]);

  const loadMoreVoices = useCallback(async () => {
    if (!nextPageToken || playbackState === 'loading-voices') return;
    setPlaybackState('loading-voices');
    setError(null);
    try {
      const page = await fetchSpeechVoices({ nextPageToken });
      setVoices((current) => {
        const known = new Set(current.map((voice) => voice.id));
        return [
          ...current,
          ...page.voices.filter((voice) => !known.has(voice.id)),
        ];
      });
      setNextPageToken(page.nextPageToken);
      setHasMoreVoices(page.hasMore);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'More voices could not be loaded.',
      );
    } finally {
      setPlaybackState('idle');
    }
  }, [nextPageToken, playbackState]);

  const speak = useCallback(
    async (text: string) => {
      const normalizedText = text.trim();
      if (!normalizedText) {
        setError('There is no text to read yet.');
        return;
      }
      if (!selectedVoiceId) {
        setError('Choose a voice before listening.');
        return;
      }

      stop();
      setPlaybackState('synthesizing');
      setError(null);
      const request = new AbortController();
      requestRef.current = request;
      const metricStartedAt = performance.now();
      let metricRecorded = false;

      try {
        const audioBlob = await synthesizeSpeech({
          signal: request.signal,
          speed,
          text: normalizedText,
          voiceId: selectedVoiceId,
        });
        if (request.signal.aborted) return;
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audioUrlRef.current = audioUrl;
        audio.onended = () => {
          releaseAudio();
          setPlaybackState('idle');
        };
        audio.onerror = () => {
          releaseAudio();
          setError('The generated audio could not be played.');
          setPlaybackState('idle');
        };
        await audio.play();
        void recordImprovementEvent({
          eventType: 'speech_synthesis',
          outcome: 'succeeded',
          provider: 'elevenlabs',
          durationMs: performance.now() - metricStartedAt,
          inputUnits: normalizedText.length,
          speechSpeed: speed,
        });
        metricRecorded = true;
        setPlaybackState('playing');
      } catch (caught) {
        if (!metricRecorded) {
          void recordImprovementEvent({
            eventType: 'speech_synthesis',
            outcome: request.signal.aborted ? 'cancelled' : 'failed',
            provider: 'elevenlabs',
            durationMs: performance.now() - metricStartedAt,
            inputUnits: normalizedText.length,
            speechSpeed: speed,
          });
        }
        if (!request.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Read-aloud could not be generated.',
          );
          setPlaybackState('idle');
        }
      } finally {
        if (requestRef.current === request) requestRef.current = null;
      }
    },
    [releaseAudio, selectedVoiceId, speed, stop],
  );

  const value = useMemo<SpeechContextValue>(
    () => ({
      error,
      hasMoreVoices,
      loadMoreVoices,
      loadVoices,
      playbackState,
      selectedVoiceId,
      setSelectedVoiceId,
      setSpeed,
      speak,
      speed,
      stop,
      voices,
    }),
    [
      error,
      hasMoreVoices,
      loadMoreVoices,
      loadVoices,
      playbackState,
      selectedVoiceId,
      setSelectedVoiceId,
      setSpeed,
      speak,
      speed,
      stop,
      voices,
    ],
  );

  return (
    <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
  );
}

export function useSpeech(): SpeechContextValue {
  const context = useContext(SpeechContext);
  if (!context) throw new Error('useSpeech must be used inside SpeechProvider');
  return context;
}
