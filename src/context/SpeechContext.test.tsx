import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

const services = vi.hoisted(() => ({
  fetchSpeechVoices: vi.fn(),
  playAudio: vi.fn(),
  recordImprovementEvent: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock('../lib/speechApi', () => ({
  fetchSpeechVoices: services.fetchSpeechVoices,
  synthesizeSpeech: services.synthesizeSpeech,
}));

vi.mock('../lib/improvementMetrics', () => ({
  recordImprovementEvent: services.recordImprovementEvent,
}));

import { SpeechProvider, useSpeech } from './SpeechContext';

class TestAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  load(): void {}
  pause(): void {}
  play(): Promise<void> {
    return services.playAudio();
  }
  removeAttribute(): void {}
}

function wrapper({ children }: { children: ReactNode }) {
  return <SpeechProvider>{children}</SpeechProvider>;
}

describe('speech playback metrics', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('cadence:listening-voice:v1', 'voice-1');
    services.fetchSpeechVoices.mockReset();
    services.playAudio.mockReset().mockResolvedValue(undefined);
    services.recordImprovementEvent.mockReset().mockResolvedValue(true);
    services.synthesizeSpeech
      .mockReset()
      .mockResolvedValue(new Blob(['ID3-valid-enough-for-client-test'], {
        type: 'audio/mpeg',
      }));
    vi.stubGlobal('Audio', TestAudio);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:cadence-test'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records success only after browser playback begins', async () => {
    const { result, unmount } = renderHook(() => useSpeech(), { wrapper });

    await act(async () => {
      await result.current.speak('Read this note.');
    });

    expect(services.playAudio).toHaveBeenCalledTimes(1);
    expect(services.recordImprovementEvent).toHaveBeenCalledTimes(1);
    expect(services.recordImprovementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'speech_synthesis',
        outcome: 'succeeded',
        provider: 'elevenlabs',
      }),
    );
    expect(result.current.playbackState).toBe('playing');
    unmount();
  });

  it('records a failed attempt when the browser rejects generated audio', async () => {
    const playbackError = new Error(
      'Failed to load because no supported source was found.',
    );
    playbackError.name = 'NotSupportedError';
    services.playAudio.mockRejectedValueOnce(playbackError);
    const { result, unmount } = renderHook(() => useSpeech(), { wrapper });

    await act(async () => {
      await result.current.speak('Read this note.');
    });

    expect(services.recordImprovementEvent).toHaveBeenCalledTimes(1);
    expect(services.recordImprovementEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'speech_synthesis',
        outcome: 'failed',
        provider: 'elevenlabs',
      }),
    );
    expect(services.recordImprovementEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'succeeded' }),
    );
    expect(result.current.error).toBe(
      'Failed to load because no supported source was found.',
    );
    expect(result.current.playbackState).toBe('idle');
    unmount();
  });
});
