import { buildSystemPrompt, buildSelectionPrompt } from './prompts';
import type { RefinementSettings } from '../types/llm';
import type { ProsodyDiagnostics, VoiceConfig } from '../types/audio';
import { defaultProsody, defaultVoiceConfig } from '../types/audio';

const defaultSettings: RefinementSettings = {
  genre: 'freewrite',
  scale: 'sentence',
  temperature: 0.5,
};

const highDensityProsody: ProsodyDiagnostics = {
  pace: 90,
  energy: 0.35,
  fluency: 0.65,
  lexicalDensity: 0.8,
};

const allVoiceConfig: VoiceConfig = {
  silencesAsStructure: true,
  preserveFalseStarts: true,
  preserveFillers: true,
  cadenceAsGuide: true,
};

const noVoiceConfig: VoiceConfig = {
  silencesAsStructure: false,
  preserveFalseStarts: false,
  preserveFillers: false,
  cadenceAsGuide: false,
};

// --- buildSystemPrompt ---

describe('buildSystemPrompt', () => {
  it('includes freewrite preamble for default settings', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, defaultVoiceConfig);
    expect(prompt).toContain('light-touch editor for freewriting');
  });

  it('includes prosody metrics with interpretations and implications', () => {
    const prompt = buildSystemPrompt(defaultSettings, highDensityProsody, defaultVoiceConfig);
    // Raw metrics and labels
    expect(prompt).toContain('90 WPM');
    expect(prompt).toContain('slow, deliberate');
    expect(prompt).toContain('0.35');
    expect(prompt).toContain('subdued');
    expect(prompt).toContain('0.65');
    expect(prompt).toContain('mostly fluent');
    expect(prompt).toContain('0.80');
    expect(prompt).toContain('very dense, technical');
    // Implications
    expect(prompt).toContain('chose words carefully');
    expect(prompt).toContain('do not simplify');
  });

  it('includes voice config lines when flags are set', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, allVoiceConfig);
    expect(prompt).toContain('intentional structural breaks');
    expect(prompt).toContain('false starts as rhetorical texture');
    expect(prompt).toContain('Preserve filler words');
    expect(prompt).toContain('natural rhythm in sentence length');
  });

  it('omits voice config section when no flags set', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, noVoiceConfig);
    expect(prompt).not.toContain('Voice configuration:');
  });

  it('includes scale instruction', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, defaultVoiceConfig);
    expect(prompt).toContain('Rewrite full sentences');
    expect(prompt).toContain('sentence level');
  });

  it('includes transition/bridging guidance', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, defaultVoiceConfig);
    expect(prompt).toContain('Oral-to-written transitions');
    expect(prompt).toContain('bridging phrase');
  });

  it('adds fragmented-delivery guidance for low fluency', () => {
    const lowFluency = { ...defaultProsody, fluency: 0.4 };
    const prompt = buildSystemPrompt(defaultSettings, lowFluency, defaultVoiceConfig);
    expect(prompt).toContain('incomplete thoughts');
    expect(prompt).toContain('elide gracefully');
  });

  it('adds self-correction collapse for moderate fluency without preserveFalseStarts', () => {
    const moderateFluency = { ...defaultProsody, fluency: 0.7 };
    const prompt = buildSystemPrompt(defaultSettings, moderateFluency, defaultVoiceConfig);
    expect(prompt).toContain('Collapse self-corrections');
  });

  it('ends with refinement directive', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, defaultVoiceConfig);
    expect(prompt).toContain('refinement, not rewriting');
    expect(prompt).toContain('Return only the refined text');
  });
});

// --- Genre coverage ---

describe('genre coverage', () => {
  const genreExpectations: Record<string, string> = {
    academic: 'scholarly writing',
    narrative: 'narrative prose',
    analytical: 'analytical writing',
    'field-journal': 'field journal entries',
    freewrite: 'light-touch editor for freewriting',
  };

  for (const [genre, substring] of Object.entries(genreExpectations)) {
    it(`includes ${genre} preamble`, () => {
      const settings: RefinementSettings = { ...defaultSettings, genre: genre as RefinementSettings['genre'] };
      const prompt = buildSystemPrompt(settings, defaultProsody, defaultVoiceConfig);
      expect(prompt).toContain(substring);
    });
  }
});

// --- Scale coverage ---

describe('scale coverage', () => {
  const scaleExpectations: Record<string, string> = {
    word: 'individual word choices only',
    phrase: 'Adjust phrases',
    clause: 'Restructure clauses',
    sentence: 'Rewrite full sentences',
    paragraph: 'Reorganize at the paragraph level',
  };

  for (const [scale, substring] of Object.entries(scaleExpectations)) {
    it(`includes ${scale} instruction`, () => {
      const settings: RefinementSettings = { ...defaultSettings, scale: scale as RefinementSettings['scale'] };
      const prompt = buildSystemPrompt(settings, defaultProsody, defaultVoiceConfig);
      expect(prompt).toContain(substring);
    });
  }
});

// --- Voice config permutations ---

describe('voice config permutations', () => {
  it('includes only silencesAsStructure when only that flag is set', () => {
    const config: VoiceConfig = { ...noVoiceConfig, silencesAsStructure: true };
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, config);
    expect(prompt).toContain('intentional structural breaks');
    expect(prompt).not.toContain('false starts');
    expect(prompt).not.toContain('filler words');
    expect(prompt).not.toContain('natural rhythm');
  });

  it('includes only preserveFillers when only that flag is set', () => {
    const config: VoiceConfig = { ...noVoiceConfig, preserveFillers: true };
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, config);
    expect(prompt).toContain('Preserve filler words');
    expect(prompt).not.toContain('structural breaks');
  });

  it('includes all four lines when all flags set', () => {
    const prompt = buildSystemPrompt(defaultSettings, defaultProsody, allVoiceConfig);
    expect(prompt).toContain('structural breaks');
    expect(prompt).toContain('false starts');
    expect(prompt).toContain('filler words');
    expect(prompt).toContain('natural rhythm');
  });
});

// --- buildSelectionPrompt ---

describe('buildSelectionPrompt', () => {
  it('wraps selection with [START] and [END] markers', () => {
    const { user } = buildSelectionPrompt(
      defaultSettings, defaultProsody, defaultVoiceConfig,
      'Before text.', 'selected portion', 'After text.'
    );
    expect(user).toContain('[START]selected portion[END]');
  });

  it('includes context before and after', () => {
    const { user } = buildSelectionPrompt(
      defaultSettings, defaultProsody, defaultVoiceConfig,
      'The context before.', 'selection', 'The context after.'
    );
    expect(user).toContain('Context before: The context before.');
    expect(user).toContain('Context after: The context after.');
  });

  it('system prompt matches buildSystemPrompt output', () => {
    const { system } = buildSelectionPrompt(
      defaultSettings, highDensityProsody, allVoiceConfig,
      'before', 'sel', 'after'
    );
    const expected = buildSystemPrompt(defaultSettings, highDensityProsody, allVoiceConfig);
    expect(system).toBe(expected);
  });

  it('handles empty context', () => {
    const { user } = buildSelectionPrompt(
      defaultSettings, defaultProsody, defaultVoiceConfig,
      '', 'selected text', ''
    );
    expect(user).toContain('[START]selected text[END]');
    expect(user).toContain('Context before: ');
    expect(user).toContain('Context after: ');
  });
});
