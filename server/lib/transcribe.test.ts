import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnsupportedTranscriptionProviderError,
  resolveTranscriptionProvider,
} from './transcribe.js';
import {
  createFasterWhisperProvider,
  fasterWhisperProvider,
} from './transcription/fasterWhisperProvider.js';
import { UnsupportedTranscriptionModelError } from './transcription/types.js';

const originalDefaultProvider = process.env.TRANSCRIPTION_PROVIDER;

afterEach(() => {
  if (originalDefaultProvider === undefined) {
    delete process.env.TRANSCRIPTION_PROVIDER;
  } else {
    process.env.TRANSCRIPTION_PROVIDER = originalDefaultProvider;
  }
});

describe('transcription provider selection', () => {
  it('keeps local faster-whisper as the default', () => {
    delete process.env.TRANSCRIPTION_PROVIDER;
    expect(resolveTranscriptionProvider()).toBe('local');
  });

  it('supports explicit provider names and useful aliases', () => {
    expect(resolveTranscriptionProvider('local')).toBe('local');
    expect(resolveTranscriptionProvider('faster-whisper')).toBe('local');
    expect(resolveTranscriptionProvider('elevenlabs')).toBe('elevenlabs');
    expect(resolveTranscriptionProvider('scribe')).toBe('elevenlabs');
  });

  it('uses the environment default when the request does not select one', () => {
    process.env.TRANSCRIPTION_PROVIDER = 'elevenlabs';
    expect(resolveTranscriptionProvider()).toBe('elevenlabs');
  });

  it('rejects an unknown provider', () => {
    expect(() => resolveTranscriptionProvider('unknown')).toThrow(
      UnsupportedTranscriptionProviderError
    );
  });

  it('rejects an invalid local model before starting the worker', async () => {
    await expect(
      fasterWhisperProvider.transcribe({
        audioBuffer: Buffer.from('audio'),
        model: 'not-a-whisper-model',
      })
    ).rejects.toBeInstanceOf(UnsupportedTranscriptionModelError);
  });

  it.each(['large-v3-turbo', 'turbo'])(
    'supports the local %s model and forwards joined hotwords',
    async (model) => {
      const result = {
        transcript: 'A transcript',
        words: [],
        language: 'en',
        duration: 1,
      };
      const workerTranscribe = vi.fn(async () => result);
      const provider = createFasterWhisperProvider(workerTranscribe);
      const audioBuffer = Buffer.from('audio');

      await expect(
        provider.transcribe({
          audioBuffer,
          model,
          keyterms: ['Comprosody', 'prosodic signature'],
        })
      ).resolves.toEqual(result);
      expect(workerTranscribe).toHaveBeenCalledWith(
        audioBuffer,
        model,
        'Comprosody, prosodic signature'
      );
    }
  );
});
