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

function getModel(): string {
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
}

function getMaxTokens(): number {
  const parsed = parseInt(process.env.ANTHROPIC_MAX_TOKENS || '8192', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 8192 : parsed;
}

function buildThinkingConfig(maxTokens: number):
  | { type: 'enabled'; budget_tokens: number }
  | undefined {
  const flag = process.env.ANTHROPIC_THINKING;
  if (flag === '0' || flag === 'false' || flag === 'off') return undefined;
  // Claude 3.7+ supports extended thinking via type: 'enabled'.
  // budget_tokens must be < max_tokens and >= 1024.
  const budget = Math.min(4096, Math.max(1024, Math.floor(maxTokens / 4)));
  return { type: 'enabled', budget_tokens: budget };
}

interface RefineParams {
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  signal?: AbortSignal;
}

function buildRequestBody(params: RefineParams) {
  const maxTokens = getMaxTokens();
  const thinking = buildThinkingConfig(maxTokens);
  return {
    model: getModel(),
    max_tokens: maxTokens,
    temperature: params.temperature,
    system: [
      {
        type: 'text' as const,
        text: params.systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [{ role: 'user' as const, content: params.userMessage }],
    ...(thinking ? { thinking } : {}),
  };
}

export async function* streamRefinement(
  params: RefineParams
): AsyncGenerator<string, void, undefined> {
  const anthropic = getClient();
  const stream = anthropic.messages.stream(buildRequestBody(params), {
    signal: params.signal,
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

export async function refineComplete(params: RefineParams): Promise<string> {
  const anthropic = getClient();
  const response = await anthropic.messages.create(
    buildRequestBody(params),
    { signal: params.signal }
  );

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
