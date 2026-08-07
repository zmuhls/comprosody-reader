import { describe, expect, it } from 'vitest';
import { newDirectory, newEntry } from './entries';

describe('newEntry', () => {
  it('tags an entry to the book it was created against', () => {
    expect(newEntry(null, 'note', 'solaris').publicationId).toBe('solaris');
  });

  it('omits the publication entirely for free-standing work', () => {
    expect('publicationId' in newEntry(null, 'writing')).toBe(false);
    expect('publicationId' in newEntry(null, 'writing', null)).toBe(false);
  });

  it('still defaults to writing so quick-create lands on the main artifact', () => {
    expect(newEntry(null).kind).toBe('writing');
  });
});

describe('newDirectory', () => {
  it('creates folders by default and books on request', () => {
    expect(newDirectory(null, 'Notes').kind).toBe('folder');
    expect(newDirectory(null, 'Solaris', 'book').kind).toBe('book');
  });
});
