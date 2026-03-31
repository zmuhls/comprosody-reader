import { STORAGE_KEYS } from '../constants';
import type { Entry, Directory } from '../types/editor';

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

