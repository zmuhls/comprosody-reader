import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INGESTION_SYSTEM_PROMPT,
  OLLAMA_CLOUD_ENDPOINT,
  OLLAMA_CLOUD_MODEL,
  runIngestionAgent,
} from '../lib/ingestion-agent.js';

function successfulModel(requestLog, {
  contentFor = ({ target, candidate }) => candidate || target,
  mutateArguments = (argumentsObject) => argumentsObject,
  expectedKey = 'unit-test-placeholder',
} = {}) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    const user = JSON.parse(body.messages[1].content);
    const tool = body.tools[0].function;
    const properties = tool.parameters.properties;
    requestLog.push({
      url,
      model: body.model,
      stream: body.stream,
      authValid: options.headers.Authorization === `Bearer ${expectedKey}`,
      cycle: user.requested_cycle,
      targetLength: user.target_source.length,
      beforeLength: user.context_before_do_not_output.length,
      afterLength: user.context_after_do_not_output.length,
      system: body.messages[0].content,
      toolName: tool.name,
    });
    const result = mutateArguments({
      cycle: user.requested_cycle,
      chunk_id: user.chunk_id,
      source_fingerprint: user.source_fingerprint,
      source_page_start: user.source_pages.start,
      source_page_end: user.source_pages.end,
      content: contentFor({
        cycle: user.requested_cycle,
        target: user.target_source,
        candidate: user.candidate_from_previous_cycle,
      }),
      changes: [{
        kind: user.requested_cycle === 'structure' ? 'structure' : 'none',
        summary: 'source-supported normalization only',
        source_page: user.source_pages.start,
      }],
      unresolved: [],
      fidelity: { preserved_order: true, no_invented_content: true },
    }, { body, user, properties });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'submit_remediation_cycle', arguments: result } }],
        },
      }),
    };
  };
}

test('ingestion agent uses the direct Ollama contract and runs exactly three ordered cycles', async () => {
  const requests = [];
  const progress = [];
  const result = await runIngestionAgent({
    pages: [{ pageNumber: 7, text: 'A faithful paragraph remains in its original order and language.' }],
    metadata: { title: 'Test Reading', author: 'Test Author' },
  }, {
    apiKey: 'unit-test-placeholder',
    fetchImpl: successfulModel(requests),
    maxRetries: 0,
    onProgress: (event) => progress.push(event),
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.cycle), ['structure', 'encoding_ocr', 'fidelity_review']);
  assert.equal(requests.every((request) => request.url === OLLAMA_CLOUD_ENDPOINT), true);
  assert.equal(requests.every((request) => request.model === OLLAMA_CLOUD_MODEL), true);
  assert.equal(requests.every((request) => request.stream === false), true);
  assert.equal(requests.every((request) => request.authValid), true);
  assert.equal(requests.every((request) => request.toolName === 'submit_remediation_cycle'), true);
  assert.match(requests[0].system, /never invent/i);
  assert.match(INGESTION_SYSTEM_PROMPT, /never summarize, paraphrase, translate/i);
  assert.equal(result.report.requestCount, 3);
  assert.equal(result.report.model, 'glm-5.2');
  assert.equal(result.sections.length, 1);
  assert.equal(result.text, 'A faithful paragraph remains in its original order and language.');
  assert.deepEqual(progress.map((event) => `${event.phase}:${event.status}`), [
    'prepared:completed',
    'remediation:started',
    'remediation:completed',
    'remediation:started',
    'remediation:completed',
    'remediation:started',
    'remediation:completed',
    'complete:completed',
  ]);
  assert.equal(progress.at(-1).progress, 1);
});

test('ingestion chunks target text within a bound and supplies bounded overlap context', async () => {
  const requests = [];
  const source = Array.from({ length: 70 }, (_, index) => `word${index}`).join(' ');
  const result = await runIngestionAgent({ pages: [source] }, {
    apiKey: 'unit-test-placeholder',
    fetchImpl: successfulModel(requests),
    maxChunkChars: 80,
    overlapChars: 20,
    maxRetries: 0,
  });

  assert.ok(result.sections.length > 1);
  assert.equal(requests.length, result.sections.length * 3);
  assert.equal(requests.every((request) => request.targetLength <= 80), true);
  assert.equal(requests.every((request) => request.beforeLength <= 20 && request.afterLength <= 20), true);
});

test('fidelity guard rejects fluent invented replacement prose', async () => {
  const requests = [];
  const source = Array.from({ length: 55 }, (_, index) => `sourceword${index}`).join(' ');
  const invented = Array.from({ length: 55 }, (_, index) => `inventedword${index}`).join(' ');
  await assert.rejects(
    runIngestionAgent({ pages: [source] }, {
      apiKey: 'unit-test-placeholder',
      fetchImpl: successfulModel(requests, { contentFor: () => invented }),
      maxRetries: 0,
    }),
    (error) => error?.code === 'fidelity_guard',
  );
  assert.equal(requests.length, 1);
});

test('strict server validation rejects extra tool fields', async () => {
  const requests = [];
  await assert.rejects(
    runIngestionAgent({ pages: ['Source text is kept as documentary evidence.'] }, {
      apiKey: 'unit-test-placeholder',
      fetchImpl: successfulModel(requests, {
        mutateArguments: (result) => ({ ...result, commentary: 'not allowed' }),
      }),
      maxRetries: 0,
    }),
    (error) => error?.code === 'invalid_model_response',
  );
});

test('transient Ollama failures retry without changing the three-cycle result', async () => {
  const requests = [];
  const success = successfulModel(requests);
  let attempts = 0;
  const fetchImpl = async (url, options) => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 503 };
    return success(url, options);
  };
  const result = await runIngestionAgent({ pages: ['A retry must not alter the source text.'] }, {
    apiKey: 'unit-test-placeholder',
    fetchImpl,
    maxRetries: 1,
    retryDelayMs: 0,
  });
  assert.equal(attempts, 4);
  assert.equal(result.report.requestCount, 3);
  assert.equal(result.text, 'A retry must not alter the source text.');
});

test('HTTP failures expose only a redacted status-level error', async () => {
  const placeholder = 'unit-test-placeholder';
  await assert.rejects(
    runIngestionAgent({ pages: ['Source text.'] }, {
      apiKey: placeholder,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => `server echoed ${placeholder}`,
      }),
      maxRetries: 0,
    }),
    (error) => error?.code === 'ollama_http_error'
      && error?.status === 401
      && !error.message.includes(placeholder),
  );
});

test('per-request timeout aborts a nonresponsive model call', async () => {
  await assert.rejects(
    runIngestionAgent({ pages: ['Source text waits for no model indefinitely.'] }, {
      apiKey: 'unit-test-placeholder',
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
      timeoutMs: 100,
      maxRetries: 0,
    }),
    (error) => error?.code === 'ollama_timeout',
  );
});

test('cancellation stops work before a model request and preserves AbortError semantics', async () => {
  const controller = new AbortController();
  let fetchCalls = 0;
  await assert.rejects(
    runIngestionAgent({ pages: ['Text that will not be sent after cancellation.'] }, {
      apiKey: 'unit-test-placeholder',
      signal: controller.signal,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('must not run');
      },
      maxRetries: 0,
      onProgress: (event) => {
        if (event.phase === 'remediation' && event.status === 'started') controller.abort();
      },
    }),
    (error) => error?.name === 'AbortError',
  );
  assert.equal(fetchCalls, 0);
});

test('binary and PDF-shaped inputs are rejected before fetch', async () => {
  await assert.rejects(
    runIngestionAgent({ pages: ['text'], pdf: Buffer.from('not accepted') }, {
      apiKey: 'unit-test-placeholder',
      fetchImpl: async () => {
        throw new Error('must not run');
      },
    }),
    (error) => error?.code === 'invalid_input',
  );
  await assert.rejects(
    runIngestionAgent({ pages: [Buffer.from('not accepted')] }, {
      apiKey: 'unit-test-placeholder',
      fetchImpl: async () => {
        throw new Error('must not run');
      },
    }),
    (error) => error?.code === 'invalid_input',
  );
});
