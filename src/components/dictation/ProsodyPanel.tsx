import type { ProsodyDiagnostics } from '../../types/audio';

interface Props {
  prosody: ProsodyDiagnostics;
}

function Gauge({
  label,
  value,
  max,
  color,
  display,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  display: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-14 text-text-muted text-right shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-12 text-text-secondary text-left shrink-0">
        {display}
      </span>
    </div>
  );
}

export function ProsodyPanel({ prosody }: Props) {
  return (
    <div className="flex flex-col gap-1.5 p-3 bg-surface-raised rounded border border-border">
      <Gauge
        label="pace"
        value={prosody.pace}
        max={250}
        color="var(--color-accent)"
        display={`${prosody.pace} wpm`}
      />
      <Gauge
        label="energy"
        value={prosody.energy}
        max={1}
        color="var(--color-energy)"
        display={`${(prosody.energy * 100).toFixed(0)}%`}
      />
      <Gauge
        label="fluency"
        value={prosody.fluency}
        max={1}
        color="var(--color-success)"
        display={`${(prosody.fluency * 100).toFixed(0)}%`}
      />
      <Gauge
        label="density"
        value={prosody.lexicalDensity}
        max={1}
        color="var(--color-cool)"
        display={`${(prosody.lexicalDensity * 100).toFixed(0)}%`}
      />
    </div>
  );
}
