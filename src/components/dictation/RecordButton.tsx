import { Icon } from '../ui/Icon';

interface Props {
  isRecording: boolean;
  isTranscribing: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function RecordButton({
  isRecording,
  isTranscribing,
  onStart,
  onStop,
}: Props) {
  const disabled = isTranscribing;

  return (
    <button
      aria-label={
        isTranscribing
          ? 'Transcribing recording'
          : isRecording
            ? 'Stop recording'
            : 'Start recording'
      }
      className={`record-button ${isRecording ? 'is-recording' : ''} ${
        isTranscribing ? 'is-busy' : ''
      }`}
      disabled={disabled}
      onClick={isRecording ? onStop : onStart}
      title={
        isTranscribing
          ? 'Transcribing…'
          : isRecording
            ? 'Stop recording'
            : 'Start recording'
      }
      type="button"
    >
      {isTranscribing ? (
        <span className="record-spinner" />
      ) : (
        <Icon name={isRecording ? 'stop' : 'mic'} size={17} />
      )}
    </button>
  );
}
