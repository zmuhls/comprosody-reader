import { randomUUID } from 'node:crypto';
import { buildEpub, EpubBuildError } from './epub-builder.js';
import {
  IngestionAgentError,
  runIngestionAgent,
  validateTextIngestionInput,
} from './ingestion-agent.js';

const CREATE_KEYS = new Set(['pages', 'metadata']);

export class IngestionJobError extends Error {
  constructor(message, code, { status = 400 } = {}) {
    super(message);
    this.name = 'IngestionJobError';
    this.code = code;
    this.status = status;
  }
}

function safeIso(clock) {
  return new Date(clock()).toISOString();
}

function assertManagerOptions(options) {
  const integer = (value, min, max, label) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new IngestionJobError(`${label} is invalid.`, 'invalid_options');
    }
  };
  integer(options.maxActiveJobs, 1, 8, 'maxActiveJobs');
  integer(options.maxQueuedJobs, 0, 100, 'maxQueuedJobs');
  integer(options.maxRetainedJobs, 1, 1_000, 'maxRetainedJobs');
  integer(options.maxSourceChars, 1_000, 10_000_000, 'maxSourceChars');
  integer(options.maxEpubBytes, 1_000, 250_000_000, 'maxEpubBytes');
  integer(options.ttlMs, 1_000, 86_400_000, 'ttlMs');
}

function validateCreateInput(input, maxSourceChars) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new IngestionJobError('Ingestion input must be an object.', 'invalid_input');
  }
  for (const key of Object.keys(input)) {
    if (!CREATE_KEYS.has(key)) {
      throw new IngestionJobError('Only extracted page text and metadata are accepted.', 'text_only');
    }
  }
  try {
    return validateTextIngestionInput(input, { maxSourceChars });
  } catch (error) {
    if (error instanceof IngestionAgentError) {
      throw new IngestionJobError(error.message, error.code, {
        status: error.code === 'source_too_large' ? 413 : 400,
      });
    }
    throw error;
  }
}

function sourceCopy(validated) {
  return {
    pages: validated.pages.map((page) => ({ pageNumber: page.pageNumber, text: `${page.text}` })),
    metadata: { ...validated.metadata },
  };
}

function zeroSource(job) {
  if (!job.source) return false;
  for (const page of job.source.pages || []) page.text = '';
  for (const key of Object.keys(job.source.metadata || {})) job.source.metadata[key] = '';
  job.source.pages = [];
  job.source.metadata = {};
  job.source = null;
  job.sourceCleared = true;
  return true;
}

function zeroResult(job) {
  if (!job.result) return false;
  job.result.fill(0);
  job.result = null;
  job.resultCleared = true;
  return true;
}

function safeFailure(error) {
  if (error instanceof IngestionAgentError || error instanceof EpubBuildError || error instanceof IngestionJobError) {
    return { code: error.code || 'ingestion_failed', message: error.message };
  }
  if (error?.name === 'AbortError') return { code: 'cancelled', message: 'The ingestion was cancelled.' };
  return { code: 'ingestion_failed', message: 'The ingestion could not be completed.' };
}

function safeProgress(event) {
  const safe = {};
  for (const key of [
    'phase', 'status', 'cycle', 'chunkIndex', 'chunkCount', 'completedSteps', 'totalSteps', 'progress',
  ]) {
    if (typeof event?.[key] === 'string' || typeof event?.[key] === 'number') safe[key] = event[key];
  }
  return safe;
}

function safeFilename(title) {
  const base = String(title || 'reading')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLocaleLowerCase('und')
    .slice(0, 80);
  return `${base || 'reading'}.epub`;
}

export class IngestionJobManager {
  constructor({
    runAgent = runIngestionAgent,
    epubBuilder = buildEpub,
    agentOptions = {},
    maxActiveJobs = 2,
    maxQueuedJobs = 6,
    maxRetainedJobs = 50,
    maxSourceChars = 2_000_000,
    maxEpubBytes = 50_000_000,
    ttlMs = 15 * 60_000,
    clock = Date.now,
    idFactory = randomUUID,
    onUpdate,
    onCleanup,
  } = {}) {
    const limits = {
      maxActiveJobs,
      maxQueuedJobs,
      maxRetainedJobs,
      maxSourceChars,
      maxEpubBytes,
      ttlMs,
    };
    assertManagerOptions(limits);
    if (typeof runAgent !== 'function' || typeof epubBuilder !== 'function'
        || typeof clock !== 'function' || typeof idFactory !== 'function') {
      throw new IngestionJobError('Job manager dependencies are invalid.', 'invalid_options');
    }
    this.runAgent = runAgent;
    this.epubBuilder = epubBuilder;
    this.agentOptions = { ...agentOptions };
    this.limits = limits;
    this.clock = clock;
    this.idFactory = idFactory;
    this.onUpdate = onUpdate;
    this.onCleanup = onCleanup;
    this.jobs = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.closed = false;
  }

  _snapshot(job) {
    return Object.freeze({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      progress: job.progress ? Object.freeze({ ...job.progress }) : null,
      report: job.report ? structuredClone(job.report) : null,
      error: job.error ? Object.freeze({ ...job.error }) : null,
      filename: job.filename,
      resultReady: job.status === 'completed' && Boolean(job.result),
      resultBytes: job.result?.length || 0,
    });
  }

  _notify(job) {
    if (typeof this.onUpdate !== 'function' || job.disposed) return;
    try {
      this.onUpdate(this._snapshot(job));
    } catch {
      // Observers cannot change job state.
    }
  }

  createJob(input) {
    if (this.closed) throw new IngestionJobError('The ingestion service is closed.', 'service_closed', { status: 503 });
    if (this.jobs.size >= this.limits.maxRetainedJobs) {
      throw new IngestionJobError('Too many ingestion results are waiting to expire.', 'job_limit', { status: 429 });
    }
    if (this.activeCount >= this.limits.maxActiveJobs && this.queue.length >= this.limits.maxQueuedJobs) {
      throw new IngestionJobError('The ingestion queue is full.', 'queue_full', { status: 429 });
    }
    const validated = validateCreateInput(input, this.limits.maxSourceChars);
    const id = String(this.idFactory());
    if (!id || this.jobs.has(id)) throw new IngestionJobError('Could not allocate an ingestion job.', 'job_id_error', { status: 500 });
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const job = {
      id,
      status: 'queued',
      createdAt: safeIso(this.clock),
      startedAt: null,
      completedAt: null,
      expiresAt: null,
      progress: { phase: 'queued', status: 'queued', progress: 0 },
      source: sourceCopy(validated),
      sourceCleared: false,
      result: null,
      resultCleared: false,
      report: null,
      error: null,
      filename: safeFilename(validated.metadata.title),
      controller: new AbortController(),
      expiryTimer: null,
      disposed: false,
      done,
      resolveDone,
      doneSettled: false,
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this._notify(job);
    this._pump();
    return this._snapshot(job);
  }

  _pump() {
    if (this.closed) return;
    while (this.activeCount < this.limits.maxActiveJobs && this.queue.length) {
      const id = this.queue.shift();
      const job = this.jobs.get(id);
      if (!job || job.disposed || job.status !== 'queued') continue;
      this.activeCount += 1;
      void this._run(job);
    }
  }

  async _run(job) {
    job.status = 'running';
    job.startedAt = safeIso(this.clock);
    job.progress = { phase: 'prepared', status: 'started', progress: 0 };
    this._notify(job);
    try {
      const agentResult = await this.runAgent(job.source, {
        ...this.agentOptions,
        signal: job.controller.signal,
        onProgress: (event) => {
          if (job.disposed || job.controller.signal.aborted) return;
          job.progress = safeProgress(event);
          this._notify(job);
        },
      });
      zeroSource(job);
      if (job.disposed) return;
      if (job.controller.signal.aborted) throw new DOMException('The ingestion was cancelled.', 'AbortError');
      job.progress = { phase: 'packaging', status: 'started', progress: 0.96 };
      this._notify(job);
      const built = await this.epubBuilder({
        metadata: {
          title: agentResult.metadata?.title || 'untitled reading',
          author: agentResult.metadata?.author || 'unknown',
          language: agentResult.metadata?.language || 'en',
          identifier: agentResult.metadata?.identifier || '',
          description: 'faithfully remediated from extracted page text',
        },
        sections: agentResult.sections,
      });
      const buffer = Buffer.isBuffer(built) ? built : built?.buffer;
      const epubReport = Buffer.isBuffer(built) ? null : built?.report;
      if (!Buffer.isBuffer(buffer) || buffer.length < 1) {
        throw new IngestionJobError('The EPUB builder returned no archive.', 'epub_build_failed', { status: 500 });
      }
      if (buffer.length > this.limits.maxEpubBytes) {
        buffer.fill(0);
        throw new IngestionJobError('The generated EPUB exceeds the result-size limit.', 'result_too_large', { status: 413 });
      }
      job.progress = { phase: 'validating', status: 'started', progress: 0.99 };
      this._notify(job);
      if (job.disposed) {
        buffer.fill(0);
        return;
      }
      job.result = buffer;
      job.report = {
        ingestion: agentResult.report || null,
        epub: epubReport || null,
      };
      job.status = 'completed';
      job.progress = { phase: 'complete', status: 'completed', progress: 1 };
      this._finish(job);
    } catch (error) {
      zeroSource(job);
      if (job.disposed) return;
      const cancelled = job.controller.signal.aborted || error?.name === 'AbortError';
      job.status = cancelled ? 'cancelled' : 'failed';
      job.error = cancelled
        ? { code: 'cancelled', message: 'The ingestion was cancelled.' }
        : safeFailure(error);
      job.progress = { phase: 'complete', status: job.status, progress: 1 };
      this._finish(job);
    } finally {
      this.activeCount -= 1;
      this._pump();
    }
  }

  _finish(job) {
    job.completedAt = safeIso(this.clock);
    job.expiresAt = new Date(this.clock() + this.limits.ttlMs).toISOString();
    this._notify(job);
    if (!job.doneSettled) {
      job.doneSettled = true;
      job.resolveDone(this._snapshot(job));
    }
    job.expiryTimer = setTimeout(() => this.cleanupJob(job.id), this.limits.ttlMs);
    job.expiryTimer.unref?.();
  }

  getJob(id) {
    const job = this.jobs.get(String(id));
    return job && !job.disposed ? this._snapshot(job) : null;
  }

  async waitForJob(id) {
    const job = this.jobs.get(String(id));
    if (!job || job.disposed) throw new IngestionJobError('Ingestion job not found.', 'job_not_found', { status: 404 });
    await job.done;
    return this.getJob(id);
  }

  getResult(id) {
    const job = this.jobs.get(String(id));
    if (!job || job.disposed) throw new IngestionJobError('Ingestion job not found.', 'job_not_found', { status: 404 });
    if (job.status !== 'completed' || !job.result) {
      throw new IngestionJobError('The EPUB is not ready.', 'result_not_ready', { status: 409 });
    }
    return {
      buffer: Buffer.from(job.result),
      filename: job.filename,
      report: structuredClone(job.report),
    };
  }

  cancelJob(id) {
    const job = this.jobs.get(String(id));
    if (!job || job.disposed || ['completed', 'failed', 'cancelled'].includes(job.status)) return false;
    if (job.status === 'queued') {
      this.queue = this.queue.filter((queuedId) => queuedId !== job.id);
      job.controller.abort();
      zeroSource(job);
      job.status = 'cancelled';
      job.error = { code: 'cancelled', message: 'The ingestion was cancelled.' };
      job.progress = { phase: 'complete', status: 'cancelled', progress: 1 };
      this._finish(job);
      this._pump();
      return true;
    }
    job.controller.abort();
    job.status = 'cancelling';
    job.progress = { ...job.progress, status: 'cancelling' };
    this._notify(job);
    return true;
  }

  cleanupExpired(now = this.clock()) {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.expiresAt && Date.parse(job.expiresAt) <= now && this.cleanupJob(job.id)) count += 1;
    }
    return count;
  }

  cleanupJob(id) {
    const job = this.jobs.get(String(id));
    if (!job || job.disposed) return false;
    job.disposed = true;
    clearTimeout(job.expiryTimer);
    job.controller.abort();
    this.queue = this.queue.filter((queuedId) => queuedId !== job.id);
    const sourceCleared = zeroSource(job) || job.sourceCleared;
    const resultCleared = zeroResult(job) || job.resultCleared;
    job.report = null;
    job.error = null;
    this.jobs.delete(job.id);
    if (!job.doneSettled) {
      job.doneSettled = true;
      job.resolveDone(null);
    }
    if (typeof this.onCleanup === 'function') {
      try {
        this.onCleanup(Object.freeze({ id: job.id, sourceCleared, resultCleared }));
      } catch {
        // Cleanup is final even when observation fails.
      }
    }
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.jobs.keys()]) this.cleanupJob(id);
    this.queue = [];
  }
}

export function createIngestionJobManager(options) {
  return new IngestionJobManager(options);
}
