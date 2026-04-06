import type { ProsodyDiagnostics } from '../../types/audio';

interface Props {
  prosody: ProsodyDiagnostics;
  isRecording: boolean;
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[11px] text-text-secondary tabular-nums">
        {value}
      </span>
      {unit && (
        <span className="text-[9px] text-text-muted">{unit}</span>
      )}
    </div>
  );
}

export function ProsodyPanel({ prosody, isRecording }: Props) {
  if (!isRecording && prosody.pace === 0) return null;

  return (
    <div className="flex items-center gap-4 py-1">
      <Stat label="pace" value={String(prosody.pace)} unit="wpm" />
      <Stat
        label="energy"
        value={`${(prosody.energy * 100).toFixed(0)}%`}
      />
      <Stat
        label="fluency"
        value={`${(prosody.fluency * 100).toFixed(0)}%`}
      />
      <Stat
        label="density"
        value={`${(prosody.lexicalDensity * 100).toFixed(0)}%`}
      />
    </div>
  );
}
