import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INGESTION_CYCLES,
  validateIngestionCapability,
} from '../public/ingestion-capabilities.js';

const validCapability = {
  schemaVersion: 1,
  available: true,
  provider: 'ollama-cloud',
  model: 'glm-5.2',
  cycles: ['structure', 'encoding_ocr', 'fidelity_review'],
  extraction: 'browser',
  pdfUploaded: false,
  maxSourceCharacters: 2_000_000,
};

test('validates and freezes the versioned ingestion capability contract', () => {
  const capability = validateIngestionCapability(validCapability);
  assert.deepEqual(capability, validCapability);
  assert.deepEqual(capability.cycles, INGESTION_CYCLES);
  assert.equal(Object.isFrozen(capability), true);
  assert.equal(Object.isFrozen(capability.cycles), true);
});

test('rejects drifted, permissive, and unsafe ingestion capability contracts', () => {
  const invalid = [
    { ...validCapability, schemaVersion: 2 },
    { ...validCapability, available: 'yes' },
    { ...validCapability, provider: 'other' },
    { ...validCapability, model: 'other' },
    { ...validCapability, cycles: [...validCapability.cycles].reverse() },
    { ...validCapability, extraction: 'server' },
    { ...validCapability, pdfUploaded: true },
    { ...validCapability, maxSourceCharacters: 0 },
    { ...validCapability, maxSourceCharacters: 10_000_001 },
    { ...validCapability, extra: true },
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateIngestionCapability(value),
      /ingestion readiness could not be verified\./u,
    );
  }
});
