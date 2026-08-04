export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  transcript: string;
  words: WordTimestamp[];
  language: string;
  duration: number;
}

export type TranscriptionProviderId = 'local' | 'elevenlabs';

export interface TranscriptionInput {
  audioBuffer: Buffer;
  model?: string;
  contentType?: string;
  keyterms?: string[];
  signal?: AbortSignal;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export class UnsupportedTranscriptionProviderError extends Error {
  constructor(provider: string) {
    super(`Unsupported transcription provider: ${provider}`);
    this.name = 'UnsupportedTranscriptionProviderError';
  }
}

export class UnsupportedTranscriptionModelError extends Error {
  constructor(provider: TranscriptionProviderId, model: string) {
    super(
      provider === 'local'
        ? `Invalid model size: ${model}`
        : `Unsupported ${provider} transcription model: ${model}`
    );
    this.name = 'UnsupportedTranscriptionModelError';
  }
}

export class TranscriptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionConfigurationError';
  }
}

export class TranscriptionUpstreamError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TranscriptionUpstreamError';
    this.status = status;
  }
}
