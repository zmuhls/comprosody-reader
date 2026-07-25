import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { AppAction, AppState } from '../../context/AppContext';
import type {
  RecordingAction,
  RecordingState,
} from '../../context/RecordingContext';
import { defaultProsody, defaultVoiceConfig } from '../../types/audio';
import type { Entry } from '../../types/editor';
import type { TranscriptionProviderId } from '../../types/transcription';

const mocks = vi.hoisted(() => ({
  selectTranscriptionHints: vi.fn(),
  useApp: vi.fn(),
  useAudioAnalyser: vi.fn(),
  useMediaRecorder: vi.fn(),
  useProsody: vi.fn(),
  useRecording: vi.fn(),
  useRefinement: vi.fn(),
  useTranscription: vi.fn(),
}));

vi.mock('../../context/AppContext', () => ({ useApp: mocks.useApp }));
vi.mock('../../context/RecordingContext', () => ({
  useRecording: mocks.useRecording,
}));
vi.mock('../../hooks/useAudioAnalyser', () => ({
  useAudioAnalyser: mocks.useAudioAnalyser,
}));
vi.mock('../../hooks/useMediaRecorder', () => ({
  useMediaRecorder: mocks.useMediaRecorder,
}));
vi.mock('../../hooks/useProsody', () => ({ useProsody: mocks.useProsody }));
vi.mock('../../hooks/useRefinement', () => ({
  useRefinement: mocks.useRefinement,
}));
vi.mock('../../hooks/useTranscription', () => ({
  useTranscription: mocks.useTranscription,
}));
vi.mock('../../lib/voiceProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/voiceProfile')>()),
  selectTranscriptionHints: mocks.selectTranscriptionHints,
}));
vi.mock('../editor/Editor', () => ({
  Editor: ({
    onProviderChange,
    onStart,
    onStop,
    provider,
  }: {
    onProviderChange: (provider: TranscriptionProviderId) => void;
    onStart: () => void;
    onStop: () => void;
    provider: TranscriptionProviderId;
  }) => (
    <div>
      <output data-testid="provider">{provider}</output>
      <button onClick={onStart} type="button">
        start
      </button>
      <button onClick={onStop} type="button">
        stop
      </button>
      <button onClick={() => onProviderChange('elevenlabs')} type="button">
        switch provider
      </button>
    </div>
  ),
}));

import { MainPanel } from './MainPanel';
import { buildVoiceProfile } from '../../lib/voiceProfile';

function makeEntry(id: string, refinedText: string): Entry {
  return {
    id,
    name: id,
    parentId: null,
    rawTranscript: `${id} raw`,
    refinedText,
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('MainPanel recording integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pins recording inputs and keeps the appended latest body when refinement fails', async () => {
    let appState: AppState = {
      entries: {
        origin: makeEntry('origin', 'Origin edited body.'),
        other: makeEntry('other', 'Other body.'),
      },
      directories: {},
      activeEntryId: 'origin',
      refinementSettings: {
        genre: 'academic',
        scale: 'sentence',
        temperature: 0.2,
        mode: 'faithful',
        highFidelity: true,
        autoRefine: true,
      },
      errors: [],
      history: [],
      historyIndex: -1,
    };
    let recordingState: RecordingState = {
      isRecording: false,
      session: null,
      prosody: { ...defaultProsody },
      voiceConfig: { ...defaultVoiceConfig },
    };
    let learnedHints = ['origin term'];

    const appDispatch = vi.fn((action: AppAction) => {
      if (action.type !== 'UPDATE_ENTRY') return;
      const entry = appState.entries[action.id];
      if (!entry) return;
      appState = {
        ...appState,
        entries: {
          ...appState.entries,
          [action.id]: { ...entry, ...action.updates },
        },
      };
    });
    const recordingDispatch = vi.fn((action: RecordingAction) => {
      if (action.type === 'START_RECORDING') {
        recordingState = {
          ...recordingState,
          isRecording: true,
          session: {
            startedAt: action.startedAt,
            interimTranscript: '',
            finalTranscript: '',
            wordTimestamps: [],
            pauses: [],
            volumeSamples: [],
          },
        };
      } else if (action.type === 'STOP_RECORDING') {
        recordingState = { ...recordingState, isRecording: false };
      }
    });

    mocks.useApp.mockImplementation(() => ({
      state: appState,
      dispatch: appDispatch,
      voiceProfile: { learnedHints },
      storageReady: true,
    }));
    mocks.useRecording.mockImplementation(() => ({
      state: recordingState,
      dispatch: recordingDispatch,
    }));
    mocks.selectTranscriptionHints.mockImplementation(
      (profile: { learnedHints: string[] }) => ({
        terms: profile.learnedHints,
        phrases: [],
      }),
    );

    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    const audioStart = vi.fn().mockResolvedValue(undefined);
    const audioStop = vi.fn();
    const recorderStart = vi.fn();
    const recorderStop = vi
      .fn()
      .mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' }));
    mocks.useAudioAnalyser.mockReturnValue({
      start: audioStart,
      stop: audioStop,
      getTimeDomainData: vi.fn(),
      drawWaveform: vi.fn(),
    });
    mocks.useMediaRecorder.mockReturnValue({
      start: recorderStart,
      stop: recorderStop,
    });
    const audioDerivedProsody = {
      pace: 0,
      energy: 0.4,
      fluency: 0.8,
      lexicalDensity: 0,
    };
    mocks.useProsody.mockReturnValue(audioDerivedProsody);

    let resolveTranscription!: (value: {
      transcript: string;
      words: [];
      language: string;
      duration: number;
    }) => void;
    const transcribe = vi.fn(
      (
        audioBlob: Blob,
        overrides?: {
          provider?: TranscriptionProviderId;
          keyterms?: readonly string[];
        },
      ) => {
        void audioBlob;
        void overrides;
        return new Promise<{
          transcript: string;
          words: [];
          language: string;
          duration: number;
        }>((resolve) => {
          resolveTranscription = resolve;
        });
      },
    );
    mocks.useTranscription.mockReturnValue({
      isTranscribing: false,
      transcribe,
    });

    const refine = vi.fn().mockResolvedValue(null);
    mocks.useRefinement.mockReturnValue({
      isRefining: false,
      refine,
      refineSelection: vi.fn(),
      variants: [],
      isGeneratingVariants: false,
      generateVariants: vi.fn(),
      acceptVariant: vi.fn(),
      streamingText: '',
      cancel: vi.fn(),
    });

    const view = render(<MainPanel onOpenSidebar={vi.fn()} />);

    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    fireEvent.click(view.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(recorderStart).toHaveBeenCalledWith(stream));

    fireEvent.click(view.getByRole('button', { name: 'switch provider' }));
    expect(view.getByTestId('provider').textContent).toBe('elevenlabs');

    appState = { ...appState, activeEntryId: 'other' };
    learnedHints = ['later term'];
    view.rerender(<MainPanel onOpenSidebar={vi.fn()} />);

    dateNow.mockReturnValue(31_000);
    fireEvent.click(view.getByRole('button', { name: 'stop' }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    expect(transcribe.mock.calls[0][1]).toEqual({
      provider: 'local',
      keyterms: ['origin term'],
    });

    appState = {
      ...appState,
      entries: {
        ...appState.entries,
        origin: {
          ...appState.entries.origin,
          refinedText: 'The latest manually edited origin body.',
        },
      },
    };
    view.rerender(<MainPanel onOpenSidebar={vi.fn()} />);

    await act(async () => {
      resolveTranscription({
        transcript: 'The archive reshapes public memory.',
        words: [],
        language: 'en',
        duration: 30,
      });
    });

    await waitFor(() => expect(refine).toHaveBeenCalledTimes(1));
    expect(appState.entries.origin.rawTranscript).toBe(
      'origin raw\n\nThe archive reshapes public memory.',
    );
    expect(appState.entries.origin.refinedText).toBe(
      'The latest manually edited origin body.\n\nThe archive reshapes public memory.',
    );
    expect(appState.entries.other.refinedText).toBe('Other body.');
    expect(refine).toHaveBeenCalledWith({
      autoTriggered: true,
      entryId: 'origin',
      mode: 'faithful',
      sourceText:
        'The latest manually edited origin body.\n\nThe archive reshapes public memory.',
    });
    expect(appState.entries.origin.prosodyHistory).toHaveLength(1);
    expect(appState.entries.origin.prosodyHistory?.[0].metrics).toEqual(
      {
        pace: 10,
        energy: 0.4,
        fluency: 0.8,
        lexicalDensity: 0.8,
      },
    );
    expect(appState.entries.origin.prosody).toEqual(
      appState.entries.origin.prosodyHistory?.[0].metrics,
    );
    const correctedProfile = buildVoiceProfile({
      origin: appState.entries.origin,
    });
    expect(correctedProfile.prosody.lifetime?.pace.latest).toBe(10);
    expect(correctedProfile.prosody.lifetime?.lexicalDensity.latest).toBe(0.8);
    expect(recordingDispatch).toHaveBeenCalledWith({
      type: 'FINALIZE_PROSODY',
      prosody: appState.entries.origin.prosody,
    });
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
