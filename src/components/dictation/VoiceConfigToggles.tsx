import { Switch } from 'radix-ui';
import { useRecording } from '../../context/RecordingContext';
import type { VoiceConfig } from '../../types/audio';

const OPTIONS: ReadonlyArray<{ key: keyof VoiceConfig; label: string }> = [
  { key: 'silencesAsStructure', label: 'Silences mark structure' },
  { key: 'preserveFalseStarts', label: 'Preserve meaningful false starts' },
  { key: 'preserveFillers', label: 'Preserve meaningful fillers' },
  { key: 'cadenceAsGuide', label: 'Use cadence as a sentence guide' },
];

export function VoiceConfigToggles() {
  const { state, dispatch } = useRecording();

  return (
    <div className="voice-config-list">
      {OPTIONS.map((option) => (
        <label key={option.key}>
          <span>{option.label}</span>
          <Switch.Root
            checked={state.voiceConfig[option.key]}
            className="mini-switch"
            onCheckedChange={(checked) =>
              dispatch({
                type: 'SET_VOICE_CONFIG',
                config: { [option.key]: checked },
              })
            }
          >
            <Switch.Thumb className="mini-switch-thumb" />
          </Switch.Root>
        </label>
      ))}
    </div>
  );
}
