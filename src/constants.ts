import type { GenreRegister, Scale } from './types/llm';

export const GENRES: { value: GenreRegister; label: string }[] = [
  { value: 'academic', label: 'Academic' },
  { value: 'narrative', label: 'Narrative' },
  { value: 'analytical', label: 'Analytical' },
  { value: 'field-journal', label: 'Field Journal' },
  { value: 'freewrite', label: 'Freewrite' },
];

export const SCALES: { value: Scale; label: string }[] = [
  { value: 'word', label: 'Word' },
  { value: 'phrase', label: 'Phrase' },
  { value: 'clause', label: 'Clause' },
  { value: 'sentence', label: 'Sentence' },
  { value: 'paragraph', label: 'Paragraph' },
];

export const DEFAULT_TEMPERATURE = 0.5;

export const VARIANT_TEMPERATURES = [
  { label: 'cool' as const, temperature: 0.2 },
  { label: 'warm' as const, temperature: 0.5 },
  { label: 'hot' as const, temperature: 0.9 },
];

export const STORAGE_KEYS = {
  entries: 'comprosody:entries',
  directories: 'comprosody:directories',
  settings: 'comprosody:settings',
} as const;
