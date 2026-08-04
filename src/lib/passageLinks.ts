import type { NewPassageLink, PassageLink } from '../types/library';
import { cadenceDatabase } from './database';

export async function listPassageLinksForEntry(
  entryId: string,
): Promise<PassageLink[]> {
  return cadenceDatabase.passageLinks
    .where('entryId')
    .equals(entryId)
    .sortBy('createdAt');
}

export async function listPassageLinksForPublication(
  publicationId: string,
): Promise<PassageLink[]> {
  return cadenceDatabase.passageLinks
    .where('publicationId')
    .equals(publicationId)
    .sortBy('createdAt');
}

export async function addPassageLink(
  input: NewPassageLink,
): Promise<PassageLink> {
  const now = Date.now();
  const passageLink: PassageLink = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };

  await cadenceDatabase.passageLinks.add(passageLink);
  return passageLink;
}

export async function deletePassageLink(id: string): Promise<void> {
  await cadenceDatabase.passageLinks.delete(id);
}

/**
 * Removes only the sidecar relationships for a publication. Notes are stored
 * in the `entries` table and are deliberately outside this operation.
 */
export async function deletePassageLinksForPublication(
  publicationId: string,
): Promise<number> {
  return cadenceDatabase.passageLinks
    .where('publicationId')
    .equals(publicationId)
    .delete();
}
