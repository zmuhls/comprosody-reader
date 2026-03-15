import type { GenreRegister, Scale, RefinementSettings } from '../types/llm';
import type { ProsodyDiagnostics, VoiceConfig } from '../types/audio';
import {
  interpretPace,
  interpretEnergy,
  interpretFluency,
  interpretDensity,
} from './prosody';

const GENRE_PREAMBLES: Record<GenreRegister, string> = {
  'academic':
    'You are an editor for scholarly writing. Preserve precision, disciplinary vocabulary, and argumentative rigor. Favor clarity over jargon while maintaining the register expected in academic publications. Attend to claims, evidence, and citational conventions appropriate to the writer\'s field.',

  'narrative':
    'You are an editor for narrative prose. Preserve voice, pacing, and storytelling arc. Honor sensory detail, character, and scene. Attend to the writer\'s point of view and tonal register — whether personal essay, memoir, creative nonfiction, or reportage. Maintain the emotional and temporal throughline.',

  'analytical':
    'You are an editor for analytical writing. Attend to argument structure, logical progression, and evidentiary support. Preserve the writer\'s critical perspective and interpretive framework. Favor precise terminology and clear reasoning over stylistic flourish.',

  'field-journal':
    'You are an editor for field journal entries. Preserve the observational immediacy, temporal markers, and environmental detail. Light touch — smooth rough edges and clarify ambiguity without domesticating the field voice. Maintain chronological integrity and sensory grounding.',

  'freewrite':
    'You are a light-touch editor for freewriting. Preserve the exploratory, associative quality of the prose. Only smooth rough edges — fix obvious errors, untangle confusing syntax. Do not impose structure or academic register. The improvisational flow is the point.',
};

const SCALE_INSTRUCTIONS: Record<Scale, string> = {
  word: 'Fix individual word choices only — improve precision, register fit, or clarity. Do not restructure phrases, clauses, or sentences.',
  phrase: 'Adjust phrases for clarity and register. You may replace or rework phrases, but do not change sentence structure or merge/split sentences.',
  clause: 'Restructure clauses within sentences for clarity and flow. You may reorder or rework clauses, but do not merge or split sentences.',
  sentence: 'Rewrite full sentences for clarity, flow, and register. You may merge or split sentences as needed, but do not reorganize at the paragraph level.',
  paragraph: 'Reorganize at the paragraph level. You may reorder, merge, or split paragraphs and sentences to improve structure and coherence.',
};

function buildProsodyContext(prosody: ProsodyDiagnostics): string {
  return `The speaker's dictation had these prosodic characteristics:
- Pace: ${prosody.pace} WPM (${interpretPace(prosody.pace)})
- Energy: ${prosody.energy.toFixed(2)} (${interpretEnergy(prosody.energy)})
- Fluency: ${prosody.fluency.toFixed(2)} (${interpretFluency(prosody.fluency)})
- Lexical density: ${prosody.lexicalDensity.toFixed(2)} (${interpretDensity(prosody.lexicalDensity)})`;
}

function buildVoiceConfigContext(config: VoiceConfig): string {
  const lines: string[] = [];
  if (config.silencesAsStructure)
    lines.push('Long pauses in the transcript mark intentional structural breaks; preserve them as paragraph boundaries.');
  if (config.preserveFalseStarts)
    lines.push('Retain false starts as rhetorical texture — they reveal the speaker\'s thinking process.');
  if (config.preserveFillers)
    lines.push('Preserve filler words (um, uh, like) where they add conversational register or mark hesitation meaningfully.');
  if (config.cadenceAsGuide)
    lines.push('Mirror the speaker\'s natural rhythm in sentence length variation — short bursts should stay short, long flowing passages should maintain their pace.');
  return lines.length > 0
    ? 'Voice configuration:\n' + lines.join('\n')
    : '';
}

export function buildSystemPrompt(
  settings: RefinementSettings,
  prosody: ProsodyDiagnostics,
  voiceConfig: VoiceConfig
): string {
  const parts = [
    GENRE_PREAMBLES[settings.genre],
    '',
    buildProsodyContext(prosody),
    '',
    buildVoiceConfigContext(voiceConfig),
    '',
    `Refine at the ${settings.scale} level. ${SCALE_INSTRUCTIONS[settings.scale]}`,
    '',
    'This is refinement, not rewriting. Preserve the speaker\'s voice, intent, and argumentative direction. Return only the refined text with no commentary or explanation.',
  ];
  return parts.filter(Boolean).join('\n');
}

export function buildSelectionPrompt(
  settings: RefinementSettings,
  prosody: ProsodyDiagnostics,
  voiceConfig: VoiceConfig,
  contextBefore: string,
  selection: string,
  contextAfter: string
): { system: string; user: string } {
  const system = buildSystemPrompt(settings, prosody, voiceConfig);
  const user = `Here is a fragment of dictated text to refine. The selected portion is between [START] and [END] markers. Refine ONLY the selected text, maintaining coherence with the surrounding context. Return ONLY the refined selected text, nothing else.

Context before: ${contextBefore}

[START]${selection}[END]

Context after: ${contextAfter}`;
  return { system, user };
}
