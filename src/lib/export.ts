import type { Entry } from '../types/editor';
import { countWords } from './entries';
import { formatDuration, formatUpdatedAt } from './time';

export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

export function entryToMarkdown(entry: Entry): string {
  const meta = [
    `created ${formatUpdatedAt(entry.createdAt)}`,
    `${countWords(entry.rawTranscript)} words`,
  ];
  if ((entry.recordedDurationMs ?? 0) > 0) {
    meta.push(`recorded ${formatDuration(entry.recordedDurationMs ?? 0)}`);
  }

  const sections = [`# ${entry.name}`, `*${meta.join(' · ')}*`];
  if (entry.refinedText.trim()) {
    sections.push('## draft', entry.refinedText.trim());
  }
  if (entry.rawTranscript.trim()) {
    sections.push('## transcript', entry.rawTranscript.trim());
  }
  return `${sections.join('\n\n')}\n`;
}

export function entryToPlainText(entry: Entry): string {
  const body = entry.refinedText.trim() || entry.rawTranscript.trim();
  return body ? `${entry.name}\n\n${body}\n` : `${entry.name}\n`;
}

export function downloadEntry(entry: Entry): void {
  const blob = new Blob([entryToMarkdown(entry)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugifyName(entry.name)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyEntryToClipboard(entry: Entry): Promise<void> {
  await navigator.clipboard.writeText(entryToPlainText(entry));
}
