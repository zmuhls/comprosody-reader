import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hashPassword } from '../lib/credentials.js';
import {
  CredentialConflictError,
  FileStore,
  PostgresStore,
} from '../lib/store.js';

test('file credential initialization is idempotent and rotation is atomic', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readings-credential-store-'));
  const filename = path.join(tmp, 'state.json');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const store = new FileStore(filename);
  await store.init();

  const firstHash = await hashPassword('the first sufficiently long password');
  const ignoredHash = await hashPassword('an ignored sufficiently long password');
  const initial = await store.initializeCredentialRecord(firstHash);
  assert.equal(initial.revision, 0);
  assert.equal(initial.registrationOpen, true);
  assert.equal((await store.initializeCredentialRecord(ignoredHash)).passwordHash, firstHash);

  const nextHash = await hashPassword('the second sufficiently long password');
  const rotated = await store.rotateCredentialRecord(nextHash, 0, { closeRegistration: true });
  assert.equal(rotated.revision, 1);
  assert.equal(rotated.registrationOpen, false);
  assert.equal(rotated.passwordHash, nextHash);
  await assert.rejects(
    store.rotateCredentialRecord(firstHash, 0),
    (error) => error instanceof CredentialConflictError
      && error.currentRevision === 1
      && !error.message.includes(firstHash),
  );

  const restarted = new FileStore(filename);
  await restarted.init();
  assert.deepEqual(await restarted.getCredentialRecord(), rotated);
});

test('file credential corruption fails closed', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readings-credential-corrupt-'));
  const filename = path.join(tmp, 'state.json');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(filename, '{not json');
  const store = new FileStore(filename);
  await assert.rejects(store.init(), /could not be read/i);
});

class CredentialPool {
  constructor() {
    this.record = null;
  }

  row() {
    if (!this.record) return undefined;
    return {
      passwordHash: this.record.passwordHash,
      revision: this.record.revision,
      registrationOpen: this.record.registrationOpen,
      updatedAt: this.record.updatedAt,
    };
  }

  async query(sql, parameters = []) {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    if (normalized.startsWith('SELECT password_hash AS "passwordHash"')) {
      return { rows: this.record ? [this.row()] : [] };
    }
    if (normalized.startsWith('INSERT INTO reader_credentials')) {
      if (this.record) return { rows: [] };
      this.record = {
        passwordHash: parameters[0],
        revision: 0,
        registrationOpen: true,
        updatedAt: new Date(),
      };
      return { rows: [this.row()] };
    }
    if (normalized.startsWith('UPDATE reader_credentials')) {
      if (!this.record
          || this.record.revision !== parameters[1]
          || (parameters[2] && !this.record.registrationOpen)) {
        return { rows: [] };
      }
      this.record = {
        passwordHash: parameters[0],
        revision: this.record.revision + 1,
        registrationOpen: parameters[2] ? false : this.record.registrationOpen,
        updatedAt: new Date(),
      };
      return { rows: [this.row()] };
    }
    throw new Error(`unexpected query: ${normalized}`);
  }

  async end() {}
}

test('postgres credential compare-and-swap closes registration once', async () => {
  const pool = new CredentialPool();
  const store = new PostgresStore(undefined, {}, pool);
  const firstHash = await hashPassword('postgres initial long password');
  const initial = await store.initializeCredentialRecord(firstHash);
  assert.equal(initial.revision, 0);
  assert.equal(initial.registrationOpen, true);

  const nextHash = await hashPassword('postgres rotated long password');
  const rotated = await store.rotateCredentialRecord(nextHash, 0, { closeRegistration: true });
  assert.equal(rotated.revision, 1);
  assert.equal(rotated.registrationOpen, false);
  await assert.rejects(
    store.rotateCredentialRecord(firstHash, 0, { closeRegistration: true }),
    (error) => error instanceof CredentialConflictError && error.currentRevision === 1,
  );
});
