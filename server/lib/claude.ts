const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_OUTPUT_TOKENS = 8192;

interface OpenRouterCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  return key;
}

function getModel(): string {
  return process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2-0905';
}

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getApiKey()}`,
    'HTTP-Referer': 'https://github.com/zmuhls/comprosody-reader',
    'X-Title': 'comprosody',
  };
}

export async function* streamRefinement(params: {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  signal?: AbortSignal;
}): AsyncGenerator<string, void, undefined> {
  const controller = new AbortController();
  const signal = params.signal
    ? AbortSignal.any([params.signal, controller.signal])
    : controller.signal;

  // idle timeout: 60s to first byte, reset to 30s after each chunk
  let timedOut = false;
  const arm = (ms: number) =>
    setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  let timer = arm(60_000);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        temperature: params.temperature,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${err}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(timer);
      timer = arm(30_000);

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } catch (err) {
    if (timedOut) throw new Error('OpenRouter stream timed out waiting for tokens');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function refineComplete(params: {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): Promise<string> {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        temperature: params.temperature,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as OpenRouterCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      throw new Error('OpenRouter returned an empty completion');
    }
    return content;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('OpenRouter request timed out after 60s');
    }
    throw err;
  }
}
