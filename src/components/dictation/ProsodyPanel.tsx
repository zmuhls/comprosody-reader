import type { ProsodyDiagnostics } from '../../types/audio';
import { formatDuration } from '../../lib/time';

interface Props {
  prosody: ProsodyDiagnostics;
  isRecording: boolean;
  elapsedMs?: number | null;
  wordCount?: number | null;
}

function Delimiter() {
  return (
    <span className="select-none text-text-muted/40" aria-hidden="true">
      ·
    </span>
  );
}

/** Live prosody as one quiet delimited line — the seal carries the drama. */
export function ProsodyPanel({ prosody, isRecording, elapsedMs, wordCount }: Props) {
  if (!isRecording && prosody.pace === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-text-secondary">
      {isRecording && elapsedMs != null && (
        <>
          <span className="tabular-nums text-text-primary">
            {formatDuration(elapsedMs)}
          </span>
          <Delimiter />
        </>
      )}
      {isRecording && wordCount != null && (
        <>
          <span className="tabular-nums">{wordCount}w</span>
          <Delimiter />
        </>
      )}
      <span className="tabular-nums">{prosody.pace} wpm</span>
      <Delimiter />
      <span className="tabular-nums text-energy">
        energy {(prosody.energy * 100).toFixed(0)}%
      </span>
      <Delimiter />
      <span className="tabular-nums">
        fluency {(prosody.fluency * 100).toFixed(0)}%
      </span>
      <Delimiter />
      <span className="tabular-nums">
        density {(prosody.lexicalDensity * 100).toFixed(0)}%
      </span>
    </div>
  );
}
