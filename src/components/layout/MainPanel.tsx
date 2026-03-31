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

  // Keep a ref to the stream so MediaRecorder can share it with AudioAnalyser
  const streamRef = useRef<MediaStream | null>(null);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const handleStart = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    // Start all capture layers on the same stream
    await audio.start(stream);
    recorder.start(stream);
    speech.start();
  }, [audio, recorder, speech]);

  const handleStop = useCallback(async () => {
    speech.stop();
    const audioBlob = await recorder.stop();
    audio.stop();

    // Stop the shared media stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Save live prosody + voice config immediately
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

    // Send to Whisper for real transcription
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
        // Whisper failed — fall back to Web Speech API transcript
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
      {/* Recording controls */}
      <div className="border-b border-border bg-surface-raised">
        <div className="flex items-center gap-4 px-4 py-3">
          <RecordButton
            isRecording={speech.isRecording}
            isTranscribing={isTranscribing}
            onStart={handleStart}
            onStop={handleStop}
          />
          <div className="flex-1 min-w-0">
            <Waveform
              drawWaveform={audio.drawWaveform}
              isRecording={speech.isRecording}
            />
          </div>
        </div>
        <div className="flex items-start gap-4 px-4 pb-3">
          <div className="flex-1">
            <ProsodyPanel prosody={prosody} />
          </div>
          <div className="pt-1">
            <VoiceConfigToggles />
          </div>
        </div>
      </div>

      {/* Transcribing indicator */}
      {isTranscribing && (
        <div className="px-4 py-2 bg-surface-overlay border-b border-border">
          <span className="text-[10px] text-text-muted animate-pulse">
            transcribing with whisper...
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
