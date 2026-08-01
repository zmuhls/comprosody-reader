import type { ProsodyDiagnostics, VoiceConfig } from './audio';

export type DirectoryKind = 'folder' | 'book';
export type EntryKind = 'writing' | 'note';

export interface Entry {
  id: string;
  name: string;
  parentId: string | null;
  kind: EntryKind;
  /** Position within a book; inert inside folders (which sort by name). */
  order: number;
  /** Notes only: the writing entry this note is pinned to. */
  attachedToId?: string;
  /** Notes only: fold this note into refinement context (undefined = true). */
  includeInRefinement?: boolean;
  rawTranscript: string;
  refinedText: string;
  prosody: ProsodyDiagnostics;
  voiceConfig: VoiceConfig;
  createdAt: number;
  updatedAt: number;
  wordCount?: number;
  recordedDurationMs?: number;
  audioTakes?: number;
  draftHistory?: string[];
}

export interface Directory {
  id: string;
  name: string;
  parentId: string | null;
  kind: DirectoryKind;
}
