import { cadenceDatabase } from './database';

describe('CadenceDatabase schema', () => {
  it('uses schema version 2 without replacing the existing workspace tables', () => {
    expect(cadenceDatabase.verno).toBe(2);
    expect(cadenceDatabase.tables.map((table) => table.name).sort()).toEqual([
      'directories',
      'entries',
      'meta',
      'passageLinks',
      'voiceProfiles',
    ]);
  });

  it('indexes passage links for note, publication, compound, and time lookups', () => {
    const passageLinks = cadenceDatabase.table('passageLinks');
    const indexes = passageLinks.schema.indexes.map((index) => index.name);

    expect(passageLinks.schema.primKey.name).toBe('id');
    expect(indexes).toEqual([
      'entryId',
      'publicationId',
      '[publicationId+entryId]',
      'createdAt',
    ]);
  });
});
