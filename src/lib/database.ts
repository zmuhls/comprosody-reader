import Dexie, { type EntityTable, type IDType } from 'dexie';
import type { Directory, Entry } from '../types/editor';
import type { PassageLink } from '../types/library';
import type { VoiceProfile } from './voiceProfile';

interface DatabaseMeta {
  key: string;
  value: string | number | boolean;
}

interface StoredVoiceProfile extends VoiceProfile {
  id: 'default';
}

export interface WorkspaceSnapshot {
  entries: Record<string, Entry>;
  directories: Record<string, Directory>;
}

class CadenceDatabase extends Dexie {
  entries!: EntityTable<Entry, 'id'>;
  directories!: EntityTable<Directory, 'id'>;
  voiceProfiles!: EntityTable<StoredVoiceProfile, 'id'>;
  passageLinks!: EntityTable<PassageLink, 'id'>;
  meta!: EntityTable<DatabaseMeta, 'key'>;

  constructor() {
    super('cadence-notes');
    this.version(1).stores({
      entries: 'id, parentId, updatedAt, createdAt, name',
      directories: 'id, parentId, name',
      voiceProfiles: 'id, updatedAt, schemaVersion',
      meta: 'key',
    });
    this.version(2).stores({
      entries: 'id, parentId, updatedAt, createdAt, name',
      directories: 'id, parentId, name',
      voiceProfiles: 'id, updatedAt, schemaVersion',
      passageLinks:
        'id, entryId, publicationId, [publicationId+entryId], createdAt',
      meta: 'key',
    });
  }
}

export const cadenceDatabase = new CadenceDatabase();

function recordById<T extends { id: string }>(rows: readonly T[]): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

async function replaceTableRows<T extends { id: string }>(
  table: EntityTable<T, 'id'>,
  rows: readonly T[],
): Promise<void> {
  const nextIds = new Set(rows.map((row) => row.id));
  const existingIds = await table.toCollection().primaryKeys();
  const removedIds = existingIds.filter(
    (id) => !nextIds.has(String(id)),
  ) as IDType<T, 'id'>[];
  await Promise.all([
    rows.length > 0 ? table.bulkPut([...rows]) : Promise.resolve(),
    removedIds.length > 0 ? table.bulkDelete(removedIds) : Promise.resolve(),
  ]);
}

/**
 * Loads IndexedDB as the canonical workspace. On the first run after upgrade,
 * existing localStorage data is imported in one transaction and marked so the
 * migration is never repeated.
 */
export async function hydrateWorkspaceDatabase(
  localFallback: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  return cadenceDatabase.transaction(
    'rw',
    cadenceDatabase.entries,
    cadenceDatabase.directories,
    cadenceDatabase.meta,
    async () => {
      const migrated = await cadenceDatabase.meta.get('local-storage-imported');
      const [entryCount, directoryCount] = await Promise.all([
        cadenceDatabase.entries.count(),
        cadenceDatabase.directories.count(),
      ]);

      if (!migrated && entryCount === 0 && directoryCount === 0) {
        const entries = Object.values(localFallback.entries);
        const directories = Object.values(localFallback.directories);
        if (entries.length) await cadenceDatabase.entries.bulkPut(entries);
        if (directories.length) await cadenceDatabase.directories.bulkPut(directories);
        await cadenceDatabase.meta.put({
          key: 'local-storage-imported',
          value: true,
        });
      }

      const [entries, directories] = await Promise.all([
        cadenceDatabase.entries.toArray(),
        cadenceDatabase.directories.toArray(),
      ]);
      return {
        entries: recordById(entries),
        directories: recordById(directories),
      };
    },
  );
}

export async function persistWorkspaceDatabase(
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  await cadenceDatabase.transaction(
    'rw',
    cadenceDatabase.entries,
    cadenceDatabase.directories,
    async () => {
      await Promise.all([
        replaceTableRows(cadenceDatabase.entries, Object.values(snapshot.entries)),
        replaceTableRows(
          cadenceDatabase.directories,
          Object.values(snapshot.directories),
        ),
      ]);
    },
  );
}

export async function persistVoiceProfileDatabase(
  profile: VoiceProfile,
): Promise<void> {
  await cadenceDatabase.voiceProfiles.put({ ...profile, id: 'default' });
}
