import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function* streamRefinement(params: {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): AsyncGenerator<string, void, undefined> {
  const anthropic = getClient();

  const stream = anthropic.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 64000,
    temperature: params.temperature,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: params.userMessage }],
  });

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text;
    }
  }
}

export async function refineComplete(params: {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): Promise<string> {
  const anthropic = getClient();

  const stream = anthropic.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    temperature: params.temperature,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: params.userMessage }],
  });

  const response = await stream.finalMessage();

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
