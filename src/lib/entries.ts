import type {
  Directory,
  DirectoryKind,
  Entry,
  EntryKind,
} from '../types/editor';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';

/**
 * Pure node factories. They live outside AppContext so modules that only need
 * to mint an entry (recording, quick-create) can import them without pulling in
 * React context.
 */
export function newEntry(
  parentId: string | null,
  kind: EntryKind = 'writing',
  publicationId?: string | null,
): Entry {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    titleSource: 'fallback',
    parentId,
    kind,
    ...(publicationId ? { publicationId } : {}),
    order: 0,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: 0,
    recordedDurationMs: 0,
    audioTakes: 0,
    draftHistory: [],
  };
}

export function newDirectory(
  parentId: string | null,
  name: string,
  kind: DirectoryKind = 'folder',
): Directory {
  return {
    id: crypto.randomUUID(),
    name,
    parentId,
    kind,
  };
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countParagraphs(text: string): number {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.length;
}

export function deriveEntryName(text: string, fallback = 'Untitled'): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;

  const firstThought = cleaned.split(/(?<=[.!?])\s+|\n/)[0] ?? cleaned;
  const normalized = firstThought.replace(/^[^A-Za-z0-9]+/, '').trim();
  const title = normalized
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .replace(/[.,;:!?-]+$/, '')
    .trim();

  if (!title) return fallback;

  return title[0].toUpperCase() + title.slice(1);
}
