import { shutdownWorker } from './whisperWorker.js';
import { elevenLabsScribeProvider } from './transcription/elevenLabsScribeProvider.js';
import { fasterWhisperProvider } from './transcription/fasterWhisperProvider.js';
import {
  UnsupportedTranscriptionProviderError,
  type TranscriptionProvider,
  type TranscriptionProviderId,
  type TranscriptionResult,
} from './transcription/types.js';

export type { TranscriptionResult, WordTimestamp } from './transcription/types.js';
export {
  TranscriptionConfigurationError,
  TranscriptionUpstreamError,
  UnsupportedTranscriptionModelError,
  UnsupportedTranscriptionProviderError,
} from './transcription/types.js';

const providers: Record<TranscriptionProviderId, TranscriptionProvider> = {
  local: fasterWhisperProvider,
  elevenlabs: elevenLabsScribeProvider,
};

const providerAliases: Record<string, TranscriptionProviderId> = {
  local: 'local',
  whisper: 'local',
  'faster-whisper': 'local',
  elevenlabs: 'elevenlabs',
  scribe: 'elevenlabs',
};

export interface TranscriptionOptions {
  provider?: TranscriptionProviderId | string;
  model?: string;
  contentType?: string;
  keyterms?: string[];
}

export function resolveTranscriptionProvider(
  requestedProvider?: string
): TranscriptionProviderId {
  const configured =
    requestedProvider?.trim() ||
    process.env.TRANSCRIPTION_PROVIDER?.trim() ||
    'local';
  const provider = providerAliases[configured.toLowerCase()];

  if (!provider) {
    throw new UnsupportedTranscriptionProviderError(configured);
  }

  return provider;
}

export async function transcribe(
  audioBuffer: Buffer,
  modelSize?: string
): Promise<TranscriptionResult>;
export async function transcribe(
  audioBuffer: Buffer,
  options?: TranscriptionOptions
): Promise<TranscriptionResult>;
export async function transcribe(
  audioBuffer: Buffer,
  modelOrOptions: string | TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  const options =
    typeof modelOrOptions === 'string'
      ? { model: modelOrOptions, provider: 'local' }
      : modelOrOptions;
  const providerId = resolveTranscriptionProvider(options.provider);

  return providers[providerId].transcribe({
    audioBuffer,
    model: options.model,
    contentType: options.contentType,
    keyterms: options.keyterms,
  });
}

export { shutdownWorker };
