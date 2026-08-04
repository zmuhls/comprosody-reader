import type { Entry } from '../types/editor';
import { refineComplete } from './refinementApi';

const UNTITLED_NAMES = new Set(['untitled', 'untitled note', 'new note']);
const MAX_AGENT_SOURCE_CHARACTERS = 4_000;
const MAX_TITLE_CHARACTERS = 72;
const MAX_TITLE_WORDS = 8;

function compactSource(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[`*_~]/gu, '')
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s*/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function limitByWords(value: string): string {
  const words = value.split(/\s+/u).filter(Boolean);
  let title = words.slice(0, MAX_TITLE_WORDS).join(' ');
  if (title.length <= MAX_TITLE_CHARACTERS) return title;
  title = title.slice(0, MAX_TITLE_CHARACTERS + 1);
  return title.slice(0, Math.max(1, title.lastIndexOf(' '))).trim();
}

export function normalizeAutomaticNoteTitle(value: string): string {
  const firstLine = String(value || '').split(/\r?\n/u)[0] ?? '';
  const normalized = firstLine
    .replace(/^\s*(?:title\s*:\s*|#{1,6}\s*)/iu, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
    .replace(/[.!?:;,—–-]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return limitByWords(normalized);
}

export function fallbackNoteTitle(source: string): string {
  const compact = compactSource(source);
  if (!compact) return 'Untitled';
  const firstThought = compact.split(/(?<=[.!?])\s+/u)[0] ?? compact;
  return normalizeAutomaticNoteTitle(firstThought) || 'Untitled';
}

export function noteTitleSource(entry: Entry): string {
  return (entry.refinedText || entry.rawTranscript || '').trim();
}

export function noteTitleBasis(source: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${source.length}:${(hash >>> 0).toString(36)}`;
}

export function hasManualNoteTitle(entry: Entry): boolean {
  if (entry.titleSource === 'manual') return true;
  return !entry.titleSource && !UNTITLED_NAMES.has(entry.name.trim().toLowerCase());
}

export function automaticTitleCandidate(entry: Entry): {
  basis: string;
  source: string;
} | null {
  if (entry.kind !== 'note') return null;
  const source = noteTitleSource(entry);
  if (source.length < 16 || hasManualNoteTitle(entry)) return null;
  const basis = noteTitleBasis(source);
  if (entry.titleSource === 'agent' && entry.titleBasis === basis) return null;
  return { basis, source };
}

export async function generateAutomaticNoteTitle(
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await refineComplete({
    systemPrompt: [
      'Give private writing notes concise, specific titles.',
      'Return only a title of three to seven words.',
      'Preserve important names and concepts from the note.',
      'Do not use quotation marks, markdown, a label, or ending punctuation.',
    ].join(' '),
    userMessage: compactSource(source).slice(0, MAX_AGENT_SOURCE_CHARACTERS),
    temperature: 0.15,
    signal,
  });
  const title = normalizeAutomaticNoteTitle(response);
  if (!title) throw new Error('Comprosody returned an empty note title.');
  return title;
}
