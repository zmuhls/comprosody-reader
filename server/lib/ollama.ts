const DEFAULT_OLLAMA_BASE_URL = 'https://ollama.com';
const DEFAULT_OLLAMA_MODEL = 'qwen3.5:397b';
const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_CONFIGURED_TOKENS = 131_072;

export type OllamaRefinementErrorCode =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'bad_request'
  | 'upstream'
  | 'invalid_response'
  | 'network';

export class OllamaRefinementError extends Error {
  readonly status: number;
  readonly code: OllamaRefinementErrorCode;

  constructor(
    message: string,
    status: number,
    code: OllamaRefinementErrorCode,
  ) {
    super(message);
    this.name = 'OllamaRefinementError';
    this.status = status;
    this.code = code;
  }
}

export interface RefineParams {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  signal?: AbortSignal;
}

interface OllamaChatChunk {
  done: boolean;
  text: string;
}

interface OllamaRefinementProviderOptions {
  fetchImpl?: typeof fetch;
  getApiKey?: () => string | undefined;
  getBaseUrl?: () => string | undefined;
  getModel?: () => string | undefined;
  getMaxTokens?: () => string | undefined;
  maxRetries?: number;
  retryDelayMs?: number;
}

function requiredApiKey(getApiKey: () => string | undefined): string {
  const apiKey = getApiKey()?.trim();
  if (!apiKey) {
    throw new OllamaRefinementError(
      'OLLAMA_API_KEY is not configured',
      503,
      'configuration',
    );
  }
  return apiKey;
}

function endpointFromBaseUrl(value: string | undefined): string {
  const configured = value?.trim() || DEFAULT_OLLAMA_BASE_URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(configured);
  } catch {
    throw new OllamaRefinementError(
      'OLLAMA_BASE_URL is invalid',
      503,
      'configuration',
    );
  }
  if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
    throw new OllamaRefinementError(
      'OLLAMA_BASE_URL must use HTTP or HTTPS',
      503,
      'configuration',
    );
  }
  if (baseUrl.username || baseUrl.password) {
    throw new OllamaRefinementError(
      'OLLAMA_BASE_URL must not contain credentials',
      503,
      'configuration',
    );
  }
  const path = baseUrl.pathname.replace(/\/+$/u, '');
  if (path.endsWith('/api/chat')) {
    baseUrl.pathname = path;
  } else if (path.endsWith('/api')) {
    baseUrl.pathname = `${path}/chat`;
  } else {
    baseUrl.pathname = `${path}/api/chat`;
  }
  baseUrl.search = '';
  baseUrl.hash = '';
  return baseUrl.toString();
}

function configuredModel(value: string | undefined): string {
  const model = value?.trim() || DEFAULT_OLLAMA_MODEL;
  if (
    model.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(model)
  ) {
    throw new OllamaRefinementError(
      'OLLAMA_MODEL is invalid',
      503,
      'configuration',
    );
  }
  return model;
}

function configuredMaxTokens(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_MAX_TOKENS;
  if (!/^\d+$/u.test(value.trim())) {
    throw new OllamaRefinementError(
      'OLLAMA_MAX_TOKENS is invalid',
      503,
      'configuration',
    );
  }
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_CONFIGURED_TOKENS
  ) {
    throw new OllamaRefinementError(
      `OLLAMA_MAX_TOKENS must be between 1 and ${MAX_CONFIGURED_TOKENS}`,
      503,
      'configuration',
    );
  }
  return parsed;
}

function requestBody(
  params: RefineParams,
  model: string,
  maxTokens: number,
  stream: boolean,
): string {
  return JSON.stringify({
    model,
    stream,
    think: false,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userMessage },
    ],
    options: {
      temperature: params.temperature,
      num_predict: maxTokens,
    },
  });
}

function errorForStatus(status: number): OllamaRefinementError {
  if (status === 401 || status === 403) {
    return new OllamaRefinementError(
      'Invalid Ollama API key',
      401,
      'authentication',
    );
  }
  if (status === 429) {
    return new OllamaRefinementError(
      'Ollama Cloud rate limited the request — retry shortly',
      429,
      'rate_limit',
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new OllamaRefinementError(
      'Ollama Cloud rejected the refinement request',
      400,
      'bad_request',
    );
  }
  if (status === 408) {
    return new OllamaRefinementError(
      'Ollama Cloud request timed out',
      504,
      'upstream',
    );
  }
  return new OllamaRefinementError(
    `Ollama Cloud request failed (HTTP ${status})`,
    status >= 500 && status <= 599 ? 502 : 500,
    'upstream',
  );
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 502 ||
    (status >= 500 && status <= 599)
  );
}

function parseChatPayload(value: unknown): OllamaChatChunk {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OllamaRefinementError(
      'Ollama Cloud returned an invalid refinement response',
      502,
      'invalid_response',
    );
  }
  const payload = value as {
    done?: unknown;
    message?: { content?: unknown };
    error?: unknown;
  };
  if (typeof payload.error === 'string' && payload.error.trim()) {
    throw new OllamaRefinementError(
      'Ollama Cloud could not complete the refinement',
      502,
      'upstream',
    );
  }
  if (
    typeof payload.done !== 'boolean' ||
    typeof payload.message !== 'object' ||
    payload.message === null ||
    typeof payload.message.content !== 'string'
  ) {
    throw new OllamaRefinementError(
      'Ollama Cloud returned an invalid refinement response',
      502,
      'invalid_response',
    );
  }
  return { done: payload.done, text: payload.message.content };
}

function parseNdjsonLine(line: string): OllamaChatChunk | null {
  const normalized = line.trim();
  if (!normalized) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(normalized);
  } catch {
    throw new OllamaRefinementError(
      'Ollama Cloud returned malformed streaming data',
      502,
      'invalid_response',
    );
  }
  return parseChatPayload(payload);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function normalizeNetworkError(error: unknown): never {
  if (isAbortError(error)) throw error;
  if (error instanceof OllamaRefinementError) throw error;
  throw new OllamaRefinementError(
    'Ollama Cloud request failed (network error)',
    502,
    'network',
  );
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException('The refinement request was aborted', 'AbortError');
}

async function abortableDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(signal ? abortError(signal) : new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createOllamaRefinementProvider(
  options: OllamaRefinementProviderOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const getApiKey = options.getApiKey ?? (() => process.env.OLLAMA_API_KEY);
  const getBaseUrl =
    options.getBaseUrl ?? (() => process.env.OLLAMA_BASE_URL);
  const getModel = options.getModel ?? (() => process.env.OLLAMA_MODEL);
  const getMaxTokens =
    options.getMaxTokens ?? (() => process.env.OLLAMA_MAX_TOKENS);
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  async function request(
    params: RefineParams,
    stream: boolean,
  ): Promise<Response> {
    const apiKey = requiredApiKey(getApiKey);
    if (typeof fetchImpl !== 'function') {
      throw new OllamaRefinementError(
        'No fetch implementation is available',
        503,
        'configuration',
      );
    }
    const endpoint = endpointFromBaseUrl(getBaseUrl());
    const body = requestBody(
      params,
      configuredModel(getModel()),
      configuredMaxTokens(getMaxTokens()),
      stream,
    );
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (params.signal?.aborted) throw abortError(params.signal);
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: stream ? 'application/x-ndjson' : 'application/json',
          },
          body,
          signal: params.signal,
        });
        if (response.ok) return response;
        if (!isRetryableStatus(response.status) || attempt === maxRetries) {
          throw errorForStatus(response.status);
        }
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (
          params.signal?.aborted ||
          isAbortError(error) ||
          error instanceof OllamaRefinementError
        ) {
          return normalizeNetworkError(error);
        }
        if (attempt === maxRetries) return normalizeNetworkError(error);
      }
      await abortableDelay(retryDelayMs * (2 ** attempt), params.signal);
    }
    throw new OllamaRefinementError(
      'Ollama Cloud request failed',
      502,
      'network',
    );
  }

  async function* streamRefinement(
    params: RefineParams,
  ): AsyncGenerator<string, void, undefined> {
    const response = await request(params, true);
    if (!response.body) {
      throw new OllamaRefinementError(
        'Ollama Cloud returned no response stream',
        502,
        'invalid_response',
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/u);
        buffer = done ? '' : (lines.pop() ?? '');
        if (done && buffer) lines.push(buffer);

        for (const line of lines) {
          const chunk = parseNdjsonLine(line);
          if (!chunk) continue;
          if (chunk.text) yield chunk.text;
          if (chunk.done) return;
        }
        if (done) break;
      }
    } catch (error) {
      return normalizeNetworkError(error);
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    throw new OllamaRefinementError(
      'Ollama Cloud stream ended before completion',
      502,
      'invalid_response',
    );
  }

  async function refineComplete(params: RefineParams): Promise<string> {
    const response = await request(params, false);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OllamaRefinementError(
        'Ollama Cloud returned invalid JSON',
        502,
        'invalid_response',
      );
    }
    const result = parseChatPayload(payload);
    if (!result.done) {
      throw new OllamaRefinementError(
        'Ollama Cloud returned an incomplete refinement',
        502,
        'invalid_response',
      );
    }
    return result.text;
  }

  return { streamRefinement, refineComplete };
}

const provider = createOllamaRefinementProvider();

export const streamRefinement = provider.streamRefinement;
export const refineComplete = provider.refineComplete;
