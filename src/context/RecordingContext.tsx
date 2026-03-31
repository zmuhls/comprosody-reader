import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { ProsodyDiagnostics, VoiceConfig, RecordingSession } from '../types/audio';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';

export interface RecordingState {
  isRecording: boolean;
  session: RecordingSession | null;
  prosody: ProsodyDiagnostics;
  voiceConfig: VoiceConfig;
}

export type RecordingAction =
  | { type: 'START_RECORDING'; startedAt: number }
  | { type: 'STOP_RECORDING' }
  | { type: 'UPDATE_INTERIM'; text: string }
  | { type: 'APPEND_FINAL'; text: string }
  | { type: 'SET_TRANSCRIPT'; text: string }
  | { type: 'ADD_WORD_TIMESTAMP'; word: string; start: number; end: number }
  | { type: 'ADD_PAUSE'; start: number; end: number }
  | { type: 'ADD_VOLUME_SAMPLE'; value: number }
  | { type: 'UPDATE_PROSODY'; prosody: ProsodyDiagnostics }
  | { type: 'FINALIZE_PROSODY'; prosody: ProsodyDiagnostics }
  | { type: 'SET_VOICE_CONFIG'; config: Partial<VoiceConfig> }
  | { type: 'SET_AUDIO_BLOB'; blob: Blob };

export function recordingReducer(
  state: RecordingState,
  action: RecordingAction
): RecordingState {
  switch (action.type) {
    case 'START_RECORDING':
      return {
        ...state,
        isRecording: true,
        session: {
          startedAt: action.startedAt,
          interimTranscript: '',
          finalTranscript: '',
          wordTimestamps: [],
          pauses: [],
          volumeSamples: [],
          audioBlob: null,
        },
        prosody: defaultProsody,
      };

    case 'STOP_RECORDING':
      return { ...state, isRecording: false };

    case 'UPDATE_INTERIM':
      if (!state.session) return state;
      return {
        ...state,
        session: { ...state.session, interimTranscript: action.text },
      };

    case 'APPEND_FINAL':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          finalTranscript: state.session.finalTranscript
            ? state.session.finalTranscript + ' ' + action.text
            : action.text,
          interimTranscript: '',
        },
      };

    case 'SET_TRANSCRIPT':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          finalTranscript: action.text,
          interimTranscript: '',
          wordTimestamps: [],
        },
      };

    case 'ADD_WORD_TIMESTAMP':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          wordTimestamps: [
            ...state.session.wordTimestamps,
            { word: action.word, start: action.start, end: action.end },
          ],
        },
      };

    case 'ADD_PAUSE':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          pauses: [
            ...state.session.pauses,
            { start: action.start, end: action.end },
          ],
        },
      };

    case 'ADD_VOLUME_SAMPLE':
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          volumeSamples: [...state.session.volumeSamples, action.value],
        },
      };

    case 'UPDATE_PROSODY':
      return { ...state, prosody: action.prosody };

    case 'FINALIZE_PROSODY':
      return { ...state, prosody: action.prosody };

    case 'SET_VOICE_CONFIG':
      return {
        ...state,
        voiceConfig: { ...state.voiceConfig, ...action.config },
      };

    case 'SET_AUDIO_BLOB':
      if (!state.session) return state;
      return {
        ...state,
        session: { ...state.session, audioBlob: action.blob },
      };

    default:
      return state;
  }
}

const initialState: RecordingState = {
  isRecording: false,
  session: null,
  prosody: defaultProsody,
  voiceConfig: defaultVoiceConfig,
};

const RecordingContext = createContext<{
  state: RecordingState;
  dispatch: Dispatch<RecordingAction>;
} | null>(null);

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(recordingReducer, initialState);
  return (
    <RecordingContext.Provider value={{ state, dispatch }}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  const ctx = useContext(RecordingContext);
  if (!ctx)
    throw new Error('useRecording must be used within RecordingProvider');
  return ctx;
}
