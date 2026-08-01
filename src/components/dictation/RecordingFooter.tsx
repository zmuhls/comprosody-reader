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
  onStartNote: () => void;
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
  onStartNote,
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
    ? 'recording'
    : isTranscribing
      ? 'transcribing…'
      : 'ready';

  const statusDetail = isRecording
    ? null
    : !isSpeechSupported
      ? 'no live captions here — the take still transcribes on stop'
      : null;

  const hasProblem = recordingError !== null || canRetryTranscription;

  return (
    <footer className="relative border-t border-border-strong bg-surface-raised/95 backdrop-blur-md">
      {/* The breath line: one filament across the console, threaded through
          the seal. Idle it embers; recording it becomes the live stroke. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <Waveform
          drawWaveform={drawWaveform}
          isRecording={isRecording}
          className="absolute inset-0 h-full w-full opacity-70"
          color="#d98a54"
        />
      </div>

      <div className="relative flex min-h-[72px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <RecordButton
          isRecording={isRecording}
          onStart={onStart}
          onStop={onStop}
          disabled={isTranscribing && !isRecording}
          energy={isRecording ? prosody.energy : 0}
        />

        <div className="min-w-0">
          <div
            className={`text-[11px] uppercase tracking-[0.2em] ${
              isRecording ? 'text-recording' : 'text-text-primary'
            }`}
          >
            {status}
          </div>
          <div className="mt-0.5 max-w-48 truncate text-[10px] uppercase tracking-[0.14em] text-text-muted">
            {statusDetail ?? activeEntryName ?? 'new entry'}
          </div>
        </div>

        <button
          onClick={onStartNote}
          disabled={isRecording || isTranscribing}
          className="px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35"
          title="record a vocal note"
        >
          + note
        </button>

        <div className="min-w-4 flex-1" />

        <ProsodyPanel
          prosody={prosody}
          isRecording={isRecording}
          elapsedMs={elapsedMs}
          wordCount={liveWordCount}
        />

        <VoiceConfigToggles />
      </div>

      {hasProblem && (
        <div className="relative flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          <p className="border-l-2 border-hot pl-3 text-xs text-hot">
            {recordingError ??
              transcriptionError ??
              'transcription failed — the audio take is saved locally'}
          </p>
          {canRetryTranscription && (
            <>
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
            </>
          )}
        </div>
      )}
    </footer>
  );
}
