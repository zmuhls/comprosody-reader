import { useEffect, useRef, useState, useCallback } from 'react';
import {
  listTakeMeta,
  loadTakeBlob,
  TAKES_PAGE_SIZE,
  type TakeMeta,
} from '../../lib/audioStore';
import { formatDuration, formatUpdatedAt } from '../../lib/time';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type RowState =
  | { phase: 'meta' }
  | { phase: 'loading'; loaded: number; total: number }
  | { phase: 'ready'; url: string }
  | { phase: 'error'; message: string };

interface TakeRowProps {
  take: TakeMeta;
  index: number;
  totalCount: number;
  log: (line: string) => void;
}

/**
 * One take: renders from metadata alone, hydrates its blob when it nears the
 * viewport (or on demand), and releases the object URL again when it scrolls
 * far away — memory stays flat no matter how long the list gets.
 */
function TakeRow({ take, index, totalCount, log }: TakeRowProps) {
  const [state, setState] = useState<RowState>({ phase: 'meta' });
  const rowRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const hydratingRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const hydrate = useCallback(() => {
    if (hydratingRef.current || stateRef.current.phase === 'ready') return;
    hydratingRef.current = true;
    const startedAt = performance.now();
    setState({ phase: 'loading', loaded: 0, total: take.byteSize });
    loadTakeBlob(take.entryId, take.recordedAt, (loaded, total) => {
      setState({ phase: 'loading', loaded, total });
    })
      .then((blob) => {
        // A URL minted after unmount could never be revoked — the unmount
        // cleanup only sees 'loading', so it would leak until page reload.
        if (!aliveRef.current) return;
        const elapsed = Math.max(1, Math.round(performance.now() - startedAt));
        setState({ phase: 'ready', url: URL.createObjectURL(blob) });
        log(
          `take ${index + 1}/${totalCount} · ${formatBytes(take.byteSize)} · hydrated ${elapsed}ms`
        );
      })
      .catch((err: unknown) => {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'hydration failed',
        });
        log(`take ${index + 1}/${totalCount} · hydration failed`);
      })
      .finally(() => {
        hydratingRef.current = false;
      });
  }, [take, index, totalCount, log]);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    // Hysteresis: hydrate when within 200px, release only beyond 600px,
    // so boundary jitter never thrashes load/release cycles.
    const nearObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) hydrate();
      },
      { rootMargin: '200px 0px' }
    );
    const farObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          const current = stateRef.current;
          if (current.phase === 'ready') {
            URL.revokeObjectURL(current.url);
            setState({ phase: 'meta' });
            log(`take ${index + 1}/${totalCount} · released (offscreen)`);
          }
        }
      },
      { rootMargin: '600px 0px' }
    );
    nearObserver.observe(el);
    farObserver.observe(el);
    return () => {
      nearObserver.disconnect();
      farObserver.disconnect();
    };
  }, [hydrate, index, totalCount, log]);

  // Revoke on unmount (entry switch, page collapse).
  useEffect(() => {
    return () => {
      aliveRef.current = false;
      const current = stateRef.current;
      if (current.phase === 'ready') URL.revokeObjectURL(current.url);
    };
  }, []);

  const pct =
    state.phase === 'loading' && state.total > 0
      ? Math.round((state.loaded / state.total) * 100)
      : 0;

  return (
    <div ref={rowRef} className="border border-border px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-text-secondary">
        <span className="tabular-nums">
          take {totalCount - index} · {formatDuration(take.durationMs)} ·{' '}
          {formatBytes(take.byteSize)}
        </span>
        <span className="tabular-nums text-text-muted">
          {formatUpdatedAt(take.recordedAt)}
        </span>
      </div>

      {state.phase === 'meta' && (
        <button
          onClick={hydrate}
          className="mt-2 flex h-8 w-full items-center justify-center border border-border/70 text-[10px] uppercase tracking-[0.18em] text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
        >
          load audio
        </button>
      )}

      {state.phase === 'loading' && (
        <div
          className="mt-2 flex h-8 items-center gap-2"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`loading take ${totalCount - index}`}
        >
          <div className="h-1 flex-1 bg-border/60">
            <div
              className="h-full bg-accent transition-[width] duration-100"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="w-9 text-right text-[9px] tabular-nums text-text-muted">
            {pct}%
          </span>
        </div>
      )}

      {state.phase === 'ready' && (
        <audio controls src={state.url} className="mt-2 h-8 w-full" />
      )}

      {state.phase === 'error' && (
        <div className="mt-2 flex h-8 items-center gap-3">
          <span className="text-[10px] text-hot">{state.message}</span>
          <button
            onClick={hydrate}
            className="border border-border px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
          >
            retry
          </button>
        </div>
      )}
    </div>
  );
}

interface Props {
  entryId: string;
  // Bumped by the recorder after each saved take so the list reloads.
  audioTakes?: number;
}

export function AudioTakes({ entryId, audioTakes }: Props) {
  const [loaded, setLoaded] = useState<{
    entryId: string;
    takes: TakeMeta[];
  } | null>(null);
  const [visibleCount, setVisibleCount] = useState(TAKES_PAGE_SIZE);
  const [logLines, setLogLines] = useState<string[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const log = useCallback((line: string) => {
    setLogLines((prev) => [...prev, line].slice(-20));
  }, []);

  useEffect(() => {
    void audioTakes;
    let alive = true;
    listTakeMeta(entryId)
      .then((takes) => {
        if (!alive) return;
        setVisibleCount(TAKES_PAGE_SIZE);
        setLoaded({ entryId, takes });
      })
      .catch((err) => {
        console.error('Failed to list takes:', err);
      });
    return () => {
      alive = false;
    };
  }, [entryId, audioTakes]);

  const takes = loaded && loaded.entryId === entryId ? loaded.takes : [];
  const total = takes.length;
  const visible = takes.slice(0, visibleCount);

  // Sentinel reveals the next page as it scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisibleCount((count) => {
          if (count >= total) return count;
          const next = Math.min(count + TAKES_PAGE_SIZE, total);
          log(
            `page ${Math.ceil(next / TAKES_PAGE_SIZE)} · revealed ${next - count} takes`
          );
          return next;
        });
      },
      { rootMargin: '120px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [total, log]);

  if (total === 0) return null;

  return (
    <details className="border-b border-border px-5 py-3">
      <summary className="flex cursor-pointer list-none items-baseline justify-between text-[10px] uppercase tracking-[0.28em] text-text-muted transition-colors hover:text-text-secondary [&::-webkit-details-marker]:hidden">
        <span>takes</span>
        <span className="tabular-nums tracking-[0.18em]">{total}</span>
      </summary>

      <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
        {visible.map((take, index) => (
          <TakeRow
            key={take.recordedAt}
            take={take}
            index={index}
            totalCount={total}
            log={log}
          />
        ))}
        {visibleCount < total && <div ref={sentinelRef} className="h-2" />}
      </div>

      {logLines.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[9px] uppercase tracking-[0.2em] text-text-muted transition-colors hover:text-text-secondary">
            load log ({logLines.length})
          </summary>
          <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[9px] leading-relaxed text-text-muted">
            {logLines.join('\n')}
          </pre>
        </details>
      )}
    </details>
  );
}
