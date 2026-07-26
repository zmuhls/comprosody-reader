import { createStore, set, keys, getMany, delMany } from 'idb-keyval';

const store = createStore('comprosody-audio', 'recordings');

export interface StoredRecording {
  entryId: string;
  recordedAt: number;
  durationMs: number;
  mimeType: string;
  blob: Blob;
}

function recordingKey(entryId: string, recordedAt: number): string {
  return `${entryId}:${recordedAt}`;
}

async function keysForEntry(entryId: string): Promise<string[]> {
  const all = await keys(store);
  const prefix = `${entryId}:`;
  return all.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix));
}

export async function saveRecording(
  entryId: string,
  blob: Blob,
  meta: { recordedAt: number; durationMs: number },
): Promise<void> {
  const recording: StoredRecording = {
    entryId,
    recordedAt: meta.recordedAt,
    durationMs: meta.durationMs,
    mimeType: blob.type || 'audio/webm',
    blob,
  };
  await set(recordingKey(entryId, meta.recordedAt), recording, store);
}

export async function loadRecordings(entryId: string): Promise<StoredRecording[]> {
  const entryKeys = await keysForEntry(entryId);
  if (entryKeys.length === 0) return [];
  const recordings = await getMany<StoredRecording | undefined>(entryKeys, store);
  return recordings
    .filter((r): r is StoredRecording => r !== undefined)
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

export async function deleteRecordings(entryId: string): Promise<void> {
  const entryKeys = await keysForEntry(entryId);
  if (entryKeys.length === 0) return;
  await delMany(entryKeys, store);
}

export async function deleteRecordingsForEntries(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const ids = new Set(entryIds);
  const all = await keys(store);
  const doomed = all.filter(
    (k): k is string => typeof k === 'string' && ids.has(k.slice(0, k.lastIndexOf(':'))),
  );
  if (doomed.length === 0) return;
  await delMany(doomed, store);
}
