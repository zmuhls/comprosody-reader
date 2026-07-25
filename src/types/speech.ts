export interface SpeechVoice {
  id: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  description: string | null;
  previewUrl: string | null;
}

export interface SpeechVoicePage {
  voices: SpeechVoice[];
  hasMore: boolean;
  nextPageToken: string | null;
}

export type SpeechPlaybackState =
  | 'idle'
  | 'loading-voices'
  | 'synthesizing'
  | 'playing';
