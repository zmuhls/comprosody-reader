import { STORAGE_KEYS } from '../constants';
import type { Entry, Directory } from '../types/editor';
import type { RefinementSettings } from '../types/llm';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import { countWords } from './entries';

const SCHEMA_VERSION = '2';

export function normalizeEntry(raw: Partial<Entry> & { id: string }): Entry {
  const rawTranscript = raw.rawTranscript ?? '';
  return {
    id: raw.id,
    name: raw.name ?? '',
    parentId: raw.parentId ?? null,
    rawTranscript,
    refinedText: raw.refinedText ?? '',
    prosody: raw.prosody ?? defaultProsody,
    voiceConfig: raw.voiceConfig ?? defaultVoiceConfig,
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? Date.now(),
    wordCount: raw.wordCount ?? countWords(rawTranscript),
    recordedDurationMs: raw.recordedDurationMs ?? 0,
    audioTakes: raw.audioTakes ?? 0,
    draftHistory: raw.draftHistory ?? [],
  };
}

export function createDebouncedPersist<T>(
  save: (value: T) => void,
  delayMs = 300
): { schedule: (value: T) => void; flush: () => void; cancel: () => void } {
  let pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(value: T) {
      pending = value;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (pending !== undefined) {
          save(pending);
          pending = undefined;
        }
      }, delayMs);
    },
    flush() {
      clearTimer();
      if (pending !== undefined) {
        save(pending);
        pending = undefined;
      }
    },
    cancel() {
      clearTimer();
      pending = undefined;
    },
  };
}

export function loadEntries(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.entries);
    const parsed: Record<string, Partial<Entry>> = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, entry]) => [id, normalizeEntry({ ...entry, id })])
    );
  } catch {
    return {};
  }
}

export function saveEntries(entries: Record<string, Entry>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
    localStorage.setItem(STORAGE_KEYS.schemaVersion, SCHEMA_VERSION);
  } catch (err) {
    console.warn('failed to persist entries', err);
  }
}

export function loadDirectories(): Record<string, Directory> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.directories);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDirectories(dirs: Record<string, Directory>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.directories, JSON.stringify(dirs));
  } catch (err) {
    console.warn('failed to persist directories', err);
  }
}

export function loadRefinementSettings(): RefinementSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    return raw ? (JSON.parse(raw) as RefinementSettings) : null;
  } catch {
    return null;
  }
}

export function saveRefinementSettings(settings: RefinementSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch (err) {
    console.warn('failed to persist settings', err);
  }
}
