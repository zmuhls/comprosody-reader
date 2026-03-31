import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

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
  const tmpPath = join(tmpdir(), `comprosody-${randomUUID()}.webm`);

  try {
    await writeFile(tmpPath, audioBuffer);

    const scriptPath = join(import.meta.dirname, '..', 'scripts', 'transcribe.py');
    const result = await runPython(scriptPath, tmpPath, modelSize);

    const parsed = JSON.parse(result);
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed as TranscriptionResult;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

function runPython(
  scriptPath: string,
  audioPath: string,
  modelSize: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [scriptPath, audioPath, modelSize], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`transcribe.py exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });
  });
}
