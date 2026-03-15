import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (!client || (client as unknown as { apiKey: string }).apiKey !== apiKey) {
    client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });
  }
  return client;
}

export async function* streamRefinement(params: {
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): AsyncGenerator<string, void, undefined> {
  const anthropic = getClient(params.apiKey);

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    temperature: params.temperature,
    system: params.systemPrompt,
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
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
  temperature: number;
}): Promise<string> {
  const anthropic = getClient(params.apiKey);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    temperature: params.temperature,
    system: params.systemPrompt,
    messages: [{ role: 'user', content: params.userMessage }],
  });

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
