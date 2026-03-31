const FUNCTION_WORDS = new Set([
  // Articles, conjunctions, prepositions
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'in', 'on', 'at', 'to', 'of', 'by', 'up', 'as', 'with', 'from',
  'about', 'into', 'over', 'after', 'before', 'between', 'under',
  // Copulas, auxiliaries, modals
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'can', 'could',
  // Pronouns
  'it', 'he', 'she', 'we', 'they', 'i', 'you',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  // Interrogatives, relatives, subordinators
  'not', 'no', 'if', 'then', 'than', 'when', 'what', 'which',
  'who', 'whom', 'how', 'where', 'while', 'because', 'since',
  'until', 'although', 'though', 'whether',
  // Determiners, quantifiers
  'there', 'here', 'some', 'any', 'all', 'more', 'most',
  'many', 'much', 'other', 'each', 'every', 'both', 'few',
  'such', 'only', 'same', 'own', 'either', 'neither',
  // Fillers, discourse markers, intensifiers
  'um', 'uh', 'like', 'just', 'very', 'really', 'also', 'too',
  'oh', 'well',
  // Common contractions
  "don't", "can't", "won't", "i'm", "i've", "i'll",
  "he's", "she's", "it's", "we're", "they're", "you're",
  "that's", "there's", "isn't", "aren't", "wasn't", "weren't",
  "hasn't", "haven't", "doesn't", "didn't",
  "couldn't", "shouldn't", "wouldn't", "let's",
]);

export function computeWpm(wordCount: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = elapsedMs / 60_000;
  return Math.round(wordCount / minutes);
}

export function computeEnergy(analyserData: Uint8Array<ArrayBuffer>): number {
  let sumSquares = 0;
  for (let i = 0; i < analyserData.length; i++) {
    const normalized = (analyserData[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / analyserData.length);
  return Math.min(1, rms * 3);
}

export function computeFluency(
  pauses: Array<{ start: number; end: number }>,
  totalDurationMs: number
): number {
  if (totalDurationMs <= 0) return 1;
  const totalPauseMs = pauses.reduce((sum, p) => sum + (p.end - p.start), 0);
  return Math.max(0, 1 - totalPauseMs / totalDurationMs);
}

export function computeLexicalDensity(text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const contentWords = words.filter((w) => !FUNCTION_WORDS.has(w.replace(/[^a-z']/g, '')));
  return contentWords.length / words.length;
}

export function interpretPace(wpm: number): string {
  if (wpm < 100) return 'slow, deliberate';
  if (wpm < 140) return 'measured';
  if (wpm < 170) return 'conversational';
  if (wpm < 200) return 'brisk';
  return 'rapid';
}

export function interpretEnergy(energy: number): string {
  if (energy < 0.2) return 'quiet';
  if (energy < 0.4) return 'subdued';
  if (energy < 0.6) return 'moderate';
  if (energy < 0.8) return 'animated';
  return 'intense';
}

export function interpretFluency(fluency: number): string {
  if (fluency < 0.4) return 'highly fragmented';
  if (fluency < 0.6) return 'exploratory with frequent pauses';
  if (fluency < 0.8) return 'mostly fluent';
  return 'highly fluent';
}

export function interpretDensity(density: number): string {
  if (density < 0.3) return 'conversational, light';
  if (density < 0.5) return 'moderate density';
  if (density < 0.7) return 'information-rich';
  return 'very dense, technical';
}
