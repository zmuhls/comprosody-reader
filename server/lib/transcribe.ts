export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  transcript: string;
  words: WordTimestamp[];
  language: string;
  duration: number;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function transcribe(
  audioBuffer: Buffer,
  _modelSize: string = 'base'
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const transcribeModel =
    process.env.OPENROUTER_TRANSCRIBE_MODEL || 'google/gemini-2.5-flash';

  const base64Audio = audioBuffer.toString('base64');

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
                format: 'webm',
              },
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Transcription error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const transcript = data.choices?.[0]?.message?.content?.trim() ?? '';

  if (!transcript) {
    throw new Error('No transcription returned');
  }

  return {
    transcript,
    words: [],
    language: 'en',
    duration: 0,
  };
}
