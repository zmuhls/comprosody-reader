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

/**
 * Bias decoding toward spellings the speaker has taught the app. Hedged on
 * purpose — the model must not force a term onto audio that does not support
 * it, or the hint would corrupt transcripts instead of correcting them.
 */
export function buildVocabularyPrompt(vocabulary: string[]): string {
  return [
    'The speaker uses the following vocabulary: proper nouns, technical terms,',
    'and names that are easily misheard. When the audio is consistent with one',
    'of these, prefer its exact spelling. Do not force these words onto audio',
    `that does not support them: ${vocabulary.join(', ')}`,
  ].join(' ');
}

export async function transcribe(
  audioBuffer: Buffer,
  format: string,
  vocabulary: string[] = []
): Promise<TranscriptionResult> {
  const transcribeModel =
    process.env.OPENROUTER_TRANSCRIBE_MODEL || 'google/gemini-2.5-flash';

  const base64Audio = audioBuffer.toString('base64');

  const messages: unknown[] = [];
  if (vocabulary.length > 0) {
    messages.push({
      role: 'system',
      content: buildVocabularyPrompt(vocabulary),
    });
  }
  messages.push({
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
  });

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
        messages,
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
