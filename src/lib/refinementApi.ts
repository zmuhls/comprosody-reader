import { cadenceApiUrl } from './urls';

export interface RefineParams {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  signal?: AbortSignal;
}

export interface VariantParams extends RefineParams {
  label: string;
}

type RefinementStreamEvent =
  | { kind: 'done' }
  | { kind: 'ignore' }
  | { kind: 'text'; text: string };

function parseRefinementStreamEvent(event: string): RefinementStreamEvent {
  const dataLines: string[] = [];

  for (const line of event.split(/\r?\n/u)) {
    if (line.startsWith(':')) continue;
    if (line === 'data:') {
      dataLines.push('');
      continue;
    }
    if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
      continue;
    }

    throw new Error('Malformed refinement stream event.');
  }

  if (dataLines.length === 0) return { kind: 'ignore' };

  const payload = dataLines.join('\n');
  if (payload === '[DONE]') return { kind: 'done' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Malformed refinement stream payload.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Malformed refinement stream payload.');
  }

  const record = parsed as Record<string, unknown>;
  if ('error' in record) {
    if (typeof record.error !== 'string' || record.error.trim().length === 0) {
      throw new Error('Malformed refinement stream payload.');
    }
    throw new Error(record.error);
  }
  if (typeof record.text !== 'string') {
    throw new Error('Malformed refinement stream payload.');
  }

  return { kind: 'text', text: record.text };
}

export async function* streamRefinement(params: RefineParams): AsyncGenerator<string, void, undefined> {
  const response = await fetch(cadenceApiUrl('/refine'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: params.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Refinement failed: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Refinement returned no response stream.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.match(/\r?\n\r?\n/u);
      while (boundary?.index !== undefined) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);

        const parsed = parseRefinementStreamEvent(event);
        if (parsed.kind === 'done') return;
        if (parsed.kind === 'text') yield parsed.text;

        boundary = buffer.match(/\r?\n\r?\n/u);
      }
    }

    buffer += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  if (buffer.trim().length > 0) {
    throw new Error('Refinement stream ended with an incomplete event.');
  }
  throw new Error('Refinement stream ended before completion.');
}

export async function refineComplete(params: RefineParams): Promise<string> {
  const response = await fetch(cadenceApiUrl('/refine/complete'), {
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
}): Promise<{
  variants: Array<{ label: 'cool' | 'warm' | 'hot'; temperature: number; text: string }>;
  errors: Array<{ label: 'cool' | 'warm' | 'hot'; error: string }>;
}> {
  const response = await fetch(cadenceApiUrl('/variants'), {
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
  return {
    variants: Array.isArray(data.variants) ? data.variants : [],
    errors: Array.isArray(data.errors) ? data.errors : [],
  };
}
