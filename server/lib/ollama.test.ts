import { describe, expect, it, vi } from 'vitest';
import {
  OllamaRefinementError,
  createOllamaRefinementProvider,
  type RefineParams,
} from './ollama.js';

const params: RefineParams = {
  systemPrompt: 'Preserve the writer’s thought and wording.',
  userMessage: 'Join this dictated fragment.',
  temperature: 0.2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    },
  );
}

describe('Ollama Cloud refinement provider', () => {
  it('defaults to the direct Ollama Cloud endpoint and qwen3.5:397b', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        message: { role: 'assistant', content: 'Default response.' },
        done: true,
      }),
    );
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
    });

    await provider.refineComplete(params);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://ollama.com/api/chat');
    expect(JSON.parse(String(init.body)).model).toBe('qwen3.5:397b');
  });

  it('accepts an /api base without duplicating the API path', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        message: { role: 'assistant', content: 'Configured response.' },
        done: true,
      }),
    );
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
      getBaseUrl: () => 'https://ollama.example/api/',
    });

    await provider.refineComplete(params);

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://ollama.example/api/chat',
    );
  });

  it('uses the direct chat contract with server-only auth and configured generation options', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        message: { role: 'assistant', content: 'A faithful revision.' },
        done: true,
      }),
    );
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
      getBaseUrl: () => 'https://ollama.example/private/',
      getModel: () => 'qwen3.5:397b',
      getMaxTokens: () => '4096',
    });

    await expect(provider.refineComplete(params)).resolves.toBe(
      'A faithful revision.',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://ollama.example/private/api/chat');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(
      'Bearer unit-test-placeholder',
    );
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: 'qwen3.5:397b',
      stream: false,
      think: false,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userMessage },
      ],
      options: { temperature: 0.2, num_predict: 4096 },
    });
    expect(String(init.body)).not.toContain('unit-test-placeholder');
  });

  it('streams only assistant content and requires Ollama’s explicit done marker', async () => {
    const fetchMock = vi.fn(async () =>
      ndjsonResponse([
        '{"message":{"role":"assistant","content":"Joined "},"done":false}\n',
        '{"message":{"role":"assistant","content":"prose."},"done":',
        'true}\n',
      ]),
    );
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
    });

    const output: string[] = [];
    for await (const chunk of provider.streamRefinement(params)) {
      output.push(chunk);
    }

    expect(output).toEqual(['Joined ', 'prose.']);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).stream).toBe(true);
    expect(new Headers(init.headers).get('accept')).toBe(
      'application/x-ndjson',
    );
  });

  it('rejects a truncated stream instead of accepting partial prose', async () => {
    const provider = createOllamaRefinementProvider({
      fetchImpl: vi.fn(async () =>
        ndjsonResponse([
          '{"message":{"role":"assistant","content":"Partial"},"done":false}\n',
        ]),
      ) as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
    });

    const collect = async () => {
      const output: string[] = [];
      for await (const chunk of provider.streamRefinement(params)) {
        output.push(chunk);
      }
      return output;
    };

    await expect(collect()).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
      message: 'Ollama Cloud stream ended before completion',
    });
  });

  it('recognizes a redacted provider error in the middle of a stream', async () => {
    const providerMessage = 'provider echoed private request material';
    const provider = createOllamaRefinementProvider({
      fetchImpl: vi.fn(async () =>
        ndjsonResponse([
          '{"message":{"role":"assistant","content":"Partial"},"done":false}\n',
          `${JSON.stringify({ error: providerMessage })}\n`,
        ]),
      ) as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
    });

    const collect = async () => {
      for await (const chunk of provider.streamRefinement(params)) {
        // Consume until the provider error is encountered.
        void chunk;
      }
    };

    await expect(collect()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(providerMessage) &&
        error.message === 'Ollama Cloud could not complete the refinement',
    );
  });

  it('fails closed before fetch when the API key is absent', async () => {
    const fetchMock = vi.fn();
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => undefined,
    });

    await expect(provider.refineComplete(params)).rejects.toMatchObject({
      status: 503,
      code: 'configuration',
      message: 'OLLAMA_API_KEY is not configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'base URL',
      options: { getBaseUrl: () => 'file:///tmp/model' },
      message: 'OLLAMA_BASE_URL must use HTTP or HTTPS',
    },
    {
      label: 'model',
      options: { getModel: () => 'qwen3.5:397b\\nmalformed' },
      message: 'OLLAMA_MODEL is invalid',
    },
    {
      label: 'maximum token count',
      options: { getMaxTokens: () => '8192 tokens' },
      message: 'OLLAMA_MAX_TOKENS is invalid',
    },
  ])('rejects an invalid configured $label before fetch', async ({
    options,
    message,
  }) => {
    const fetchMock = vi.fn();
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
      ...options,
    });

    await expect(provider.refineComplete(params)).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries bounded transient failures before a stream starts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        ndjsonResponse([
          '{"message":{"role":"assistant","content":"Recovered."},"done":true}\n',
        ]),
      );
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
      maxRetries: 2,
      retryDelayMs: 0,
    });

    const output: string[] = [];
    for await (const chunk of provider.streamRefinement(params)) {
      output.push(chunk);
    }

    expect(output).toEqual(['Recovered.']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient authentication failures', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
      maxRetries: 2,
      retryDelayMs: 0,
    });

    await expect(provider.refineComplete(params)).rejects.toMatchObject({
      status: 401,
      code: 'authentication',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('stops retry backoff immediately when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => {
      controller.abort();
      return new Response(null, { status: 503 });
    });
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
      maxRetries: 2,
      retryDelayMs: 10_000,
    });

    await expect(
      provider.refineComplete({ ...params, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('redacts upstream error bodies and credentials from surfaced errors', async () => {
    const bodyReader = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: bodyReader,
      json: bodyReader,
    }));
    const provider = createOllamaRefinementProvider({
      fetchImpl: fetchMock as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
    });

    let error: unknown;
    try {
      await provider.refineComplete(params);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(OllamaRefinementError);
    expect(error).toMatchObject({
      status: 401,
      code: 'authentication',
      message: 'Invalid Ollama API key',
    });
    expect(String(error)).not.toContain('unit-test-placeholder');
    expect(bodyReader).not.toHaveBeenCalled();
  });

  it('never surfaces a provider-supplied error string from a successful HTTP envelope', async () => {
    const providerMessage = 'provider echoed private request material';
    const provider = createOllamaRefinementProvider({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ error: providerMessage, done: true }),
      ) as unknown as typeof fetch,
      getApiKey: () => 'unit-test-placeholder',
    });

    await expect(provider.refineComplete(params)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(providerMessage) &&
        error.message === 'Ollama Cloud could not complete the refinement',
    );
  });
});
