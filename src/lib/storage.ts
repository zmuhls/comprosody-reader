import { GENRES, SCALES, STORAGE_KEYS } from '../constants';
import type { Directory, Entry } from '../types/editor';
import type { LexiconTerm } from '../types/lexicon';
import type { RefinementSettings } from '../types/llm';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';
import type { VoiceProfile } from './voiceProfile';
import { migrateVoiceProfile } from './voiceProfile';
import { countWords } from './entries';

const SCHEMA_VERSION = '3';
const ORDER_UNSET = -1;
const FALLBACK_TITLES = new Set(['', 'untitled', 'untitled note', 'new note']);

function normalizedTitleSource(
  value: Entry['titleSource'],
  name: string,
): Entry['titleSource'] {
  if (value === 'manual' || value === 'agent' || value === 'fallback') {
    return value;
  }
  return FALLBACK_TITLES.has(name.trim().toLowerCase()) ? 'fallback' : undefined;
}

export function normalizeEntry(raw: Partial<Entry> & { id: string }): Entry {
  const rawTranscript = typeof raw.rawTranscript === 'string' ? raw.rawTranscript : '';
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled';
  const titleSource = normalizedTitleSource(raw.titleSource, name);

  return {
    id: raw.id,
    name,
    ...(titleSource ? { titleSource } : {}),
    ...(typeof raw.titleBasis === 'string' ? { titleBasis: raw.titleBasis } : {}),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
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
    refinedText: typeof raw.refinedText === 'string' ? raw.refinedText : '',
    prosody: raw.prosody ?? { ...defaultProsody },
    ...(Array.isArray(raw.prosodyHistory)
      ? { prosodyHistory: raw.prosodyHistory }
      : {}),
    voiceConfig: raw.voiceConfig ?? { ...defaultVoiceConfig },
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : Date.now(),
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
    wordCount:
      typeof raw.wordCount === 'number' && Number.isFinite(raw.wordCount)
        ? raw.wordCount
        : countWords(rawTranscript),
    recordedDurationMs:
      typeof raw.recordedDurationMs === 'number' && Number.isFinite(raw.recordedDurationMs)
        ? raw.recordedDurationMs
        : 0,
    audioTakes:
      typeof raw.audioTakes === 'number' && Number.isFinite(raw.audioTakes)
        ? raw.audioTakes
        : 0,
    draftHistory: Array.isArray(raw.draftHistory)
      ? raw.draftHistory.filter((draft): draft is string => typeof draft === 'string')
      : [],
  };
}

export function normalizeDirectory(
  raw: Partial<Directory> & { id: string },
): Directory {
  return {
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled Folder',
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    kind: raw.kind === 'book' ? 'book' : 'folder',
  };
}

export function createDebouncedPersist<T>(
  save: (value: T) => void,
  delayMs = 300,
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
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const entries = Object.fromEntries(
      Object.entries(value as Record<string, Partial<Entry>>).map(([id, entry]) => [
        id,
        normalizeEntry({ ...entry, id }),
      ]),
    );

    const byParent = new Map<string | null, Entry[]>();
    for (const entry of Object.values(entries)) {
      const siblings = byParent.get(entry.parentId) ?? [];
      siblings.push(entry);
      byParent.set(entry.parentId, siblings);
    }
    for (const siblings of byParent.values()) {
      const missing = siblings
        .filter((entry) => entry.order < 0)
        .sort((left, right) => left.name.localeCompare(right.name));
      let next = siblings.reduce((max, entry) => Math.max(max, entry.order), -1) + 1;
      for (const entry of missing) entry.order = next++;
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
  } catch (error) {
    console.warn('failed to persist entries', error);
  }
}

export function loadDirectories(): Record<string, Directory> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.directories);
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, Partial<Directory>>).map(([id, directory]) => [
        id,
        normalizeDirectory({ ...directory, id }),
      ]),
    );
  } catch {
    return {};
  }
}

export function saveDirectories(directories: Record<string, Directory>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.directories, JSON.stringify(directories));
  } catch (error) {
    console.warn('failed to persist directories', error);
  }
}

export function loadLexicon(): Record<string, LexiconTerm> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lexicon);
    const value: unknown = raw ? JSON.parse(raw) : {};
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, LexiconTerm>)
      : {};
  } catch {
    return {};
  }
}

export function saveLexicon(lexicon: Record<string, LexiconTerm>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.lexicon, JSON.stringify(lexicon));
  } catch (error) {
    console.warn('failed to persist lexicon', error);
  }
}

export function loadRefinementSettings(): Partial<RefinementSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const settings: Partial<RefinementSettings> = {};
    if (typeof record.genre === 'string' && GENRES.some(({ value }) => value === record.genre)) {
      settings.genre = record.genre as RefinementSettings['genre'];
    }
    if (typeof record.scale === 'string' && SCALES.some(({ value }) => value === record.scale)) {
      settings.scale = record.scale as RefinementSettings['scale'];
    }
    if (
      typeof record.temperature === 'number' &&
      Number.isFinite(record.temperature) &&
      record.temperature >= 0 &&
      record.temperature <= 1
    ) {
      settings.temperature = record.temperature;
    }
    if (record.mode === 'faithful' || record.mode === 'overhaul') settings.mode = record.mode;
    if (typeof record.highFidelity === 'boolean') {
      settings.highFidelity = record.highFidelity;
    } else if (typeof record.fidelity === 'boolean') {
      settings.highFidelity = record.fidelity;
    }
    if (typeof record.autoRefine === 'boolean') settings.autoRefine = record.autoRefine;
    return settings;
  } catch {
    return {};
  }
}

export function saveRefinementSettings(settings: RefinementSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  } catch (error) {
    console.warn('failed to persist settings', error);
  }
}

export function loadVoiceProfile(): VoiceProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.voiceProfile);
    return raw ? migrateVoiceProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveVoiceProfile(profile: VoiceProfile): void {
  try {
    localStorage.setItem(STORAGE_KEYS.voiceProfile, JSON.stringify(profile));
  } catch (error) {
    console.warn('failed to persist voice profile', error);
  }
}

export function clearVoiceProfile(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.voiceProfile);
  } catch (error) {
    console.warn('failed to clear voice profile', error);
  }
}
