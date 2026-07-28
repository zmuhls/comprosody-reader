import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../constants';
import { loadRefinementSettings } from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('loadRefinementSettings', () => {
  it('loads only supported refinement settings', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      genre: 'academic',
      scale: 'paragraph',
      temperature: 0.35,
      mode: 'overhaul',
      highFidelity: false,
      autoRefine: false,
      unexpected: 'discard me',
    }));

    expect(loadRefinementSettings()).toEqual({
      genre: 'academic',
      scale: 'paragraph',
      temperature: 0.35,
      mode: 'overhaul',
      highFidelity: false,
      autoRefine: false,
    });
  });

  it('drops invalid values so application defaults remain authoritative', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      genre: 'legal-brief',
      scale: 'book',
      temperature: 1.5,
      mode: 'rewrite-everything',
      highFidelity: 'yes',
      autoRefine: 'always',
    }));

    expect(loadRefinementSettings()).toEqual({});
  });

  it('migrates the legacy boolean fidelity field without trusting other legacy values', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({
      fidelity: true,
      temperature: '0.2',
      autoRefine: null,
    }));

    expect(loadRefinementSettings()).toEqual({
      highFidelity: true,
    });
  });

  it.each(['null', '[]', '"academic"', '{not-json'])(
    'returns an empty settings object for invalid storage payload %s',
    (payload) => {
      localStorage.setItem(STORAGE_KEYS.settings, payload);
      expect(loadRefinementSettings()).toEqual({});
    },
  );
});
