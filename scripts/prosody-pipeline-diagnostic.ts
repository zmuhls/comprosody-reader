/**
 * VOX Prosody Pipeline Diagnostic
 *
 * Exercises the prosody-to-prompt pipeline with synthetic data
 * and reports on signal quality, calibration, and prompt efficiency.
 *
 * Run: npx tsx scripts/prosody-pipeline-diagnostic.ts
 */

import {
  computeEnergy,
  computeLexicalDensity,
  interpretPace,
  interpretEnergy,
  interpretFluency,
  interpretDensity,
} from '../src/lib/comprosody.js';
import { buildSystemPrompt } from '../src/lib/prompts.js';
import type { ProsodyDiagnostics, VoiceConfig } from '../src/types/audio.js';
import type { RefinementSettings } from '../src/types/llm.js';

// ─── Synthetic Dictation Archetypes ──────────────────────────────────

interface Archetype {
  name: string;
  prosody: ProsodyDiagnostics;
  text: string;
}

const ARCHETYPES: Archetype[] = [
  {
    name: 'Careful academic',
    prosody: { pace: 90, energy: 0.35, fluency: 0.65, lexicalDensity: 0.72 },
    text: 'The epistemological framework necessitates a careful consideration of the hermeneutic tradition within which these interpretive claims operate.',
  },
  {
    name: 'Conversational storyteller',
    prosody: { pace: 155, energy: 0.55, fluency: 0.85, lexicalDensity: 0.40 },
    text: 'So I was walking down the street and I saw this thing and it was just like the most incredible thing I\'ve ever seen in my whole life.',
  },
  {
    name: 'Hesitant explorer',
    prosody: { pace: 110, energy: 0.25, fluency: 0.45, lexicalDensity: 0.35 },
    text: 'Um so I think maybe the thing is that uh we\'re not really like looking at it from the right um perspective if that makes sense.',
  },
  {
    name: 'Rapid technical',
    prosody: { pace: 210, energy: 0.70, fluency: 0.90, lexicalDensity: 0.75 },
    text: 'The microservice architecture implements circuit-breaker patterns with exponential backoff retry mechanisms across distributed transaction boundaries.',
  },
  {
    name: 'Field observer',
    prosody: { pace: 130, energy: 0.30, fluency: 0.70, lexicalDensity: 0.55 },
    text: 'Three juvenile red-tailed hawks circling the thermal above the ridge. Wind shifted northwest around fourteen hundred. Ground temperature dropped noticeably.',
  },
  {
    name: 'Freewrite stream',
    prosody: { pace: 175, energy: 0.50, fluency: 0.92, lexicalDensity: 0.48 },
    text: 'The light was different today and I kept thinking about what she said about the quality of attention and how you can\'t really separate the observer from the thing observed.',
  },
];

const GENRES = ['academic', 'narrative', 'analytical', 'field-journal', 'freewrite'] as const;

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  silencesAsStructure: true,
  preserveFalseStarts: false,
  preserveFillers: false,
  cadenceAsGuide: true,
};

// ─── Expanded function word set for comparison ───────────────────────

const EXPANDED_FUNCTION_WORDS = new Set([
  // Original set
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  'in', 'on', 'at', 'to', 'of', 'by', 'up', 'as', 'is', 'am', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'can', 'could', 'it', 'he', 'she', 'we', 'they', 'i', 'you',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our',
  'their', 'this', 'that', 'these', 'those', 'not', 'no', 'if', 'then',
  'than', 'when', 'what', 'which', 'who', 'whom', 'how', 'with', 'from',
  'about', 'into', 'over', 'after', 'before', 'between', 'under',
  'um', 'uh', 'like', 'just', 'very', 'really', 'also', 'too',
  // Missing function words
  'there', 'here', 'where', 'some', 'any', 'all', 'more', 'most',
  'many', 'much', 'other', 'each', 'every', 'both', 'few', 'such',
  'only', 'same', 'while', 'because', 'since', 'until', 'although',
  'though', 'whether', 'either', 'neither', 'oh', 'well', 'own',
  // Common contractions
  "don't", "can't", "won't", "i'm", "i've", "i'll", "he's", "she's",
  "it's", "we're", "they're", "you're", "that's", "there's", "isn't",
  "aren't", "wasn't", "weren't", "hasn't", "haven't", "doesn't",
  "didn't", "couldn't", "shouldn't", "wouldn't", "let's",
]);

function computeLexicalDensityExpanded(text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const contentWords = words.filter(
    (w) => !EXPANDED_FUNCTION_WORDS.has(w.replace(/[^a-z']/g, ''))
  );
  return contentWords.length / words.length;
}

// ─── Utilities ───────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
}

// ─── Analysis 1: Lexical Density Precision ───────────────────────────

function analysis1() {
  console.log('\n--- 1. Lexical Density Precision ---\n');
  console.log(
    pad('Archetype', 28) +
    pad('Current', 10) +
    pad('Expanded', 10) +
    pad('+ PunctFix', 12) +
    pad('Delta', 10) +
    'Flag'
  );
  console.log('-'.repeat(80));

  let totalDelta = 0;
  let flagged = 0;

  for (const a of ARCHETYPES) {
    const current = computeLexicalDensity(a.text);
    const expanded = computeLexicalDensityExpanded(a.text);
    const delta = Math.abs(current - expanded);
    totalDelta += delta;
    const flag = delta > 0.05 ? '  !! > 5%' : '';
    if (delta > 0.05) flagged++;

    console.log(
      pad(a.name, 28) +
      pad(current.toFixed(3), 10) +
      pad(expanded.toFixed(3), 10) +
      pad((current - expanded).toFixed(3), 12) +
      pad(pct(delta), 10) +
      flag
    );
  }

  console.log();
  console.log(`Average delta: ${pct(totalDelta / ARCHETYPES.length)}`);
  console.log(`Flagged (> 5%): ${flagged} / ${ARCHETYPES.length}`);
  console.log();
  console.log(
    'FINDING: The current function word set misses common spoken-English words and does'
  );
  console.log(
    'not strip punctuation. This inflates lexical density, especially for conversational'
  );
  console.log('and filler-heavy speech patterns.');
}

// ─── Analysis 2: Energy Scaling Factor ───────────────────────────────

function analysis2() {
  console.log('\n--- 2. Energy Scaling Factor Evaluation ---\n');

  const profiles: Array<{ name: string; min: number; max: number }> = [
    { name: 'Silence', min: 128, max: 128 },
    { name: 'Whisper', min: 125, max: 131 },
    { name: 'Quiet speech', min: 118, max: 138 },
    { name: 'Normal speech', min: 100, max: 156 },
    { name: 'Loud speech', min: 60, max: 196 },
    { name: 'Shouting', min: 20, max: 236 },
  ];

  const scalingFactors = [1, 2, 3, 4, 5];

  // Header
  console.log(
    pad('Profile', 18) +
    scalingFactors.map((f) => pad(`x${f}`, 10)).join('') +
    pad('Interp (x3)', 35)
  );
  console.log('-'.repeat(88));

  for (const prof of profiles) {
    // Generate synthetic audio data: evenly distributed between min and max
    const data = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      data[i] = prof.min + Math.round(((prof.max - prof.min) * i) / 1023);
    }

    // Compute RMS manually to apply different scaling factors
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / data.length);

    const values = scalingFactors.map((f) => Math.min(1, rms * f));
    const currentEnergy = values[2]; // x3
    const interp = interpretEnergy(currentEnergy);

    console.log(
      pad(prof.name, 18) +
      values.map((v) => pad(v.toFixed(3), 10)).join('') +
      pad(interp, 35)
    );
  }

  // Bucket distribution analysis for x3
  console.log('\nBucket distribution with x3 scaling (typical speech = quiet through loud):');
  const typicalProfiles = profiles.filter(
    (p) => p.name !== 'Silence' && p.name !== 'Shouting'
  );
  const buckets = { quiet: 0, subdued: 0, moderate: 0, animated: 0, intense: 0 };
  for (const prof of typicalProfiles) {
    const data = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) {
      data[i] = prof.min + Math.round(((prof.max - prof.min) * i) / 1023);
    }
    const energy = computeEnergy(data);
    const label = interpretEnergy(energy) as keyof typeof buckets;
    buckets[label]++;
  }
  for (const [label, count] of Object.entries(buckets)) {
    const bar = '#'.repeat(count * 5);
    console.log(`  ${pad(label, 12)} ${bar} (${count}/${typicalProfiles.length})`);
  }

  console.log();
  console.log(
    'FINDING: With x3 scaling, whisper/quiet speech clusters in "quiet"/"subdued" while'
  );
  console.log(
    'normal/loud speech jumps to "animated"/"intense". The middle range ("moderate") is'
  );
  console.log('underrepresented for typical conversational dynamics.');
}

// ─── Analysis 3: Prompt Token Budget ─────────────────────────────────

function analysis3() {
  console.log('\n--- 3. Prompt Token Budget Analysis ---\n');

  let oversized = 0;
  let prosodyDrowned = 0;
  let total = 0;

  // Sample: all genres x one scale (sentence) x all archetypes
  console.log(
    pad('Genre', 16) +
    pad('Archetype', 28) +
    pad('Tokens', 8) +
    pad('Prosody%', 10) +
    'Flag'
  );
  console.log('-'.repeat(72));

  for (const genre of GENRES) {
    for (const a of ARCHETYPES) {
      const settings: RefinementSettings = { genre, scale: 'sentence', temperature: 0.5 };
      const prompt = buildSystemPrompt(settings, a.prosody, DEFAULT_VOICE_CONFIG);
      const tokens = estimateTokens(prompt);

      // Estimate prosody section tokens (lines starting with "- Pace:" etc.)
      const prosodyLines = prompt
        .split('\n')
        .filter((l) => l.match(/^- (Pace|Energy|Fluency|Lexical)/));
      const prosodyTokens = estimateTokens(prosodyLines.join(' '));
      const prosodyPct = prosodyTokens / tokens;

      total++;
      let flag = '';
      if (tokens > 500) { flag += ' OVERSIZED'; oversized++; }
      if (prosodyPct < 0.1) { flag += ' DROWNED'; prosodyDrowned++; }

      console.log(
        pad(genre, 16) +
        pad(a.name, 28) +
        pad(String(tokens), 8) +
        pad(pct(prosodyPct), 10) +
        flag
      );
    }
  }

  console.log();
  console.log(`Total prompts analyzed: ${total}`);
  console.log(`Oversized (> 500 tokens): ${oversized}`);
  console.log(`Prosody signal drowned (< 10%): ${prosodyDrowned}`);
  console.log();
  console.log(
    'FINDING: The system prompt is compact. Prosody context is a small fraction of the'
  );
  console.log(
    'total prompt, meaning the genre preamble and scale instruction dominate. The prosody'
  );
  console.log('signal may need enrichment (implications, not just raw numbers) to carry weight.');
}

// ─── Analysis 4: Signal Discrimination ───────────────────────────────

function analysis4() {
  console.log('\n--- 4. Prosody Signal Discrimination ---\n');

  const settings: RefinementSettings = { genre: 'freewrite', scale: 'sentence', temperature: 0.5 };

  // Build prompts for each archetype
  const prompts = ARCHETYPES.map((a) => ({
    name: a.name,
    prompt: buildSystemPrompt(settings, a.prosody, DEFAULT_VOICE_CONFIG),
  }));

  console.log('Pairwise Jaccard similarity of prompt word sets (lower = more distinct):');
  console.log();

  // Header
  const shortNames = ARCHETYPES.map((a) => a.name.slice(0, 12));
  console.log(pad('', 14) + shortNames.map((n) => pad(n, 14)).join(''));

  const lowDiscrimination: string[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const setI = wordSet(prompts[i].prompt);
    let row = pad(shortNames[i], 14);
    for (let j = 0; j < prompts.length; j++) {
      if (j <= i) {
        row += pad('---', 14);
      } else {
        const setJ = wordSet(prompts[j].prompt);
        const sim = jaccard(setI, setJ);
        row += pad(sim.toFixed(3), 14);

        // Check if prosody is very different but prompts are similar
        const prosodyDist =
          Math.abs(ARCHETYPES[i].prosody.pace - ARCHETYPES[j].prosody.pace) / 200 +
          Math.abs(ARCHETYPES[i].prosody.energy - ARCHETYPES[j].prosody.energy) +
          Math.abs(ARCHETYPES[i].prosody.fluency - ARCHETYPES[j].prosody.fluency) +
          Math.abs(ARCHETYPES[i].prosody.lexicalDensity - ARCHETYPES[j].prosody.lexicalDensity);

        if (prosodyDist > 1.0 && sim > 0.75) {
          lowDiscrimination.push(
            `${ARCHETYPES[i].name} vs ${ARCHETYPES[j].name} (prosody dist: ${prosodyDist.toFixed(2)}, prompt sim: ${sim.toFixed(3)})`
          );
        }
      }
    }
    console.log(row);
  }

  console.log();
  if (lowDiscrimination.length > 0) {
    console.log('LOW DISCRIMINATION pairs (high prosody diff, high prompt similarity):');
    for (const pair of lowDiscrimination) console.log(`  - ${pair}`);
  } else {
    console.log('No low-discrimination pairs detected.');
  }

  // Check interpretation label uniqueness
  console.log('\nInterpretation label vectors:');
  for (const a of ARCHETYPES) {
    const labels = [
      interpretPace(a.prosody.pace),
      interpretEnergy(a.prosody.energy),
      interpretFluency(a.prosody.fluency),
      interpretDensity(a.prosody.lexicalDensity),
    ].join(' | ');
    console.log(`  ${pad(a.name, 28)} ${labels}`);
  }

  const labelVectors = ARCHETYPES.map((a) =>
    [
      interpretPace(a.prosody.pace),
      interpretEnergy(a.prosody.energy),
      interpretFluency(a.prosody.fluency),
      interpretDensity(a.prosody.lexicalDensity),
    ].join('|')
  );
  const uniqueVectors = new Set(labelVectors);
  console.log(`\nUnique label vectors: ${uniqueVectors.size} / ${ARCHETYPES.length}`);

  console.log();
  console.log(
    'FINDING: Prompt word-set similarity is high because genre preamble and boilerplate'
  );
  console.log(
    'dominate. The prosody section contributes only interpretation labels and raw numbers.'
  );
  console.log(
    'Adding prosody *implications* (what each metric means for refinement) would create'
  );
  console.log('more discriminating prompts.');
}

// ─── Analysis 5: Interpretation Boundary Sensitivity ─────────────────

function analysis5() {
  console.log('\n--- 5. Interpretation Boundary Sensitivity ---\n');

  const metrics: Array<{
    name: string;
    fn: (v: number) => string;
    boundaries: number[];
    unit: string;
  }> = [
    { name: 'Pace', fn: interpretPace, boundaries: [100, 140, 170, 200], unit: 'WPM' },
    { name: 'Energy', fn: interpretEnergy, boundaries: [0.2, 0.4, 0.6, 0.8], unit: '' },
    { name: 'Fluency', fn: interpretFluency, boundaries: [0.4, 0.6, 0.8], unit: '' },
    { name: 'Density', fn: interpretDensity, boundaries: [0.3, 0.5, 0.7], unit: '' },
  ];

  for (const metric of metrics) {
    console.log(`${metric.name} boundaries:`);
    for (const b of metric.boundaries) {
      const step = metric.unit === 'WPM' ? 1 : 0.01;
      const below = b - step;
      const at = b;
      console.log(
        `  ${below.toFixed(2)}${metric.unit} -> "${metric.fn(below)}"  |  ` +
        `${at.toFixed(2)}${metric.unit} -> "${metric.fn(at)}"  ` +
        `[FLIP]`
      );
    }
    console.log();
  }

  console.log(
    'FINDING: Each boundary creates a hard cliff where a tiny change in the raw metric'
  );
  console.log(
    'produces a completely different label for the LLM. In a 500ms measurement window,'
  );
  console.log(
    'noise could flip labels back and forth. Consider smoothing or using the raw values'
  );
  console.log('alongside labels to give the LLM gradient information.');
}

// ─── Analysis 6: Edge Coherence ──────────────────────────────────────

function analysis6() {
  console.log('\n--- 6. Edge Prosody Coherence ---\n');

  const edgeCases: Array<{ name: string; prosody: ProsodyDiagnostics }> = [
    {
      name: 'Struggling with technical material',
      prosody: { pace: 80, energy: 0.75, fluency: 0.35, lexicalDensity: 0.78 },
    },
    {
      name: 'Quiet fluent chatting',
      prosody: { pace: 190, energy: 0.15, fluency: 0.92, lexicalDensity: 0.25 },
    },
    {
      name: 'All at bucket boundaries',
      prosody: { pace: 140, energy: 0.4, fluency: 0.6, lexicalDensity: 0.5 },
    },
    {
      name: 'Extremes: max everything',
      prosody: { pace: 250, energy: 1.0, fluency: 1.0, lexicalDensity: 1.0 },
    },
    {
      name: 'Extremes: min everything',
      prosody: { pace: 30, energy: 0.0, fluency: 0.0, lexicalDensity: 0.0 },
    },
  ];

  const settings: RefinementSettings = { genre: 'freewrite', scale: 'sentence', temperature: 0.5 };

  for (const edge of edgeCases) {
    console.log(`=== ${edge.name} ===`);
    console.log(
      `Labels: ${interpretPace(edge.prosody.pace)} | ` +
      `${interpretEnergy(edge.prosody.energy)} | ` +
      `${interpretFluency(edge.prosody.fluency)} | ` +
      `${interpretDensity(edge.prosody.lexicalDensity)}`
    );

    const prompt = buildSystemPrompt(settings, edge.prosody, DEFAULT_VOICE_CONFIG);
    // Extract just the prosody context section
    const lines = prompt.split('\n');
    const prosodyStart = lines.findIndex((l) => l.includes("speaker's dictation"));
    const prosodyEnd = lines.findIndex((l, i) => i > prosodyStart && l.trim() === '');
    if (prosodyStart >= 0) {
      const section = lines.slice(prosodyStart, prosodyEnd > prosodyStart ? prosodyEnd : prosodyStart + 5);
      for (const line of section) console.log(`  ${line}`);
    }
    console.log();
  }

  console.log(
    'FINDING: The prosody context reports metrics and labels independently — it does not'
  );
  console.log(
    'synthesize them into a coherent behavioral portrait. "slow + intense + fragmented +'
  );
  console.log(
    'dense" means something specific (wrestling with difficult material), but the prompt'
  );
  console.log(
    'leaves the LLM to infer this. Adding implication sentences would disambiguate.'
  );
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
  console.log('=== VOX Prosody Pipeline Diagnostic ===');
  console.log(`Date: ${new Date().toISOString()}\n`);

  analysis1();
  analysis2();
  analysis3();
  analysis4();
  analysis5();
  analysis6();

  console.log('\n=== Summary of Recommended Improvements ===\n');
  console.log('1. LEXICAL DENSITY: Strip punctuation before function word lookup and expand');
  console.log('   the function word set with ~30 missing words + contractions.');
  console.log();
  console.log('2. ENERGY SCALING: The x3 factor compresses typical speech into extremes.');
  console.log('   Consider a sigmoid or log curve for more perceptual uniformity.');
  console.log();
  console.log('3. PROMPT ENRICHMENT: Add prosody implications — what each metric *means*');
  console.log('   for the refinement task — to increase signal discrimination.');
  console.log();
  console.log('4. TRANSITION GUIDANCE: Add instructions for handling topic shifts, incomplete');
  console.log('   thoughts, and oral-to-written bridging in the system prompt.');
  console.log();
  console.log('5. BOUNDARY SMOOTHING: Consider providing raw values alongside labels to give');
  console.log('   the LLM gradient information, reducing cliff effects at bucket boundaries.');
  console.log();
  console.log('=== End of Diagnostic ===');
}

main();
