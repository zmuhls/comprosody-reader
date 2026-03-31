import {
  computeWpm,
  computeEnergy,
  computeFluency,
  computeLexicalDensity,
  interpretPace,
  interpretEnergy,
  interpretFluency,
  interpretDensity,
} from './comprosody';

function makeAudioData(value: number, length = 1024): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(length);
  data.fill(value);
  return data;
}

// --- computeWpm ---

describe('computeWpm', () => {
  it('returns 0 when elapsed is 0', () => {
    expect(computeWpm(100, 0)).toBe(0);
  });

  it('returns 0 when elapsed is negative', () => {
    expect(computeWpm(100, -1000)).toBe(0);
  });

  it('computes 150 WPM for 150 words in 60s', () => {
    expect(computeWpm(150, 60_000)).toBe(150);
  });

  it('computes 100 WPM for 50 words in 30s', () => {
    expect(computeWpm(50, 30_000)).toBe(100);
  });

  it('returns 0 for zero words', () => {
    expect(computeWpm(0, 60_000)).toBe(0);
  });

  it('handles very short durations', () => {
    // 1 word in 500ms = 1 / (0.5/60) = 120 WPM
    expect(computeWpm(1, 500)).toBe(120);
  });
});

// --- computeEnergy ---

describe('computeEnergy', () => {
  it('returns 0 for silence (all 128)', () => {
    expect(computeEnergy(makeAudioData(128))).toBe(0);
  });

  it('clamps to 1 for full positive amplitude (all 255)', () => {
    // (255-128)/128 ≈ 0.992, RMS ≈ 0.992, *3 ≈ 2.977, clamped to 1
    expect(computeEnergy(makeAudioData(255))).toBe(1);
  });

  it('clamps to 1 for full negative amplitude (all 0)', () => {
    // (0-128)/128 = -1.0, squared = 1.0, RMS = 1.0, *3 = 3.0, clamped to 1
    expect(computeEnergy(makeAudioData(0))).toBe(1);
  });

  it('returns ~0.75 for moderate signal (all 160)', () => {
    // (160-128)/128 = 0.25, squared = 0.0625, RMS = 0.25, *3 = 0.75
    const energy = computeEnergy(makeAudioData(160));
    expect(energy).toBeCloseTo(0.75, 2);
  });

  it('computes RMS correctly for mixed signal', () => {
    // Alternating 100 and 156: deviations -0.21875 and +0.21875
    // Both squared = 0.04785, mean = 0.04785, sqrt = 0.21875, *3 = 0.65625
    const data = new Uint8Array(1024);
    for (let i = 0; i < 1024; i++) data[i] = i % 2 === 0 ? 100 : 156;
    const energy = computeEnergy(data);
    expect(energy).toBeCloseTo(0.656, 2);
  });

  it('handles single-element array', () => {
    const energy = computeEnergy(new Uint8Array([200]));
    // (200-128)/128 = 0.5625, squared = 0.3164, sqrt = 0.5625, *3 = 1.6875, clamped to 1
    expect(energy).toBe(1);
  });

  it('returns small value for quiet speech (~135)', () => {
    // (135-128)/128 ≈ 0.0547, squared ≈ 0.00299, RMS ≈ 0.0547, *3 ≈ 0.164
    const energy = computeEnergy(makeAudioData(135));
    expect(energy).toBeCloseTo(0.164, 2);
  });
});

// --- computeFluency ---

describe('computeFluency', () => {
  it('returns 1 with no pauses', () => {
    expect(computeFluency([], 60_000)).toBe(1);
  });

  it('returns 1 when total duration is 0', () => {
    expect(computeFluency([], 0)).toBe(1);
  });

  it('returns 0.5 when half the time is paused', () => {
    expect(computeFluency([{ start: 0, end: 30_000 }], 60_000)).toBe(0.5);
  });

  it('returns 0 when fully paused', () => {
    expect(computeFluency([{ start: 0, end: 60_000 }], 60_000)).toBe(0);
  });

  it('handles multiple pauses', () => {
    const pauses = [
      { start: 0, end: 10_000 },
      { start: 20_000, end: 30_000 },
    ];
    // 20s paused / 60s total = 0.333 pause ratio -> fluency = 0.667
    expect(computeFluency(pauses, 60_000)).toBeCloseTo(0.667, 2);
  });
});

// --- computeLexicalDensity ---

describe('computeLexicalDensity', () => {
  it('returns 0 for empty string', () => {
    expect(computeLexicalDensity('')).toBe(0);
  });

  it('returns 0 for all function words', () => {
    expect(computeLexicalDensity('the a an is are was there some well')).toBe(0);
  });

  it('returns 1 for all content words', () => {
    expect(computeLexicalDensity('quantum mechanics governs')).toBe(1);
  });

  it('computes mixed sentence correctly', () => {
    // "the cat sat on the mat" -> function: the, on, the (3), content: cat, sat, mat (3)
    // density = 3/6 = 0.5
    expect(computeLexicalDensity('the cat sat on the mat')).toBe(0.5);
  });

  it('identifies filler-heavy speech', () => {
    // "um like I just really uh think" -> function: um, like, i, just, really, uh (6), content: think (1)
    // density = 1/7 ≈ 0.143
    expect(computeLexicalDensity('um like I just really uh think')).toBeCloseTo(0.143, 2);
  });

  it('is case insensitive', () => {
    // "The THE tHe" -> all resolve to "the", all function words
    expect(computeLexicalDensity('The THE tHe')).toBe(0);
  });

  it('handles excess whitespace', () => {
    expect(computeLexicalDensity('  word  ')).toBe(1);
  });

  it('strips punctuation before function word lookup', () => {
    // "the, cat." -> words: ["the,", "cat."]
    // After punctuation stripping: "the" (function) and "cat" (content)
    // density = 1/2 = 0.5
    expect(computeLexicalDensity('the, cat.')).toBe(0.5);
  });

  it('recognizes expanded function words', () => {
    // "there some each" are all in the expanded function word set
    expect(computeLexicalDensity('there some each')).toBe(0);
  });

  it('recognizes contractions as function words', () => {
    // "don't can't won't" are all contractions in the set
    expect(computeLexicalDensity("don't can't won't")).toBe(0);
  });
});

// --- interpretPace ---

describe('interpretPace', () => {
  it('returns "slow, deliberate" below 100', () => {
    expect(interpretPace(0)).toBe('slow, deliberate');
    expect(interpretPace(99)).toBe('slow, deliberate');
  });

  it('returns "measured" for 100-139', () => {
    expect(interpretPace(100)).toBe('measured');
    expect(interpretPace(139)).toBe('measured');
  });

  it('returns "conversational" for 140-169', () => {
    expect(interpretPace(140)).toBe('conversational');
    expect(interpretPace(169)).toBe('conversational');
  });

  it('returns "brisk" for 170-199', () => {
    expect(interpretPace(170)).toBe('brisk');
    expect(interpretPace(199)).toBe('brisk');
  });

  it('returns "rapid" at 200+', () => {
    expect(interpretPace(200)).toBe('rapid');
    expect(interpretPace(300)).toBe('rapid');
  });
});

// --- interpretEnergy ---

describe('interpretEnergy', () => {
  it('returns "quiet" below 0.2', () => {
    expect(interpretEnergy(0)).toBe('quiet');
    expect(interpretEnergy(0.19)).toBe('quiet');
  });

  it('returns "subdued" for 0.2-0.39', () => {
    expect(interpretEnergy(0.2)).toBe('subdued');
    expect(interpretEnergy(0.39)).toBe('subdued');
  });

  it('returns "moderate" for 0.4-0.59', () => {
    expect(interpretEnergy(0.4)).toBe('moderate');
    expect(interpretEnergy(0.59)).toBe('moderate');
  });

  it('returns "animated" for 0.6-0.79', () => {
    expect(interpretEnergy(0.6)).toBe('animated');
    expect(interpretEnergy(0.79)).toBe('animated');
  });

  it('returns "intense" at 0.8+', () => {
    expect(interpretEnergy(0.8)).toBe('intense');
    expect(interpretEnergy(1.0)).toBe('intense');
  });
});

// --- interpretFluency ---

describe('interpretFluency', () => {
  it('returns "highly fragmented" below 0.4', () => {
    expect(interpretFluency(0)).toBe('highly fragmented');
    expect(interpretFluency(0.39)).toBe('highly fragmented');
  });

  it('returns "exploratory with frequent pauses" for 0.4-0.59', () => {
    expect(interpretFluency(0.4)).toBe('exploratory with frequent pauses');
    expect(interpretFluency(0.59)).toBe('exploratory with frequent pauses');
  });

  it('returns "mostly fluent" for 0.6-0.79', () => {
    expect(interpretFluency(0.6)).toBe('mostly fluent');
    expect(interpretFluency(0.79)).toBe('mostly fluent');
  });

  it('returns "highly fluent" at 0.8+', () => {
    expect(interpretFluency(0.8)).toBe('highly fluent');
    expect(interpretFluency(1.0)).toBe('highly fluent');
  });
});

// --- interpretDensity ---

describe('interpretDensity', () => {
  it('returns "conversational, light" below 0.3', () => {
    expect(interpretDensity(0)).toBe('conversational, light');
    expect(interpretDensity(0.29)).toBe('conversational, light');
  });

  it('returns "moderate density" for 0.3-0.49', () => {
    expect(interpretDensity(0.3)).toBe('moderate density');
    expect(interpretDensity(0.49)).toBe('moderate density');
  });

  it('returns "information-rich" for 0.5-0.69', () => {
    expect(interpretDensity(0.5)).toBe('information-rich');
    expect(interpretDensity(0.69)).toBe('information-rich');
  });

  it('returns "very dense, technical" at 0.7+', () => {
    expect(interpretDensity(0.7)).toBe('very dense, technical');
    expect(interpretDensity(1.0)).toBe('very dense, technical');
  });
});
