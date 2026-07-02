import { transcribeWithWorker, shutdownWorker } from './whisperWorker.js';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  transcript: string;
  words: WordTimestamp[];
  language: string;
  duration: number;
}

export async function transcribe(
  audioBuffer: Buffer,
  modelSize: string = 'base'
): Promise<TranscriptionResult> {
  return transcribeWithWorker(audioBuffer, modelSize);
}

export { shutdownWorker };
