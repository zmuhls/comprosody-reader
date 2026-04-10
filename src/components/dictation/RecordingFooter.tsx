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
  prosody: ProsodyDiagnostics;
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
  onStart: () => void;
  onStop: () => void;
}

export function RecordingFooter({
  activeEntryName,
  isRecording,
  isTranscribing,
  isSpeechSupported,
  recordingError,
  transcriptionError,
  prosody,
  drawWaveform,
  onStart,
  onStop,
}: Props) {
  const status = isRecording
    ? 'recording live'
    : isTranscribing
      ? 'transcribing take'
      : activeEntryName
        ? 'recorder ready'
        : 'new entry on next take';

  const detail = recordingError
    ? recordingError
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
          <div className="mt-3">
            <ProsodyPanel prosody={prosody} isRecording={isRecording} />
          </div>
        </div>

        <div className="flex items-center justify-end">
          <VoiceConfigToggles />
        </div>
      </div>
    </footer>
  );
}
