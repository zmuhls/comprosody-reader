import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import type { Entry } from '../types/editor';
import {
  automaticTitleCandidate,
  fallbackNoteTitle,
  generateAutomaticNoteTitle,
  hasManualNoteTitle,
} from '../lib/noteTitle';

export type AutomaticTitleStatus = 'idle' | 'suggesting' | 'suggested' | 'fallback';

interface TitleAttemptStatus {
  basis: string;
  entryId: string;
  status: Exclude<AutomaticTitleStatus, 'idle'>;
}

const TITLE_IDLE_DELAY_MS = 1_200;
const TITLE_REQUEST_TIMEOUT_MS = 20_000;

export function useAutomaticNoteTitle(
  entry: Entry | null,
  suspended = false,
): AutomaticTitleStatus {
  const { dispatch, storageReady } = useApp();
  const [attemptStatus, setAttemptStatus] = useState<TitleAttemptStatus | null>(null);
  const latestEntryRef = useRef(entry);
  const attemptedBasisRef = useRef(new Map<string, string>());

  const candidate = useMemo(
    () => (entry ? automaticTitleCandidate(entry) : null),
    [entry],
  );
  const entryId = entry?.id ?? null;
  const basis = candidate?.basis ?? null;
  const source = candidate?.source ?? null;
  const manual = entry ? hasManualNoteTitle(entry) : false;

  useEffect(() => {
    latestEntryRef.current = entry;
  }, [entry]);

  useEffect(() => {
    if (!storageReady || !entryId || !basis || !source || manual || suspended) return;
    if (attemptedBasisRef.current.get(entryId) === basis) return;

    const controller = new AbortController();
    let requestTimeout: ReturnType<typeof setTimeout> | null = null;
    let requestTimedOut = false;
    const idleTimer = setTimeout(() => {
      const current = latestEntryRef.current;
      if (
        !current
        || current.id !== entryId
        || hasManualNoteTitle(current)
        || automaticTitleCandidate(current)?.basis !== basis
      ) {
        return;
      }

      attemptedBasisRef.current.set(entryId, basis);
      const fallback = fallbackNoteTitle(source);
      dispatch({
        type: 'UPDATE_ENTRY',
        id: entryId,
        updates: {
          name: fallback,
          titleSource: 'fallback',
          titleBasis: basis,
        },
        recordHistory: false,
      });
      setAttemptStatus({ basis, entryId, status: 'suggesting' });

      requestTimeout = setTimeout(
        () => {
          requestTimedOut = true;
          controller.abort();
        },
        TITLE_REQUEST_TIMEOUT_MS,
      );
      void generateAutomaticNoteTitle(source, controller.signal)
        .then((title) => {
          const latest = latestEntryRef.current;
          if (
            !latest
            || latest.id !== entryId
            || hasManualNoteTitle(latest)
            || automaticTitleCandidate(latest)?.basis !== basis
          ) {
            return;
          }
          dispatch({
            type: 'UPDATE_ENTRY',
            id: entryId,
            updates: {
              name: title,
              titleSource: 'agent',
              titleBasis: basis,
            },
            recordHistory: false,
          });
          setAttemptStatus({ basis, entryId, status: 'suggested' });
        })
        .catch(() => {
          if (requestTimedOut || !controller.signal.aborted) {
            setAttemptStatus({ basis, entryId, status: 'fallback' });
          }
        })
        .finally(() => {
          if (requestTimeout) clearTimeout(requestTimeout);
        });
    }, TITLE_IDLE_DELAY_MS);

    return () => {
      clearTimeout(idleTimer);
      if (requestTimeout) clearTimeout(requestTimeout);
      controller.abort();
    };
  }, [basis, dispatch, entryId, manual, source, storageReady, suspended]);

  if (
    !entryId
    || !basis
    || attemptStatus?.entryId !== entryId
    || attemptStatus.basis !== basis
  ) {
    return 'idle';
  }
  return attemptStatus.status;
}
