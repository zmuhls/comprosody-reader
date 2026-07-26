import type { ProsodyDiagnostics, VoiceConfig } from './audio';

export interface Entry {
  id: string;
  name: string;
  parentId: string | null;
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
}
