import { spawn, type ChildProcess } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { TranscriptionResult } from './transcription/types.js';

interface PendingRequest {
  resolve: (value: TranscriptionResult) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class WhisperWorker {
  private proc: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = '';
  private modelSize: string;
  private restartCount = 0;

  constructor(modelSize: string = 'base') {
    this.modelSize = modelSize;
  }

  private scriptPath(): string {
    return join(import.meta.dirname, '..', 'scripts', 'whisper_worker.py');
  }

  private start(): void {
    if (this.proc) return;

    const proc = spawn('python3', [this.scriptPath(), this.modelSize], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => {
      console.error('whisper worker stderr:', chunk.toString());
    });

    proc.on('error', (err) => this.handleExit(err));
    proc.on('exit', (code, signal) => {
      this.handleExit(
        new Error(`Whisper worker exited (code=${code}, signal=${signal})`)
      );
    });
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.status === 'ready') {
          continue;
        }
        const req = msg.id ? this.pending.get(msg.id) : undefined;
        if (!req) {
          console.error('whisper worker: unsolicited message', msg);
          continue;
        }
        clearTimeout(req.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          req.reject(new Error(msg.error));
        } else if (msg.result) {
          req.resolve(msg.result as TranscriptionResult);
        } else {
          req.reject(new Error('Unexpected worker response'));
        }
      } catch (err) {
        console.error('whisper worker: failed to parse line', line, err);
      }
    }
  }

  private handleExit(err: Error): void {
    console.error(err);
    const pending = this.pending;
    this.pending = new Map();
    this.proc = null;

    for (const req of pending.values()) {
      clearTimeout(req.timer);
      req.reject(err);
    }

    if (this.restartCount < 3) {
      this.restartCount++;
      setTimeout(() => this.start(), 500);
    }
  }

  async transcribe(
    audioBuffer: Buffer,
    modelSize?: string,
    hotwords?: string
  ): Promise<TranscriptionResult> {
    const id = randomUUID();
    const tmpPath = join(tmpdir(), `comprosody-${id}.webm`);
    await writeFile(tmpPath, audioBuffer);

    return new Promise((resolve, reject) => {
      this.start();

      const cleanup = () => unlink(tmpPath).catch(() => {});

      const wrappedResolve = (value: TranscriptionResult) => {
        cleanup();
        resolve(value);
      };
      const wrappedReject = (reason: Error) => {
        cleanup();
        reject(reason);
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        wrappedReject(new Error('Transcription timed out'));
      }, 120_000);

      this.pending.set(id, {
        resolve: wrappedResolve,
        reject: wrappedReject,
        timer,
      });

      try {
        const request = {
          id,
          audio_path: tmpPath,
          model_size: modelSize || this.modelSize,
          hotwords,
        };
        const stdin = this.proc?.stdin;
        if (!stdin) {
          throw new Error('Whisper worker stdin unavailable');
        }
        stdin.write(JSON.stringify(request) + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        wrappedReject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  shutdown(): void {
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(new Error('Worker shutting down'));
    }
    this.pending.clear();
    if (this.proc?.stdin) {
      this.proc.stdin.write(JSON.stringify({ action: 'exit' }) + '\n');
    }
    setTimeout(() => this.proc?.kill(), 1000);
  }
}

const worker = new WhisperWorker();

export async function transcribeWithWorker(
  audioBuffer: Buffer,
  modelSize?: string,
  hotwords?: string
): Promise<TranscriptionResult> {
  return worker.transcribe(audioBuffer, modelSize, hotwords);
}

export function shutdownWorker(): void {
  worker.shutdown();
}
