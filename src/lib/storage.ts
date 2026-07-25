import { STORAGE_KEYS } from '../constants';
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
    return raw ? JSON.parse(raw) : {};
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
