import { recordingReducer, type RecordingState } from './RecordingContext';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';

function makeInitialState(): RecordingState {
  return {
    isRecording: false,
    session: null,
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
  };
}

function makeRecordingState(): RecordingState {
  return {
    isRecording: true,
    session: {
      startedAt: 1000,
      interimTranscript: '',
      finalTranscript: '',
      wordTimestamps: [],
      pauses: [],
      volumeSamples: [],
      audioBlob: null,
    },
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
  };
}

describe('recordingReducer', () => {
  it('START_RECORDING initializes session and resets prosody', () => {
    const state = makeInitialState();
    const next = recordingReducer(state, { type: 'START_RECORDING', startedAt: 5000 });

    expect(next.isRecording).toBe(true);
    expect(next.session).not.toBeNull();
    expect(next.session!.startedAt).toBe(5000);
    expect(next.session!.finalTranscript).toBe('');
    expect(next.session!.interimTranscript).toBe('');
    expect(next.session!.wordTimestamps).toEqual([]);
    expect(next.session!.pauses).toEqual([]);
    expect(next.session!.volumeSamples).toEqual([]);
    expect(next.prosody).toEqual(defaultProsody);
  });

  it('STOP_RECORDING sets isRecording false but preserves session', () => {
    const state = makeRecordingState();
    state.session!.finalTranscript = 'some words';
    const next = recordingReducer(state, { type: 'STOP_RECORDING' });

    expect(next.isRecording).toBe(false);
    expect(next.session).not.toBeNull();
    expect(next.session!.finalTranscript).toBe('some words');
  });

  it('UPDATE_INTERIM does nothing when session is null', () => {
    const state = makeInitialState();
    const next = recordingReducer(state, { type: 'UPDATE_INTERIM', text: 'hello' });
    expect(next).toBe(state);
  });

  it('UPDATE_INTERIM updates interim transcript', () => {
    const state = makeRecordingState();
    const next = recordingReducer(state, { type: 'UPDATE_INTERIM', text: 'hello world' });
    expect(next.session!.interimTranscript).toBe('hello world');
  });

  it('APPEND_FINAL sets transcript on first append', () => {
    const state = makeRecordingState();
    const next = recordingReducer(state, { type: 'APPEND_FINAL', text: 'first words' });
    expect(next.session!.finalTranscript).toBe('first words');
    expect(next.session!.interimTranscript).toBe('');
  });

  it('APPEND_FINAL joins with space on subsequent appends', () => {
    const state = makeRecordingState();
    state.session!.finalTranscript = 'hello';
    const next = recordingReducer(state, { type: 'APPEND_FINAL', text: 'world' });
    expect(next.session!.finalTranscript).toBe('hello world');
  });

  it('ADD_WORD_TIMESTAMP appends timestamp', () => {
    const state = makeRecordingState();
    state.session!.wordTimestamps = [{ word: 'first', start: 0.1, end: 0.3 }];
    const next = recordingReducer(state, { type: 'ADD_WORD_TIMESTAMP', word: 'second', start: 0.4, end: 0.6 });
    expect(next.session!.wordTimestamps).toEqual([
      { word: 'first', start: 0.1, end: 0.3 },
      { word: 'second', start: 0.4, end: 0.6 },
    ]);
  });

  it('ADD_PAUSE appends pause', () => {
    const state = makeRecordingState();
    const next = recordingReducer(state, { type: 'ADD_PAUSE', start: 1000, end: 2000 });
    expect(next.session!.pauses).toEqual([{ start: 1000, end: 2000 }]);
  });

  it('ADD_VOLUME_SAMPLE appends sample', () => {
    const state = makeRecordingState();
    state.session!.volumeSamples = [0.5];
    const next = recordingReducer(state, { type: 'ADD_VOLUME_SAMPLE', value: 0.8 });
    expect(next.session!.volumeSamples).toEqual([0.5, 0.8]);
  });

  it('UPDATE_PROSODY replaces prosody', () => {
    const state = makeInitialState();
    const prosody = { pace: 150, energy: 0.6, fluency: 0.85, lexicalDensity: 0.55 };
    const next = recordingReducer(state, { type: 'UPDATE_PROSODY', prosody });
    expect(next.prosody).toEqual(prosody);
  });

  it('SET_VOICE_CONFIG merges partial config', () => {
    const state = makeInitialState();
    expect(state.voiceConfig.preserveFalseStarts).toBe(false);

    const next = recordingReducer(state, {
      type: 'SET_VOICE_CONFIG',
      config: { preserveFalseStarts: true },
    });
    expect(next.voiceConfig.preserveFalseStarts).toBe(true);
    // Other fields unchanged
    expect(next.voiceConfig.silencesAsStructure).toBe(true);
    expect(next.voiceConfig.cadenceAsGuide).toBe(true);
  });

  it('returns state unchanged for unknown action', () => {
    const state = makeInitialState();
    // @ts-expect-error testing unknown action
    const next = recordingReducer(state, { type: 'UNKNOWN_ACTION' });
    expect(next).toBe(state);
  });
});
