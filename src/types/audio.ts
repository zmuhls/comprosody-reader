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

export interface RecordingSession {
  startedAt: number;
  interimTranscript: string;
  finalTranscript: string;
  pauses: Array<{ start: number; end: number }>;
  volumeSamples: number[];
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
