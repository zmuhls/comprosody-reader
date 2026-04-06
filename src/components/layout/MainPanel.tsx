import { useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useRecording } from '../../context/RecordingContext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAudioAnalyser } from '../../hooks/useAudioAnalyser';
import { useMediaRecorder } from '../../hooks/useMediaRecorder';
import { useTranscription } from '../../hooks/useTranscription';
import { useProsody } from '../../hooks/useProsody';
import { RecordButton } from '../dictation/RecordButton';
import { Waveform } from '../dictation/Waveform';
import { ProsodyPanel } from '../dictation/ProsodyPanel';
import { VoiceConfigToggles } from '../dictation/VoiceConfigToggles';
import { Editor } from '../editor/Editor';

export function MainPanel() {
  const { state, dispatch } = useApp();
  const { state: recState } = useRecording();
  const speech = useSpeechRecognition();
  const audio = useAudioAnalyser();
  const recorder = useMediaRecorder();
  const { isTranscribing, transcribe } = useTranscription();
  const prosody = useProsody(audio.getTimeDomainData);

  const streamRef = useRef<MediaStream | null>(null);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const handleStart = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    await audio.start(stream);
    recorder.start(stream);
    speech.start();
  }, [audio, recorder, speech]);

  const handleStop = useCallback(async () => {
    speech.stop();
    const audioBlob = await recorder.stop();
    audio.stop();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Save prosody + voice config
    if (activeEntry && recState.session) {
      dispatch({
        type: 'UPDATE_ENTRY',
        id: activeEntry.id,
        updates: {
          prosody: { ...prosody },
          voiceConfig: { ...recState.voiceConfig },
        },
      });
    }

    // Send to OpenRouter for transcription, fall back to Web Speech API
    if (activeEntry && audioBlob.size > 0) {
      try {
        const result = await transcribe(audioBlob);
        dispatch({
          type: 'UPDATE_ENTRY',
          id: activeEntry.id,
          updates: {
            rawTranscript: activeEntry.rawTranscript
              ? activeEntry.rawTranscript + '\n\n' + result.transcript
              : result.transcript,
          },
        });
      } catch {
        // Fall back to Web Speech API transcript
        const fallbackText = recState.session?.finalTranscript ?? '';
        if (fallbackText) {
          dispatch({
            type: 'UPDATE_ENTRY',
            id: activeEntry.id,
            updates: {
              rawTranscript: activeEntry.rawTranscript
                ? activeEntry.rawTranscript + '\n\n' + fallbackText
                : fallbackText,
            },
          });
        }
      }
    }
  }, [speech, recorder, audio, activeEntry, recState, prosody, dispatch, transcribe]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Recording strip */}
      <div
        className={`border-b border-border bg-surface-raised transition-shadow duration-500 ${
          speech.isRecording ? 'recording-active' : ''
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <RecordButton
            isRecording={speech.isRecording}
            onStart={handleStart}
            onStop={handleStop}
          />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Waveform
              drawWaveform={audio.drawWaveform}
              isRecording={speech.isRecording}
            />
            <ProsodyPanel
              prosody={prosody}
              isRecording={speech.isRecording}
            />
          </div>
          <VoiceConfigToggles />
        </div>
      </div>

      {/* Transcribing indicator */}
      {isTranscribing && (
        <div className="px-4 py-2 bg-surface-overlay border-b border-border">
          <span className="text-[10px] text-accent animate-pulse tracking-wider">
            transcribing...
          </span>
        </div>
      )}

      {/* Editor */}
      <Editor
        interimTranscript={speech.interimTranscript}
        isRecording={speech.isRecording}
      />
    </div>
  );
}
