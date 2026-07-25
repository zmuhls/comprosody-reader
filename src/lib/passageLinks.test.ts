import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PassageLink } from '../types/library';

const mocks = vi.hoisted(() => {
  const sortBy = vi.fn();
  const deleteCollection = vi.fn();
  const equals = vi.fn(() => ({
    sortBy,
    delete: deleteCollection,
  }));
  const where = vi.fn(() => ({ equals }));

  return {
    sortBy,
    deleteCollection,
    equals,
    where,
    add: vi.fn(),
    deleteLink: vi.fn(),
    deleteEntry: vi.fn(),
  };
});

vi.mock('./database', () => ({
  cadenceDatabase: {
    passageLinks: {
      where: mocks.where,
      add: mocks.add,
      delete: mocks.deleteLink,
    },
    entries: {
      delete: mocks.deleteEntry,
    },
  },
}));

import {
  addPassageLink,
  deletePassageLink,
  deletePassageLinksForPublication,
  listPassageLinksForEntry,
  listPassageLinksForPublication,
} from './passageLinks';

const passageLink: PassageLink = {
  id: 'link-1',
  entryId: 'entry-1',
  publicationId: 'solaris',
  publicationTitle: 'Solaris',
  publicationAuthor: 'Stanisław Lem',
  annotationId: 'annotation-1',
  selector: {
    cfiRange: 'epubcfi(/6/8!/4/2/6,:0,:52)',
    exact: 'We do not want to conquer the cosmos.',
    prefix: 'He answered, ',
    suffix: ' The room fell quiet.',
  },
  createdAt: 100,
  updatedAt: 100,
};

describe('passage link repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sortBy.mockResolvedValue([passageLink]);
    mocks.deleteCollection.mockResolvedValue(2);
  });

  it('lists an entry’s links in creation order using the entry index', async () => {
    await expect(listPassageLinksForEntry('entry-1')).resolves.toEqual([
      passageLink,
    ]);

    expect(mocks.where).toHaveBeenCalledWith('entryId');
    expect(mocks.equals).toHaveBeenCalledWith('entry-1');
    expect(mocks.sortBy).toHaveBeenCalledWith('createdAt');
  });

  it('can list all note links for a publication', async () => {
    await expect(
      listPassageLinksForPublication('solaris'),
    ).resolves.toEqual([passageLink]);

    expect(mocks.where).toHaveBeenCalledWith('publicationId');
    expect(mocks.equals).toHaveBeenCalledWith('solaris');
    expect(mocks.sortBy).toHaveBeenCalledWith('createdAt');
  });

  it('persists and returns a complete link without changing its exact quote', async () => {
    const result = await addPassageLink(passageLink);

    expect(result).toEqual(passageLink);
    expect(mocks.add).toHaveBeenCalledWith(passageLink);
  });

  it('fills in a local id and timestamps for a new sidecar link', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(900);

    const result = await addPassageLink({
      entryId: passageLink.entryId,
      publicationId: passageLink.publicationId,
      publicationTitle: passageLink.publicationTitle,
      publicationAuthor: passageLink.publicationAuthor,
      selector: passageLink.selector,
    });

    expect(result.id).toEqual(expect.any(String));
    expect(result.createdAt).toBe(900);
    expect(result.updatedAt).toBe(900);
    expect(result.selector.exact).toBe(passageLink.selector.exact);
    expect(mocks.add).toHaveBeenCalledWith(result);
  });

  it('deletes one sidecar link by id', async () => {
    await deletePassageLink('link-1');

    expect(mocks.deleteLink).toHaveBeenCalledWith('link-1');
  });

  it('removes publication sidecars without deleting their notes', async () => {
    await expect(
      deletePassageLinksForPublication('solaris'),
    ).resolves.toBe(2);

    expect(mocks.where).toHaveBeenCalledWith('publicationId');
    expect(mocks.equals).toHaveBeenCalledWith('solaris');
    expect(mocks.deleteCollection).toHaveBeenCalledOnce();
    expect(mocks.deleteEntry).not.toHaveBeenCalled();
  });
});
