import type { GenreRegister, Scale, RefinementSettings } from '../types/llm';
import type { ProsodyDiagnostics, VoiceConfig } from '../types/audio';
import {
  interpretPace,
  interpretEnergy,
  interpretFluency,
  interpretDensity,
} from './comprosody';

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

const PACE_IMPLICATIONS: Record<string, string> = {
  'slow, deliberate': 'The speaker chose words carefully — preserve complex syntactic structures and precise vocabulary.',
  'measured': 'Steady, considered delivery — maintain the thoughtful register without over-simplifying.',
  'conversational': 'Natural speaking rhythm — sentence variety should reflect easy, fluid composition.',
  'brisk': 'The speaker was moving quickly through ideas — keep transitions tight and momentum high.',
  'rapid': 'Very fast delivery suggests urgency or well-rehearsed material — do not slow the pace by adding hedges or qualifications.',
};

const ENERGY_IMPLICATIONS: Record<string, string> = {
  'quiet': 'Low vocal energy suggests intimate, reflective, or tentative delivery — avoid amplifying register beyond the speaker\'s intent.',
  'subdued': 'Measured tone — maintain understated quality without injecting false emphasis.',
  'moderate': 'Balanced delivery — match this even-keeled energy in sentence construction.',
  'animated': 'The speaker was engaged and emphatic — rhetorical energy can be preserved in punctuation and syntax.',
  'intense': 'High vocal intensity signals conviction or emotional weight — honor this with strong, direct prose.',
};

const FLUENCY_IMPLICATIONS: Record<string, string> = {
  'highly fragmented': 'The speaker was working through difficult material in real-time — there may be false starts and restatements that represent genuine thought evolution rather than error.',
  'exploratory with frequent pauses': 'The speaker paused often to think — these gaps may mark natural paragraph boundaries or topic transitions.',
  'mostly fluent': 'Generally smooth with occasional hesitation — minor disfluencies can be cleaned without losing voice.',
  'highly fluent': 'Continuous, confident delivery — the transcript likely needs minimal structural intervention.',
};

const DENSITY_IMPLICATIONS: Record<string, string> = {
  'conversational, light': 'Informal register with common vocabulary — do not intellectualize or elevate the diction.',
  'moderate density': 'Mix of everyday and precise language — preserve the balance without flattening either direction.',
  'information-rich': 'The speaker packed significant content per sentence — maintain information density without over-compressing.',
  'very dense, technical': 'Specialized vocabulary is intentional — do not simplify or substitute lay terms.',
};

function buildProsodyContext(prosody: ProsodyDiagnostics): string {
  const paceLabel = interpretPace(prosody.pace);
  const energyLabel = interpretEnergy(prosody.energy);
  const fluencyLabel = interpretFluency(prosody.fluency);
  const densityLabel = interpretDensity(prosody.lexicalDensity);

  return `The speaker's dictation had these prosodic characteristics:
- Pace: ${prosody.pace} WPM (${paceLabel}). ${PACE_IMPLICATIONS[paceLabel]}
- Energy: ${prosody.energy.toFixed(2)} (${energyLabel}). ${ENERGY_IMPLICATIONS[energyLabel]}
- Fluency: ${prosody.fluency.toFixed(2)} (${fluencyLabel}). ${FLUENCY_IMPLICATIONS[fluencyLabel]}
- Lexical density: ${prosody.lexicalDensity.toFixed(2)} (${densityLabel}). ${DENSITY_IMPLICATIONS[densityLabel]}`;
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

function buildTransitionGuidance(prosody: ProsodyDiagnostics, voiceConfig: VoiceConfig): string {
  const lines: string[] = [];

  lines.push('When the dictation shifts topics, smooth the transition with minimal connective tissue — a bridging phrase or sentence — without masking that the speaker moved to a new idea.');

  if (prosody.fluency < 0.6) {
    lines.push('Given the fragmented delivery, incomplete thoughts may appear. Where the speaker clearly abandoned a line of reasoning, elide gracefully rather than fabricating a conclusion. Where they restated an idea more clearly, keep the clearer version.');
  }

  if (!voiceConfig.preserveFalseStarts && prosody.fluency < 0.8) {
    lines.push('Collapse self-corrections into the speaker\'s intended phrasing — keep the final version of restated ideas.');
  }

  lines.push('Where oral pacing leaves gaps between written sentences, add minor phraseological cues (transitional words, referential ties) to bridge the gap and help the composition read as continuous written prose rather than transcribed speech.');

  return 'Oral-to-written transitions:\n' + lines.join('\n');
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
    buildTransitionGuidance(prosody, voiceConfig),
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
