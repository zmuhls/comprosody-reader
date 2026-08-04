import { useEffect, useRef, useState } from 'react';
import { Popover, Select } from 'radix-ui';
import type { ProsodyDiagnostics } from '../../types/audio';
import {
  TRANSCRIPTION_PROVIDERS,
  type TranscriptionProviderId,
} from '../../types/transcription';
import { Icon } from '../ui/Icon';
import { ProsodyPanel } from './ProsodyPanel';
import { RecordButton } from './RecordButton';
import { VoiceConfigToggles } from './VoiceConfigToggles';
import { Waveform } from './Waveform';
import {
  BACKGROUND_RECORDING_LIMITS,
  formatBackgroundRecordingLimit,
} from '../../lib/backgroundRecording';

interface RecordingDockProps {
  backgroundLimitMs: number;
  backgroundNotice: string;
  drawWaveform: (canvas: HTMLCanvasElement, color?: string) => void;
  isRecording: boolean;
  isTranscribing: boolean;
  onProviderChange: (provider: TranscriptionProviderId) => void;
  onBackgroundLimitChange: (milliseconds: number) => void;
  onStart: () => void;
  onStop: () => void;
  prosody: ProsodyDiagnostics;
  provider: TranscriptionProviderId;
  startedAt?: number;
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function RecordingDock({
  backgroundLimitMs,
  backgroundNotice,
  drawWaveform,
  isRecording,
  isTranscribing,
  onProviderChange,
  onBackgroundLimitChange,
  onStart,
  onStop,
  prosody,
  provider,
  startedAt,
}: RecordingDockProps) {
  const [elapsed, setElapsed] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  const optionsTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isRecording || !startedAt) return;
    const update = () => setElapsed(Date.now() - startedAt);
    update();
    const id = window.setInterval(update, 1_000);
    return () => window.clearInterval(id);
  }, [isRecording, startedAt]);

  const providerDetails =
    TRANSCRIPTION_PROVIDERS.find((option) => option.id === provider) ??
    TRANSCRIPTION_PROVIDERS[0];

  const closeRecordingOptions = () => {
    setOptionsOpen(false);
    requestAnimationFrame(() => optionsTriggerRef.current?.focus());
  };

  const toggleRecordingOptions = () => {
    const nextOpen = !optionsOpen;
    setOptionsOpen(nextOpen);
    if (nextOpen) {
      requestAnimationFrame(() => {
        optionsPanelRef.current
          ?.querySelector<HTMLElement>('.provider-trigger')
          ?.focus();
      });
    }
  };

  return (
    <div className="recording-row" data-options-open={optionsOpen}>
      <div className="record-control recording-microphone-control">
        <RecordButton
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          onStart={() => {
            setOptionsOpen(false);
            onStart();
          }}
          onStop={onStop}
        />
      </div>

      <button
        aria-controls="recording-options-panel"
        aria-expanded={optionsOpen}
        aria-label="Recording options"
        className="recording-options-trigger"
        disabled={isRecording || isTranscribing}
        onClick={toggleRecordingOptions}
        ref={optionsTriggerRef}
        title="Recording options"
        type="button"
      >
        <Icon name="settings" size={20} />
      </button>

      <div className="waveform-shell">
        <Waveform drawWaveform={drawWaveform} isRecording={isRecording} />
      </div>

      <time
        className="recording-time"
        dateTime={`PT${Math.floor((isRecording || isTranscribing ? elapsed : 0) / 1_000)}S`}
      >
        {formatElapsed(isRecording || isTranscribing ? elapsed : 0)}
      </time>

      <div
        aria-labelledby="recording-options-heading"
        className="recording-options-panel"
        id="recording-options-panel"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          closeRecordingOptions();
        }}
        ref={optionsPanelRef}
        role="group"
      >
        <strong id="recording-options-heading">Recording options</strong>

        <Select.Root
          disabled={isRecording || isTranscribing}
          onValueChange={(value) =>
            onProviderChange(value as TranscriptionProviderId)
          }
          value={provider}
        >
          <Select.Trigger
            aria-label="Transcription provider"
            className="provider-trigger"
            disabled={isRecording || isTranscribing}
            title={providerDetails.privacy}
          >
            <Select.Value />
            <Select.Icon>
              <Icon name="chevron-down" size={12} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="ui-menu" position="popper" sideOffset={7}>
              <Select.Viewport>
                {TRANSCRIPTION_PROVIDERS.map((option) => (
                  <Select.Item
                    className="ui-menu-item provider-item"
                    key={option.id}
                    value={option.id}
                  >
                    <Select.ItemText>{option.shortLabel}</Select.ItemText>
                    <small>{option.privacy}</small>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>

        <Select.Root
          disabled={isRecording || isTranscribing}
          onValueChange={(value) => onBackgroundLimitChange(Number(value))}
          value={String(backgroundLimitMs)}
        >
          <Select.Trigger
            aria-describedby="background-recording-help"
            aria-label="Background recording limit"
            className="background-limit-trigger"
            disabled={isRecording || isTranscribing}
            title="Best-effort iPhone app-switch recording window"
          >
            away {formatBackgroundRecordingLimit(backgroundLimitMs)}
            <Select.Icon>
              <Icon name="chevron-down" size={12} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content className="ui-menu" position="popper" sideOffset={7}>
              <Select.Viewport>
                {BACKGROUND_RECORDING_LIMITS.map((milliseconds) => (
                  <Select.Item
                    className="ui-menu-item"
                    key={milliseconds}
                    value={String(milliseconds)}
                  >
                    <Select.ItemText>
                      Stop after {formatBackgroundRecordingLimit(milliseconds)} away
                    </Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>

        <Popover.Root>
          <Popover.Trigger className="voice-profile-trigger" type="button">
            Voice profile
            <Icon name="chevron-down" size={12} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              className="ui-popover voice-profile-popover"
              side="top"
              sideOffset={9}
            >
              <div className="popover-heading">
                <div>
                  <strong>Voice profile</strong>
                  <span>Local, derived, and deletable</span>
                </div>
                <Popover.Close className="icon-button" aria-label="Close voice profile">
                  <Icon name="x" size={14} />
                </Popover.Close>
              </div>
              <ProsodyPanel prosody={prosody} />
              <VoiceConfigToggles />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <button
          aria-label="Close recording options"
          className="recording-options-close"
          onClick={closeRecordingOptions}
          type="button"
        >
          Done
        </button>
      </div>

      <span className="sr-only" id="background-recording-help">
        Best effort while this page is away. iOS may pause the page sooner;
        recording finalizes when you return or when this limit is reached.
      </span>

      <span
        aria-atomic="true"
        aria-live="polite"
        className="recording-state-text"
        role="status"
      >
        {backgroundNotice || (isTranscribing
          ? `Transcribing · ${providerDetails.shortLabel}`
          : isRecording
            ? `Listening · ${providerDetails.shortLabel}`
            : `Ready · ${providerDetails.shortLabel}`)}
      </span>
    </div>
  );
}
