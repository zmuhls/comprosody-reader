export type TranscriptionProviderId = 'local' | 'elevenlabs';

export const TRANSCRIPTION_PROVIDERS: ReadonlyArray<{
  id: TranscriptionProviderId;
  label: string;
  shortLabel: string;
  privacy: string;
}> = [
  {
    id: 'local',
    label: 'Private Whisper',
    shortLabel: 'Private · Whisper',
    privacy: 'Audio is sent to your private Cadence service and is not retained.',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe v2',
    shortLabel: 'Cloud · Scribe v2',
    privacy: 'Audio and learned vocabulary hints are sent to ElevenLabs for transcription.',
  },
];
