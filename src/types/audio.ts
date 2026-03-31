export interface ProsodyDiagnostics {
  pace: number;
  energy: number;
  fluency: number;
  lexicalDensity: number;
}

export interface VoiceConfig {
  silencesAsStructure: boolean;
  preserveFalseStarts: boolean;
  preserveFillers: boolean;
  cadenceAsGuide: boolean;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface RecordingSession {
  startedAt: number;
  interimTranscript: string;
  finalTranscript: string;
  wordTimestamps: WordTimestamp[];
  pauses: Array<{ start: number; end: number }>;
  volumeSamples: number[];
  audioBlob: Blob | null;
}

export const defaultVoiceConfig: VoiceConfig = {
  silencesAsStructure: true,
  preserveFalseStarts: false,
  preserveFillers: false,
  cadenceAsGuide: true,
};

export const defaultProsody: ProsodyDiagnostics = {
  pace: 0,
  energy: 0,
  fluency: 1,
  lexicalDensity: 0,
};
