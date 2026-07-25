import type { Entry } from '../types/editor';
import type { ProsodyDiagnostics } from '../types/audio';

export const PROSODY_HISTORY_LIMIT = 50;

function appendBlock(existing: string, addition: string): string {
  const current = existing.trimEnd();
  const next = addition.trim();

  if (!current) return next;
  if (!next) return current;
  return `${current}\n\n${next}`;
}

export function appendRecordingTranscript(
  entry: Pick<Entry, 'rawTranscript' | 'refinedText'>,
  transcript: string,
): { rawTranscript: string; documentText: string } {
  const currentDocument = entry.refinedText || entry.rawTranscript;

  return {
    rawTranscript: appendBlock(entry.rawTranscript, transcript),
    documentText: appendBlock(currentDocument, transcript),
  };
}

export function appendProsodySnapshot(
  history: Entry['prosodyHistory'],
  metrics: ProsodyDiagnostics,
  capturedAt: number,
): NonNullable<Entry['prosodyHistory']> {
  return [
    ...(history ?? []),
    { capturedAt, metrics: { ...metrics } },
  ].slice(-PROSODY_HISTORY_LIMIT);
}
