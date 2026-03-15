import { useCallback } from 'react';
import { useApp, newEntry, newDirectory } from '../context/AppContext';
import type { Entry } from '../types/editor';

export function useStorage() {
  const { state, dispatch } = useApp();

  const createEntry = useCallback(
    (parentId: string | null) => {
      const entry = newEntry(parentId);
      dispatch({ type: 'CREATE_ENTRY', entry });
      return entry;
    },
    [dispatch]
  );

  const updateEntry = useCallback(
    (id: string, updates: Partial<Entry>) => {
      dispatch({ type: 'UPDATE_ENTRY', id, updates });
    },
    [dispatch]
  );

  const deleteEntry = useCallback(
    (id: string) => {
      dispatch({ type: 'DELETE_ENTRY', id });
    },
    [dispatch]
  );

  const renameEntry = useCallback(
    (id: string, name: string) => {
      dispatch({ type: 'RENAME_ENTRY', id, name });
    },
    [dispatch]
  );

  const createDirectory = useCallback(
    (parentId: string | null, name: string = 'New Folder') => {
      const dir = newDirectory(parentId, name);
      dispatch({ type: 'CREATE_DIRECTORY', directory: dir });
      return dir;
    },
    [dispatch]
  );

  const renameDirectory = useCallback(
    (id: string, name: string) => {
      dispatch({ type: 'RENAME_DIRECTORY', id, name });
    },
    [dispatch]
  );

  const deleteDirectory = useCallback(
    (id: string) => {
      dispatch({ type: 'DELETE_DIRECTORY', id });
    },
    [dispatch]
  );

  return {
    entries: state.entries,
    directories: state.directories,
    activeEntryId: state.activeEntryId,
    setActiveEntry: (id: string | null) =>
      dispatch({ type: 'SET_ACTIVE_ENTRY', id }),
    createEntry,
    updateEntry,
    deleteEntry,
    renameEntry,
    createDirectory,
    renameDirectory,
    deleteDirectory,
  };
}
