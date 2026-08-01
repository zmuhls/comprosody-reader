import { useState, useRef, useEffect } from 'react';
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
    <label className="flex cursor-pointer items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-text-secondary transition-colors select-none hover:text-text-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <div
        className={`relative h-4 w-7 border transition-colors peer-focus-visible:border-border-focus ${
          checked ? 'border-accent bg-accent/15' : 'border-border bg-surface'
        }`}
      >
        <div
          className={`absolute top-[3px] h-2 w-2 transition-transform ${
            checked ? 'translate-x-[15px] bg-accent' : 'translate-x-[3px] bg-text-muted'
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
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const set = (key: string, value: boolean) => {
    dispatch({ type: 'SET_VOICE_CONFIG', config: { [key]: value } });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`border px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors ${
          isOpen
            ? 'border-border-focus bg-surface-overlay text-text-primary'
            : 'border-border-strong bg-surface/65 text-text-secondary hover:border-border-focus hover:text-text-primary'
        }`}
        title="Voice settings"
      >
        voice
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-2 min-w-56 border border-border bg-surface px-4 py-4 shadow-[0_22px_70px_rgba(0,0,0,0.42)]">
          <div className="mb-3 text-[9px] uppercase tracking-[0.22em] text-text-muted">
            voice config
          </div>
          <div className="flex flex-col gap-2.5">
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
        </div>
      )}
    </div>
  );
}
