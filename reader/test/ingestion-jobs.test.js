import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IngestionJobManager,
  IngestionJobError,
} from '../lib/ingestion-jobs.js';

function completedAgent(source, { onProgress } = {}) {
  onProgress?.({
    phase: 'complete',
    status: 'completed',
    completedSteps: 3,
    totalSteps: 3,
    progress: 1,
  });
  return Promise.resolve({
    metadata: { title: source.metadata.title || 'test', author: 'author', language: 'en' },
    sections: [{ title: 'page 1', text: source.pages[0].text }],
    report: { model: 'glm-5.2', requestCount: 3 },
  });
}

test('job manager completes transient text ingestion and zeroes retained data on cleanup', async () => {
  let sourceReference;
  const resultReference = Buffer.from('epub-result');
  const cleanupEvents = [];
  let now = 0;
  const manager = new IngestionJobManager({
    runAgent: async (source, options) => {
      sourceReference = source;
      return completedAgent(source, options);
    },
    epubBuilder: async () => ({
      buffer: resultReference,
      report: { format: 'EPUB 3', chapters: 1 },
    }),
    idFactory: () => 'job-1',
    clock: () => now,
    ttlMs: 1_000,
    onCleanup: (event) => cleanupEvents.push(event),
  });

  const created = manager.createJob({
    pages: [{ pageNumber: 1, text: 'already extracted source text' }],
    metadata: { title: 'transient test' },
  });
  const completed = await manager.waitForJob(created.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.resultReady, true);
  assert.equal(completed.report.ingestion.model, 'glm-5.2');
  assert.deepEqual(sourceReference.pages, []);
  assert.deepEqual(sourceReference.metadata, {});
  const download = manager.getResult(created.id);
  assert.equal(download.filename, 'transient-test.epub');
  assert.notEqual(download.buffer, resultReference);
  assert.equal(download.buffer.toString(), 'epub-result');

  now = 1_000;
  assert.equal(manager.cleanupExpired(), 1);
  assert.equal(manager.getJob(created.id), null);
  assert.equal(resultReference.every((byte) => byte === 0), true);
  assert.deepEqual(cleanupEvents, [{ id: 'job-1', sourceCleared: true, resultCleared: true }]);
  manager.close();
});

test('job manager rejects PDF-shaped or binary requests without retaining a job', () => {
  const manager = new IngestionJobManager();
  assert.throws(
    () => manager.createJob({ pages: ['text'], pdf: 'a.pdf' }),
    (error) => error instanceof IngestionJobError && error.code === 'text_only',
  );
  assert.throws(
    () => manager.createJob({ pages: [Buffer.from('binary')] }),
    (error) => error instanceof IngestionJobError && error.code === 'invalid_input',
  );
  assert.equal(manager.jobs.size, 0);
  manager.close();
});

test('job manager enforces active and queued job limits', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let sequence = 0;
  const manager = new IngestionJobManager({
    maxActiveJobs: 1,
    maxQueuedJobs: 1,
    idFactory: () => `job-${++sequence}`,
    runAgent: async (source, options) => {
      await blocked;
      return completedAgent(source, options);
    },
    epubBuilder: async () => ({ buffer: Buffer.from('epub'), report: {} }),
  });
  const first = manager.createJob({ pages: ['first source'] });
  const second = manager.createJob({ pages: ['second source'] });
  assert.equal(manager.getJob(first.id).status, 'running');
  assert.equal(manager.getJob(second.id).status, 'queued');
  assert.throws(
    () => manager.createJob({ pages: ['third source'] }),
    (error) => error?.code === 'queue_full' && error?.status === 429,
  );
  release();
  assert.equal((await manager.waitForJob(first.id)).status, 'completed');
  assert.equal((await manager.waitForJob(second.id)).status, 'completed');
  manager.close();
});

test('cancelling a running job propagates AbortSignal and resolves as cancelled', async () => {
  const manager = new IngestionJobManager({
    idFactory: () => 'cancel-me',
    runAgent: (_source, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }),
    epubBuilder: async () => {
      throw new Error('must not build');
    },
  });
  const created = manager.createJob({ pages: ['source'] });
  assert.equal(manager.cancelJob(created.id), true);
  const finished = await manager.waitForJob(created.id);
  assert.equal(finished.status, 'cancelled');
  assert.deepEqual(finished.error, { code: 'cancelled', message: 'The ingestion was cancelled.' });
  assert.equal(finished.resultReady, false);
  manager.close();
});
