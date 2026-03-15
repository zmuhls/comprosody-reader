import { useRecording } from '../../context/RecordingContext';

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
      <div
        className={`w-6 h-3 rounded-full transition-colors relative cursor-pointer ${
          checked ? 'bg-accent' : 'bg-surface-overlay'
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </div>
      <span>{label}</span>
    </label>
  );
}

export function VoiceConfigToggles() {
  const { state, dispatch } = useRecording();
  const { voiceConfig } = state;

  const set = (key: string, value: boolean) => {
    dispatch({ type: 'SET_VOICE_CONFIG', config: { [key]: value } });
  };

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      <Toggle
        label="silences as structure"
        checked={voiceConfig.silencesAsStructure}
        onChange={(v) => set('silencesAsStructure', v)}
      />
      <Toggle
        label="false starts"
        checked={voiceConfig.preserveFalseStarts}
        onChange={(v) => set('preserveFalseStarts', v)}
      />
      <Toggle
        label="fillers"
        checked={voiceConfig.preserveFillers}
        onChange={(v) => set('preserveFillers', v)}
      />
      <Toggle
        label="cadence as guide"
        checked={voiceConfig.cadenceAsGuide}
        onChange={(v) => set('cadenceAsGuide', v)}
      />
    </div>
  );
}
