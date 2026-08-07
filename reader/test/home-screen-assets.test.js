import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const icons = [
  ['comprosody-180.png', 180, 'a8005daf9e2930b4ba491ac0de71139c45f0d3c8ab507647d195de955d32e46d'],
  ['comprosody-192.png', 192, '5d28384cbac6a62becc12ddf5bc9aa0a4bb6440bb6df8370cfe8a741df57cc43'],
  ['comprosody-512.png', 512, '7e5eb1be4025fec7d4de9b505055238876d202069a9e2f445d77105afd32553e'],
  ['comprosody-maskable-512.png', 512, '1685e277cfa6dfc464f63c87dc8a2cdb560aed22d1a9ba855c354adf2e607c76'],
];

function chunks(bytes) {
  const result = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    result.push(type);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return result;
}

test('ships the four exact metadata-free neutral Rubi install icons', () => {
  for (const [filename, size, expectedHash] of icons) {
    const bytes = fs.readFileSync(`public/icons/${filename}`);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
    assert.equal(bytes[25], 2);
    assert.deepEqual(new Set(chunks(bytes)), new Set(['IHDR', 'IDAT', 'IEND']));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash);
  }
});
