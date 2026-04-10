export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countParagraphs(text: string): number {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.length;
}

export function deriveEntryName(text: string, fallback = 'Untitled'): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;

  const firstThought = cleaned.split(/(?<=[.!?])\s+|\n/)[0] ?? cleaned;
  const normalized = firstThought.replace(/^[^A-Za-z0-9]+/, '').trim();
  const title = normalized
    .split(/\s+/)
    .slice(0, 6)
    .join(' ')
    .replace(/[.,;:!?-]+$/, '')
    .trim();

  if (!title) return fallback;

  return title[0].toUpperCase() + title.slice(1);
}
