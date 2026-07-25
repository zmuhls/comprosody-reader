import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('.');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const ignoredGenerated = new Set([
  'public/vendor-reader.js',
  'public/pdf-ingest.js',
  'public/pdf.worker.min.mjs',
]);

function filesUnder(directory = root) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) result.push(...filesUnder(absolute));
    else if (!ignoredGenerated.has(relative)) result.push(relative);
  }
  return result;
}

test('public snapshot starts with an empty catalog and no private artifact classes', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync('catalog.json', 'utf8')), []);
  const files = filesUnder();
  assert.equal(files.some((file) => /(?:^|\/)(?:source|output|tmp|data|reports)(?:\/|$)/u.test(file)), false);
  assert.equal(files.some((file) => /\.(?:pdf|epub|csv|xlsx?|docx)$/iu.test(file)), false);
  assert.equal(files.some((file) => /(?:convert|conversion|apple.*highlight|llm-ranker)/iu.test(file)), false);
  assert.equal(files.some((file) => /public\/covers\//u.test(file)), false);
});

test('source contains no private titles, unrelated product surfaces, or credential values', () => {
  const sourceFiles = filesUnder().filter((file) => /\.(?:js|json|html|css|md|toml)$/u.test(file));
  const authored = sourceFiles
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const normalized = authored
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9/]+/gu, '');
  const forbidden = [
    'YmFybmJ1cm5pbmc=',
    'Z29vZGNvdW50cnlwZW9wbGU=',
    'c29sYXJpcw==',
    'ZmF1bGtuZXI=',
    'b2Nvbm5vcg==',
    'c3RhbmlzbGF3bGVt',
    'Y2FkZW5jZQ==',
    'L3N0dWRpbw==',
    'aW1wcm92ZW1lbnRtZXRyaWNz',
    'L2FwaS9xdW90ZXM=',
    'cmFua2luZ3J1bnM=',
    'c2VlZGVkc291cmNlcXVvdGU=',
  ].map((value) => Buffer.from(value, 'base64').toString());
  for (const value of forbidden) assert.equal(normalized.includes(value), false, value);
  assert.doesNotMatch(
    authored,
    /c[f]fcf[0-9a-z.]+|(?:api[_-]?key|token)\s*[:=]\s*["'][a-z0-9._-]{24,}["']/iu,
  );
});

test('deployment and Git ignore policies deny private and generated artifacts', () => {
  const railwayIgnore = fs.readFileSync('.railwayignore', 'utf8');
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  for (const pattern of [
    '**/*.pdf',
    '**/*.epub',
    '**/*.csv',
    '**/*.xlsx',
    '**/*.docx',
    '.env',
  ]) {
    assert.match(railwayIgnore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'));
  }
  for (const generated of [
    'public/vendor-reader.js',
    'public/pdf-ingest.js',
    'public/pdf.worker.min.mjs',
  ]) {
    assert.match(gitignore, new RegExp(`^${generated.replaceAll('.', '\\.')}$`, 'mu'));
  }
});
