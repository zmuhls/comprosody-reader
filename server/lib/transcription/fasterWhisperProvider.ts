import { transcribeWithWorker } from '../whisperWorker.js';
import {
  UnsupportedTranscriptionModelError,
  type TranscriptionProvider,
} from './types.js';

export const DEFAULT_FASTER_WHISPER_MODEL = 'base';

export const FASTER_WHISPER_MODELS = new Set([
  'tiny',
  'base',
  'small',
  'medium',
  'large-v1',
  'large-v2',
  'large-v3',
  'large-v3-turbo',
  'turbo',
]);

type TranscribeWithWorker = typeof transcribeWithWorker;

export function createFasterWhisperProvider(
  workerTranscribe: TranscribeWithWorker = transcribeWithWorker
): TranscriptionProvider {
  return {
    id: 'local',
    async transcribe({ audioBuffer, model, keyterms, signal }) {
      if (signal?.aborted) throw signal.reason;
      const selectedModel =
        model ||
        process.env.FASTER_WHISPER_MODEL ||
        DEFAULT_FASTER_WHISPER_MODEL;
      if (!FASTER_WHISPER_MODELS.has(selectedModel)) {
        throw new UnsupportedTranscriptionModelError('local', selectedModel);
      }

      const hotwords = keyterms?.length ? keyterms.join(', ') : undefined;
      const result = await workerTranscribe(audioBuffer, selectedModel, hotwords);
      if (signal?.aborted) throw signal.reason;
      return result;
    },
  };
}

export const fasterWhisperProvider = createFasterWhisperProvider();
