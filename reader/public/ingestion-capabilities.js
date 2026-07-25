const CAPABILITY_KEYS = new Set([
  'schemaVersion',
  'available',
  'provider',
  'model',
  'cycles',
  'extraction',
  'pdfUploaded',
  'maxSourceCharacters',
]);

export const INGESTION_CYCLES = Object.freeze([
  'structure',
  'encoding_ocr',
  'fidelity_review',
]);

function capabilityError() {
  return new Error('ingestion readiness could not be verified.');
}

export function validateIngestionCapability(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw capabilityError();
  if (Object.keys(value).length !== CAPABILITY_KEYS.size) throw capabilityError();
  if (Object.keys(value).some((key) => !CAPABILITY_KEYS.has(key))) throw capabilityError();
  if (value.schemaVersion !== 1
      || typeof value.available !== 'boolean'
      || value.provider !== 'ollama-cloud'
      || value.model !== 'glm-5.2'
      || value.extraction !== 'browser'
      || value.pdfUploaded !== false
      || !Number.isSafeInteger(value.maxSourceCharacters)
      || value.maxSourceCharacters < 1
      || value.maxSourceCharacters > 10_000_000
      || !Array.isArray(value.cycles)
      || value.cycles.length !== INGESTION_CYCLES.length
      || value.cycles.some((cycle, index) => cycle !== INGESTION_CYCLES[index])) {
    throw capabilityError();
  }
  return Object.freeze({
    ...value,
    cycles: Object.freeze([...value.cycles]),
  });
}
