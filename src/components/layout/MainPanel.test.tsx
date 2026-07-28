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
  useRealtimeTranscription: vi.fn(),
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
vi.mock('../../hooks/useRealtimeTranscription', () => ({
  useRealtimeTranscription: mocks.useRealtimeTranscription,
}));
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
import { SESSION_LOGOUT_INTENT_EVENT } from '../../lib/session';

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
    const recorderCancel = vi.fn();
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
      cancel: recorderCancel,
      start: recorderStart,
      stop: recorderStop,
    });
    const realtimeCancel = vi.fn().mockResolvedValue(undefined);
    mocks.useRealtimeTranscription.mockReturnValue({
      cancel: realtimeCancel,
      liveError: null,
      liveTranscript: '',
      start: vi.fn().mockResolvedValue(true),
      status: 'idle',
      stop: vi.fn().mockResolvedValue({
        shouldFallback: true,
        transcript: '',
      }),
      surfaceError: vi.fn(),
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
    const cancelTranscription = vi.fn();
    mocks.useTranscription.mockReturnValue({
      cancel: cancelTranscription,
      isTranscribing: false,
      transcribe,
    });

    const refine = vi.fn().mockReturnValue(new Promise(() => undefined));
    const refinementCancel = vi.fn();
    mocks.useRefinement.mockReturnValue({
      isRefining: false,
      refine,
      refineSelection: vi.fn(),
      variants: [],
      isGeneratingVariants: false,
      generateVariants: vi.fn(),
      acceptVariant: vi.fn(),
      streamingText: '',
      cancel: refinementCancel,
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

    view.rerender(<MainPanel onOpenSidebar={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: 'start' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    view.rerender(<MainPanel onOpenSidebar={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: 'stop' }));
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
    const bodyBeforeLogout = appState.entries.origin.refinedText;

    act(() => {
      window.dispatchEvent(new Event(SESSION_LOGOUT_INTENT_EVENT));
    });
    expect(recorderCancel).toHaveBeenCalledTimes(1);
    expect(cancelTranscription).toHaveBeenCalledTimes(1);
    expect(realtimeCancel).toHaveBeenCalledTimes(1);
    expect(refinementCancel).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveTranscription({
        transcript: 'This must not be appended after logout.',
        words: [],
        language: 'en',
        duration: 2,
      });
    });
    expect(appState.entries.origin.refinedText).toBe(bodyBeforeLogout);
    expect(refine).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'uses committed realtime text without a batch request',
      realtimeResult: {
        shouldFallback: false,
        transcript: 'Realtime committed thought.',
      },
      batchCalls: 0,
      expectedTranscript: 'Realtime committed thought.',
    },
    {
      label: 'runs one batch request when the realtime session degrades',
      realtimeResult: {
        shouldFallback: true,
        transcript: 'Incomplete live segment.',
      },
      batchCalls: 1,
      expectedTranscript: 'Recovered complete thought.',
    },
  ])('$label', async ({
    realtimeResult,
    batchCalls,
    expectedTranscript,
  }) => {
    localStorage.setItem('cadence:transcription-provider', 'elevenlabs');
    let appState: AppState = {
      entries: { origin: makeEntry('origin', 'Opening thought.') },
      directories: {},
      activeEntryId: 'origin',
      refinementSettings: {
        autoRefine: false,
        genre: 'academic',
        highFidelity: true,
        mode: 'faithful',
        scale: 'sentence',
        temperature: 0.2,
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
    const appDispatch = vi.fn((action: AppAction) => {
      if (action.type !== 'UPDATE_ENTRY') return;
      appState = {
        ...appState,
        entries: {
          ...appState.entries,
          [action.id]: {
            ...appState.entries[action.id],
            ...action.updates,
          },
        },
      };
    });
    const recordingDispatch = vi.fn((action: RecordingAction) => {
      if (action.type === 'START_RECORDING') {
        recordingState = {
          ...recordingState,
          isRecording: true,
          session: {
            finalTranscript: '',
            interimTranscript: '',
            pauses: [],
            startedAt: action.startedAt,
            volumeSamples: [],
            wordTimestamps: [],
          },
        };
      } else if (action.type === 'STOP_RECORDING') {
        recordingState = { ...recordingState, isRecording: false };
      }
    });
    mocks.useApp.mockImplementation(() => ({
      dispatch: appDispatch,
      state: appState,
      storageReady: true,
      voiceProfile: { learnedHints: [] },
    }));
    mocks.useRecording.mockImplementation(() => ({
      dispatch: recordingDispatch,
      state: recordingState,
    }));
    mocks.selectTranscriptionHints.mockReturnValue({
      phrases: [],
      terms: [],
    });

    const stopTrack = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    mocks.useAudioAnalyser.mockReturnValue({
      drawWaveform: vi.fn(),
      getTimeDomainData: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    });
    mocks.useMediaRecorder.mockReturnValue({
      cancel: vi.fn(),
      start: vi.fn(),
      stop: vi
        .fn()
        .mockResolvedValue(new Blob(['audio'], { type: 'audio/webm' })),
    });
    mocks.useProsody.mockReturnValue({ ...defaultProsody });

    const transcribe = vi.fn().mockResolvedValue({
      duration: 2,
      language: 'en',
      transcript: 'Recovered complete thought.',
      words: [],
    });
    mocks.useTranscription.mockReturnValue({
      cancel: vi.fn(),
      isTranscribing: false,
      transcribe,
    });
    const realtimeStart = vi.fn().mockResolvedValue(true);
    const realtimeStop = vi.fn().mockResolvedValue(realtimeResult);
    mocks.useRealtimeTranscription.mockReturnValue({
      cancel: vi.fn().mockResolvedValue(undefined),
      liveError: null,
      liveTranscript: 'Live partial',
      start: realtimeStart,
      status: 'streaming',
      stop: realtimeStop,
      surfaceError: vi.fn(),
    });
    mocks.useRefinement.mockReturnValue({
      acceptProposal: vi.fn(),
      acceptVariant: vi.fn(),
      attempts: [],
      cancel: vi.fn(),
      dismissProposal: vi.fn(),
      generateVariants: vi.fn(),
      isGeneratingVariants: false,
      isRefining: false,
      proposal: null,
      refine: vi.fn(),
      refineSelection: vi.fn(),
      rejectProposal: vi.fn(),
      retryProposal: vi.fn(),
      streamingText: '',
      variants: [],
    });

    const view = render(<MainPanel onOpenSidebar={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: 'start' }));
    await waitFor(() =>
      expect(realtimeStart).toHaveBeenCalledWith(stream, []),
    );
    view.rerender(<MainPanel onOpenSidebar={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: 'stop' }));

    await waitFor(() => expect(realtimeStop).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(appState.entries.origin.rawTranscript).toContain(
        expectedTranscript,
      ),
    );
    expect(transcribe).toHaveBeenCalledTimes(batchCalls);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });
});
