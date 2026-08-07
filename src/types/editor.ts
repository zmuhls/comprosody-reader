import type { ProsodyDiagnostics, VoiceConfig } from './audio';

export type DirectoryKind = 'folder' | 'book';
export type EntryKind = 'writing' | 'note';

export interface Entry {
  id: string;
  name: string;
  titleSource?: 'manual' | 'agent' | 'fallback';
  titleBasis?: string;
  parentId: string | null;
  kind: EntryKind;
  /** Position within a book; inert inside folders (which sort by name). */
  order: number;
  /** Notes only: the writing entry this note is pinned to. */
  attachedToId?: string;
  /**
   * The publication this entry was written against. Set when the entry is
   * created while a book is open; absent means free-standing writing that
   * belongs to no book and stays reachable from every reading context.
   */
  publicationId?: string;
  /** Notes only: fold this note into refinement context (undefined = true). */
  includeInRefinement?: boolean;
  rawTranscript: string;
  refinedText: string;
  prosody: ProsodyDiagnostics;
  prosodyHistory?: Array<{
    capturedAt: number;
    metrics: ProsodyDiagnostics;
  }>;
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
