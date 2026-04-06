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
    <label className="flex items-center gap-2 text-[10px] text-text-secondary cursor-pointer hover:text-text-primary transition-colors select-none">
      <div
        className={`w-6 h-3 rounded-full transition-colors relative cursor-pointer ${
          checked ? 'bg-accent' : 'bg-surface-overlay border border-border'
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 w-2 h-2 rounded-full transition-transform ${
            checked ? 'bg-surface translate-x-3.5' : 'bg-text-muted translate-x-0.5'
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
        className={`p-2 rounded-sm transition-colors ${
          isOpen
            ? 'bg-surface-overlay text-text-primary'
            : 'text-text-muted hover:text-text-secondary'
        }`}
        title="Voice settings"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <circle cx="7" cy="7" r="2.5" />
          <path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8l-1.4 1.4M4.2 9.8l-1.4 1.4" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 p-3 bg-surface-raised border border-border rounded shadow-lg z-10 min-w-48">
          <div className="text-[9px] text-text-muted uppercase tracking-wider mb-2">
            voice config
          </div>
          <div className="flex flex-col gap-2">
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
