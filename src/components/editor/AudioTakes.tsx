import { useEffect, useState } from 'react';
import { loadRecordings } from '../../lib/audioStore';
import { formatDuration, formatUpdatedAt } from '../../lib/time';

interface Take {
  url: string;
  recordedAt: number;
  durationMs: number;
}

interface Props {
  entryId: string;
  // Bumped by the recorder after each saved take so the list reloads.
  audioTakes?: number;
}

export function AudioTakes({ entryId, audioTakes }: Props) {
  const [loaded, setLoaded] = useState<{ entryId: string; takes: Take[] } | null>(
    null
  );

  useEffect(() => {
    void audioTakes;
    let alive = true;
    const urls: string[] = [];
    loadRecordings(entryId)
      .then((recordings) => {
        if (!alive) return;
        setLoaded({
          entryId,
          takes: recordings.map((recording) => {
            const url = URL.createObjectURL(recording.blob);
            urls.push(url);
            return {
              url,
              recordedAt: recording.recordedAt,
              durationMs: recording.durationMs,
            };
          }),
        });
      })
      .catch((err) => {
        console.error('Failed to load recordings:', err);
      });
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [entryId, audioTakes]);

  const takes = loaded && loaded.entryId === entryId ? loaded.takes : [];
  if (takes.length === 0) return null;

  return (
    <div className="border-b border-border px-5 py-3">
      <div className="text-[10px] uppercase tracking-[0.28em] text-text-muted">
        takes
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {takes.map((take, index) => (
          <div key={take.recordedAt} className="border border-border px-3 py-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-text-secondary">
              <span className="tabular-nums">
                take {index + 1} · {formatDuration(take.durationMs)}
              </span>
              <span className="tabular-nums text-text-muted">
                {formatUpdatedAt(take.recordedAt)}
              </span>
            </div>
            <audio controls src={take.url} className="mt-2 h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
