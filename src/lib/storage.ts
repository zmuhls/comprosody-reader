import { STORAGE_KEYS } from '../constants';
import type { Entry, Directory } from '../types/editor';
import type { LexiconTerm } from '../types/lexicon';
import type { RefinementSettings } from '../types/llm';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import { countWords } from './entries';

const SCHEMA_VERSION = '3';

/** Sentinel: order not yet assigned; replaced by a per-parent pass in loadEntries. */
const ORDER_UNSET = -1;

export function normalizeEntry(raw: Partial<Entry> & { id: string }): Entry {
  const rawTranscript = raw.rawTranscript ?? '';
  return {
    id: raw.id,
    name: raw.name ?? '',
    parentId: raw.parentId ?? null,
    kind: raw.kind === 'note' ? 'note' : 'writing',
    order:
      typeof raw.order === 'number' && Number.isFinite(raw.order) && raw.order >= 0
        ? raw.order
        : ORDER_UNSET,
    ...(typeof raw.attachedToId === 'string' ? { attachedToId: raw.attachedToId } : {}),
    ...(typeof raw.includeInRefinement === 'boolean'
      ? { includeInRefinement: raw.includeInRefinement }
      : {}),
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

function normalizeDirectory(raw: Partial<Directory> & { id: string }): Directory {
  return {
    id: raw.id,
    name: raw.name ?? '',
    parentId: raw.parentId ?? null,
    kind: raw.kind === 'book' ? 'book' : 'folder',
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
    const entries = Object.fromEntries(
      Object.entries(parsed).map(([id, entry]) => [id, normalizeEntry({ ...entry, id })])
    );

    // v2 → v3: entries carried no order. Assign missing orders per parent,
    // after any existing orders, ranked by name so the migrated tree renders
    // in the same sequence the alphabetical sort produced before.
    const byParent = new Map<string | null, Entry[]>();
    for (const entry of Object.values(entries)) {
      const siblings = byParent.get(entry.parentId) ?? [];
      siblings.push(entry);
      byParent.set(entry.parentId, siblings);
    }
    for (const siblings of byParent.values()) {
      const missing = siblings
        .filter((e) => e.order < 0)
        .sort((a, b) => a.name.localeCompare(b.name));
      let next = siblings.reduce((max, e) => Math.max(max, e.order), -1) + 1;
      for (const entry of missing) {
        entry.order = next++;
      }
    }

    return entries;
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
    const parsed: Record<string, Partial<Directory>> = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(
      Object.entries(parsed).map(([id, dir]) => [id, normalizeDirectory({ ...dir, id })])
    );
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

export function loadLexicon(): Record<string, LexiconTerm> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lexicon);
    return raw ? (JSON.parse(raw) as Record<string, LexiconTerm>) : {};
  } catch {
    return {};
  }
}

export function saveLexicon(lexicon: Record<string, LexiconTerm>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.lexicon, JSON.stringify(lexicon));
  } catch (err) {
    console.warn('failed to persist lexicon', err);
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
