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
    throw new Error(`Refinement failed: ${response.status}`);
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

      const parsed = JSON.parse(payload);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.text) yield parsed.text;
    }
  }
}

export async function refineComplete(params: {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): Promise<string> {
  const response = await fetch('/api/refine/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Refinement failed: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}

export async function generateVariantsApi(params: {
  systemPrompt: string;
  userMessage: string;
  temperatures: Array<{ label: string; temperature: number }>;
}): Promise<Array<{ label: string; temperature: number; text: string }>> {
  const response = await fetch('/api/variants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Variant generation failed: ${response.status}`);
  }

  const data = await response.json();
  return data.variants;
}
