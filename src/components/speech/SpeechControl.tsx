import { useMemo, useState } from 'react';
import { Popover, Tooltip } from 'radix-ui';
import { useSpeech } from '../../context/SpeechContext';
import type { SpeechVoice } from '../../types/speech';
import { Icon } from '../ui/Icon';

interface SpeechControlProps {
  getText: () => string;
  label: string;
  side?: 'bottom' | 'left' | 'right' | 'top';
}

function searchableVoiceText(voice: SpeechVoice): string {
  return [
    voice.name,
    voice.category,
    voice.description,
    ...Object.values(voice.labels),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}

function voiceDetails(voice: SpeechVoice): string {
  const details = [
    voice.labels.accent,
    voice.labels.gender,
    voice.labels.age,
    voice.labels.use_case,
    voice.category,
  ].filter((value, index, list) => value && list.indexOf(value) === index);
  return details.slice(0, 3).join(' · ') || 'ElevenLabs voice';
}

export function SpeechControl({
  getText,
  label,
  side = 'bottom',
}: SpeechControlProps) {
  const {
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
  } = useSpeech();
  const [search, setSearch] = useState('');
  const isActive =
    playbackState === 'playing' || playbackState === 'synthesizing';
  const filteredVoices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return voices;
    return voices.filter((voice) => searchableVoiceText(voice).includes(query));
  }, [search, voices]);

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) void loadVoices();
      }}
    >
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Popover.Trigger
            aria-label={label}
            aria-pressed={isActive}
            className="icon-button speech-trigger"
            type="button"
          >
            <Icon name={isActive ? 'stop' : 'volume'} size={16} />
          </Popover.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="ui-tooltip" sideOffset={7}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <Popover.Portal>
        <Popover.Content
          align="end"
          className="ui-popover speech-popover"
          collisionPadding={10}
          side={side}
          sideOffset={8}
        >
          <div className="popover-heading speech-heading">
            <div>
              <strong>Listening</strong>
              <span>
                {voices.length > 0
                  ? `${voices.length} voices available`
                  : 'ElevenLabs read-aloud'}
              </span>
            </div>
            <Popover.Close className="icon-button" aria-label="Close listening controls">
              <Icon name="x" size={14} />
            </Popover.Close>
          </div>

          <label className="speech-search">
            <Icon name="search" size={13} />
            <span className="sr-only">Search voices</span>
            <input
              aria-label="Search voices"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, accent, or style"
              type="search"
              value={search}
            />
          </label>

          <div
            aria-label="Available voices"
            className="speech-voice-list"
            role="listbox"
          >
            {playbackState === 'loading-voices' && voices.length === 0 ? (
              <p>Loading the voice catalog…</p>
            ) : null}
            {filteredVoices.map((voice) => (
              <button
                aria-selected={selectedVoiceId === voice.id}
                className="speech-voice-option"
                key={voice.id}
                onClick={() => setSelectedVoiceId(voice.id)}
                role="option"
                type="button"
              >
                <span>{voice.name}</span>
                <small>{voiceDetails(voice)}</small>
                {selectedVoiceId === voice.id ? (
                  <Icon name="check" size={13} />
                ) : null}
              </button>
            ))}
            {voices.length > 0 && filteredVoices.length === 0 ? (
              <p>No voices match “{search}”.</p>
            ) : null}
          </div>

          {hasMoreVoices ? (
            <button
              className="speech-load-more"
              disabled={playbackState === 'loading-voices'}
              onClick={() => void loadMoreVoices()}
              type="button"
            >
              {playbackState === 'loading-voices'
                ? 'Loading more…'
                : 'Load more voices'}
            </button>
          ) : null}

          <div className="speech-speed">
            <span>
              Pace <output>{speed.toFixed(2)}×</output>
            </span>
            <span
              aria-label="Listening pace presets"
              className="speech-speed-presets"
              role="group"
            >
              {[0.75, 0.9, 1, 1.1, 1.2].map((preset) => (
                <button
                  aria-pressed={speed === preset}
                  key={preset}
                  onClick={() => setSpeed(preset)}
                  type="button"
                >
                  {preset.toFixed(preset === 1 ? 1 : 2)}×
                </button>
              ))}
            </span>
            <input
              aria-label="Listening pace"
              max="1.2"
              min="0.7"
              onInput={(event) =>
                setSpeed(Number((event.target as HTMLInputElement).value))
              }
              step="0.05"
              type="range"
              value={speed}
            />
            <span className="speech-speed-scale" aria-hidden="true">
              <small>0.70×</small>
              <small>1.20×</small>
            </span>
          </div>

          {error ? (
            <p className="speech-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="speech-primary-action"
            disabled={!selectedVoiceId && !isActive}
            onClick={() => {
              if (isActive) stop();
              else void speak(getText());
            }}
            type="button"
          >
            <Icon name={isActive ? 'stop' : 'play'} size={14} />
            {playbackState === 'synthesizing'
              ? 'Preparing audio…'
              : playbackState === 'playing'
                ? 'Stop'
                : 'Listen'}
          </button>
          <Popover.Arrow className="speech-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
