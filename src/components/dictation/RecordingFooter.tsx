import { useState, useEffect } from 'react';
import type { ProsodyDiagnostics } from '../../types/audio';
import { RecordButton } from './RecordButton';
import { Waveform } from './Waveform';
import { ProsodyPanel } from './ProsodyPanel';
import { VoiceConfigToggles } from './VoiceConfigToggles';

interface Props {
  activeEntryName: string | null;
  isRecording: boolean;
  isTranscribing: boolean;
  isSpeechSupported: boolean;
  recordingError: string | null;
  transcriptionError: string | null;
  canRetryTranscription: boolean;
  prosody: ProsodyDiagnostics;
  sessionStartedAt: number | null;
  liveWordCount: number;
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => () => void;
  onStart: () => void;
  onStop: () => void;
  onRetryTranscription: () => void;
  onUseLiveTranscript: () => void;
}

const retryButtonClass =
  'border border-border px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35';

export function RecordingFooter({
  activeEntryName,
  isRecording,
  isTranscribing,
  isSpeechSupported,
  recordingError,
  transcriptionError,
  canRetryTranscription,
  prosody,
  sessionStartedAt,
  liveWordCount,
  drawWaveform,
  onStart,
  onStop,
  onRetryTranscription,
  onUseLiveTranscript,
}: Props) {
  const [tickNow, setTickNow] = useState(0);

  useEffect(() => {
    if (!isRecording) return;
    const intervalId = window.setInterval(() => setTickNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isRecording]);

  // A stale tick from a previous take is clamped to 0:00 until the first tick.
  const elapsedMs =
    isRecording && sessionStartedAt != null
      ? Math.max(0, tickNow - sessionStartedAt)
      : null;

  const status = isRecording
    ? 'recording live'
    : isTranscribing
      ? 'transcribing take'
      : activeEntryName
        ? 'recorder ready'
        : 'new entry on next take';

  const detail = recordingError
    ? recordingError
    : canRetryTranscription
      ? 'The audio take is saved locally. Retry the upload or keep the live transcript.'
      : transcriptionError
        ? transcriptionError
        : isRecording
          ? 'Pause, cadence, and energy are being read continuously while you speak.'
          : isSpeechSupported
            ? 'Live interim speech is available during capture, then the final take is uploaded for transcription.'
            : 'Live interim speech is unavailable here, but the uploaded take will still be transcribed.';

  return (
    <footer className="relative border-t border-border-strong bg-surface-raised/95 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(217,138,84,0.12),transparent_62%)]" />
        <Waveform
          drawWaveform={drawWaveform}
          isRecording={isRecording}
          className="absolute inset-0 h-full w-full opacity-55"
          color="#d98a54"
        />
      </div>

      <div className="relative flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-4 border border-border-strong bg-surface-overlay/78 px-4 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.22)]">
          <RecordButton
            isRecording={isRecording}
            onStart={onStart}
            onStop={onStop}
            disabled={isTranscribing && !isRecording}
          />

          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-text-secondary">
              recorder
            </div>
            <div className="mt-1 text-sm uppercase tracking-[0.18em] text-text-primary">
              {status}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-accent">
              {isRecording ? 'stop take' : 'start take'}
            </div>
            <div className="mt-1 truncate text-xs text-text-secondary">
              {activeEntryName ?? 'No active entry'}{activeEntryName ? ' active' : ''}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-text-primary/92">
            {detail}
          </p>
          {canRetryTranscription && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="border-l-2 border-hot pl-3 text-xs text-hot">
                {transcriptionError ?? 'transcription failed'}
              </p>
              <button
                onClick={onRetryTranscription}
                disabled={isTranscribing}
                className={retryButtonClass}
              >
                retry upload
              </button>
              <button
                onClick={onUseLiveTranscript}
                disabled={isTranscribing}
                className={retryButtonClass}
              >
                use live transcript
              </button>
            </div>
          )}
          <div className="mt-3">
            <ProsodyPanel
              prosody={prosody}
              isRecording={isRecording}
              elapsedMs={elapsedMs}
              wordCount={liveWordCount}
            />
          </div>
        </div>

        <div className="flex items-center justify-end">
          <VoiceConfigToggles />
        </div>
      </div>
    </footer>
  );
}
