import { GENRES, SCALES, STORAGE_KEYS } from '../constants';
import type { Entry, Directory } from '../types/editor';
import type { RefinementSettings } from '../types/llm';
import type { VoiceProfile } from './voiceProfile';
import { migrateVoiceProfile } from './voiceProfile';

export function loadEntries(): Record<string, Entry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.entries);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveEntries(entries: Record<string, Entry>): void {
  localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
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
  localStorage.setItem(STORAGE_KEYS.directories, JSON.stringify(dirs));
}

export function loadRefinementSettings(): Partial<RefinementSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const record = parsed as Record<string, unknown>;
    const settings: Partial<RefinementSettings> = {};

    if (
      typeof record.genre === 'string' &&
      GENRES.some(({ value }) => value === record.genre)
    ) {
      settings.genre = record.genre as RefinementSettings['genre'];
    }
    if (
      typeof record.scale === 'string' &&
      SCALES.some(({ value }) => value === record.scale)
    ) {
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
    if (record.mode === 'faithful' || record.mode === 'overhaul') {
      settings.mode = record.mode;
    }
    if (typeof record.highFidelity === 'boolean') {
      settings.highFidelity = record.highFidelity;
    } else if (typeof record.fidelity === 'boolean') {
      // Early builds stored this setting without the "high" prefix.
      settings.highFidelity = record.fidelity;
    }
    if (typeof record.autoRefine === 'boolean') {
      settings.autoRefine = record.autoRefine;
    }

    return settings;
  } catch {
    return {};
  }
}

export function saveRefinementSettings(settings: RefinementSettings): void {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

/**
 * Loads the device-local, versioned voice profile. Invalid or future schemas are
 * ignored so callers can safely rebuild from the canonical entry store.
 */
export function loadVoiceProfile(): VoiceProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.voiceProfile);
    return raw ? migrateVoiceProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveVoiceProfile(profile: VoiceProfile): void {
  localStorage.setItem(STORAGE_KEYS.voiceProfile, JSON.stringify(profile));
}

export function clearVoiceProfile(): void {
  localStorage.removeItem(STORAGE_KEYS.voiceProfile);
}
