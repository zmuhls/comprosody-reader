export interface RefineParams {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  signal?: AbortSignal;
}

export interface VariantParams extends RefineParams {
  label: string;
}

export async function* streamRefinement(params: RefineParams): AsyncGenerator<string, void, undefined> {
  const response = await fetch('/api/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Refinement failed: ${response.status}`);
  }

  const reader = response.body!.getReader();
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

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) yield parsed.text;
      } catch (err) {
        if (err instanceof SyntaxError) {
          console.error('Malformed SSE payload:', payload);
          continue;
        }
        throw err;
      }
    }
  }
}

export async function refineComplete(params: RefineParams): Promise<string> {
  const response = await fetch('/api/refine/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Refinement failed: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}

export async function generateVariantsApi(params: {
  systemPrompt: string;
  userMessage: string;
  temperatures: Array<{ label: string; temperature: number }>;
  signal?: AbortSignal;
}): Promise<Array<{ label: string; temperature: number; text: string }>> {
  const response = await fetch('/api/variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Variant generation failed: ${response.status}`);
  }

  const data = await response.json();
  return data.variants;
}
