import { createStore, set, get, keys, getMany, delMany } from 'idb-keyval';

const store = createStore('comprosody-audio', 'recordings');

export interface StoredRecording {
  entryId: string;
  recordedAt: number;
  durationMs: number;
  mimeType: string;
  blob: Blob;
  /** Stored at save time so metadata listings never need the blob. */
  byteSize?: number;
  /**
   * The text this take contributed to the entry's raw transcript, exactly as
   * it was appended. Serves as the baseline for detecting user corrections —
   * diffing it against the current transcript isolates what the user changed.
   * Optional so records written before this field keep loading.
   */
  transcript?: string;
}

/** Metadata face of a take — everything the list renders before hydration. */
export interface TakeMeta {
  entryId: string;
  recordedAt: number;
  durationMs: number;
  mimeType: string;
  byteSize: number;
  transcript?: string;
}

export const TAKES_PAGE_SIZE = 10;

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
    byteSize: blob.size,
  };
  await set(recordingKey(entryId, meta.recordedAt), recording, store);
}

/**
 * Metadata for every take of an entry, newest first, without creating object
 * URLs or touching blob contents. Legacy records fall back to blob.size.
 */
export async function listTakeMeta(entryId: string): Promise<TakeMeta[]> {
  const recordings = await loadRecordings(entryId);
  return recordings
    .map((r) => ({
      entryId: r.entryId,
      recordedAt: r.recordedAt,
      durationMs: r.durationMs,
      mimeType: r.mimeType,
      byteSize: r.byteSize ?? r.blob.size,
      ...(r.transcript !== undefined ? { transcript: r.transcript } : {}),
    }))
    .sort((a, b) => b.recordedAt - a.recordedAt);
}

/**
 * Pump a blob through its stream so hydration reports real byte progress —
 * blob.size is known up front, making the bar determinate.
 */
export async function readBlobWithProgress(
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void
): Promise<Blob> {
  const total = blob.size;

  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    if (loaded !== total) onProgress?.(total, total);
    return new Blob(chunks, { type: blob.type });
  }

  // Engines without Blob.stream (jsdom): sliced reads keep progress honest.
  const CHUNK = 262_144;
  const chunks: BlobPart[] = [];
  let loaded = 0;
  while (loaded < total) {
    const end = Math.min(loaded + CHUNK, total);
    chunks.push(await blob.slice(loaded, end).arrayBuffer());
    loaded = end;
    onProgress?.(loaded, total);
  }
  return new Blob(chunks, { type: blob.type });
}

/** Load one take's audio, streaming the read so progress is measurable. */
export async function loadTakeBlob(
  entryId: string,
  recordedAt: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<Blob> {
  const record = await get<StoredRecording | undefined>(
    recordingKey(entryId, recordedAt),
    store
  );
  if (!record) {
    throw new Error('take not found — it may have been deleted');
  }
  const blob = await readBlobWithProgress(record.blob, onProgress);
  return blob.type ? blob : new Blob([blob], { type: record.mimeType });
}

/**
 * Record the text a take produced, once transcription resolves. Separate from
 * saveRecording so the blob is not rewritten, and a no-op when the take is
 * missing (its write may have failed on quota).
 */
export async function attachTranscript(
  entryId: string,
  recordedAt: number,
  transcript: string,
): Promise<void> {
  const key = recordingKey(entryId, recordedAt);
  const existing = await get<StoredRecording | undefined>(key, store);
  if (!existing) return;
  await set(key, { ...existing, transcript }, store);
}

/**
 * Concatenation of every take's contributed text, in recording order, joined
 * the same way appendTranscript joins them. This is what the entry's raw
 * transcript looked like before the user touched it.
 */
export async function loadTranscriptBaseline(entryId: string): Promise<string> {
  const recordings = await loadRecordings(entryId);
  return recordings
    .map((r) => r.transcript?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
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
