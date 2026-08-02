import type { ProsodyDiagnostics, VoiceConfig } from './audio';

export interface Entry {
  id: string;
  name: string;
  titleSource?: 'manual' | 'agent' | 'fallback';
  titleBasis?: string;
  parentId: string | null;
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
}

export interface Directory {
  id: string;
  name: string;
  parentId: string | null;
}
