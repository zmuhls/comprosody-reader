import { useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useRecording } from '../../context/RecordingContext';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAudioAnalyser } from '../../hooks/useAudioAnalyser';
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
  const prosody = useProsody(audio.getTimeDomainData);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const handleStart = useCallback(async () => {
    await audio.start();
    speech.start();
  }, [audio, speech]);

  const handleStop = useCallback(() => {
    speech.stop();
    audio.stop();

    // Save transcript and prosody to active entry
    if (activeEntry && recState.session) {
      const finalText = recState.session.finalTranscript;
      dispatch({
        type: 'UPDATE_ENTRY',
        id: activeEntry.id,
        updates: {
          rawTranscript: activeEntry.rawTranscript
            ? activeEntry.rawTranscript + '\n\n' + finalText
            : finalText,
          prosody: { ...prosody },
          voiceConfig: { ...recState.voiceConfig },
        },
      });
    }
  }, [speech, audio, activeEntry, recState, prosody, dispatch]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Recording controls */}
      <div className="border-b border-border bg-surface-raised">
        <div className="flex items-center gap-4 px-4 py-3">
          <RecordButton
            isRecording={speech.isRecording}
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

      {/* Editor */}
      <Editor
        interimTranscript={speech.interimTranscript}
        isRecording={speech.isRecording}
      />
    </div>
  );
}
