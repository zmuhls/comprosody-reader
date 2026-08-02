import http from 'node:http';

const port = Number.parseInt(process.env.E2E_API_PORT ?? '3001', 10);

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json',
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeEvent(response, value) {
  if (response.destroyed || response.writableEnded) return;
  response.write(`data: ${JSON.stringify({ text: value })}\n\n`);
}

function delayedRefinement(request, response, body) {
  const isRetry =
    typeof body.systemPrompt === 'string' &&
    body.systemPrompt.includes('Writer guidance for the next proposal');
  const preservesLastMinuteSentence =
    isRetry &&
    typeof body.userMessage === 'string' &&
    body.userMessage.includes("Writer's last-minute sentence.");
  const chunks = preservesLastMinuteSentence
    ? [
        "Writer's last-minute sentence remains ",
        'while the transition is repaired.',
      ]
    : isRetry
    ? [
        'The archive matters; its recurring claim is that ',
        'public memory remains contested.',
      ]
    : [
        'The archive matters because ',
        'public memory is not fixed.',
      ];

  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  response.flushHeaders();
  writeEvent(response, chunks[0]);
  const second = setTimeout(() => writeEvent(response, chunks[1]), 450);
  const done = setTimeout(() => {
    if (!response.destroyed && !response.writableEnded) {
      response.end('data: [DONE]\n\n');
    }
  }, 800);
  const clearTimers = () => {
    clearTimeout(second);
    clearTimeout(done);
  };
  request.once('aborted', clearTimers);
  response.once('close', () => {
    if (!response.writableEnded) clearTimers();
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, {
      ok: true,
      ollama: { available: true, model: 'e2e-refinement-model' },
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/refine') {
    try {
      delayedRefinement(request, response, await readJson(request));
    } catch {
      json(response, 400, { error: 'Invalid request body' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/refine/complete') {
    try {
      const body = await readJson(request);
      const isNoteTitle =
        typeof body.systemPrompt === 'string' &&
        body.systemPrompt.includes('concise, specific titles');
      json(response, 200, {
        text: isNoteTitle
          ? 'Archive and Public Memory'
          : 'A concise completed refinement.',
      });
    } catch {
      json(response, 400, { error: 'Invalid request body' });
    }
    return;
  }

  if (
    request.method === 'POST' &&
    url.pathname === '/api/transcribe/realtime-token'
  ) {
    json(response, 200, {
      token: 'e2e-single-use-realtime-token',
      expiresInSeconds: 900,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/logout') {
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    return;
  }

  json(response, 404, { error: 'Not found' });
});

server.listen(port, '127.0.0.1');

function shutdown() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
