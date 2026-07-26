import { getApiKey } from './claude.js';

export interface TranscriptionResult {
  transcript: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterTranscriptionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function audioFormatFromContentType(contentType: string | undefined): string {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (mime.includes('mp4') || mime.includes('m4a')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export async function transcribe(
  audioBuffer: Buffer,
  format: string
): Promise<TranscriptionResult> {
  const transcribeModel =
    process.env.OPENROUTER_TRANSCRIBE_MODEL || 'google/gemini-2.5-flash';

  const base64Audio = audioBuffer.toString('base64');

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
        'HTTP-Referer': 'https://github.com/zmuhls/comprosody-reader',
        'X-Title': 'comprosody',
      },
      body: JSON.stringify({
        model: transcribeModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe this audio recording exactly as spoken. Return only the transcribed text, nothing else. No commentary, labels, or formatting.',
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format,
                },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Transcription error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as OpenRouterTranscriptionResponse;
    const transcript = data.choices?.[0]?.message?.content?.trim() ?? '';

    if (!transcript) {
      throw new Error('No transcription returned');
    }

    return { transcript };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Transcription request timed out after 120s');
    }
    throw err;
  }
}
