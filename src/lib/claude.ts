import type { Variant, VariantError } from '../types/llm';

async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error) return data.error;
  } catch {
    // body was not JSON; fall through to the status-based message
  }
  return fallback;
}

export async function* streamRefinement(params: {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): AsyncGenerator<string, void, undefined> {
  const response = await fetch('/api/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Refinement failed: ${response.status}`)
    );
  }

  if (!response.body) {
    throw new Error('Refinement response had no body to stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6);
      if (payload === '[DONE]') return;

      let parsed: { error?: string; text?: string };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.text) yield parsed.text;
    }
  }
}

export async function generateVariantsApi(params: {
  systemPrompt: string;
  userMessage: string;
  temperatures: Array<{ label: Variant['label']; temperature: number }>;
}): Promise<{ variants: Variant[]; errors: VariantError[] }> {
  const response = await fetch('/api/variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Variant generation failed: ${response.status}`
      )
    );
  }

  const data = (await response.json()) as {
    variants?: Variant[];
    errors?: VariantError[];
  };
  return { variants: data.variants ?? [], errors: data.errors ?? [] };
}
