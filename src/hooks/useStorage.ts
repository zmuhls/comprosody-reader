import { useCallback } from 'react';
import {
  useApp,
  newEntry,
  newDirectory,
  collectDirectoryCascade,
} from '../context/AppContext';
import { deleteRecordings, deleteRecordingsForEntries } from '../lib/audioStore';
import type { Entry, EntryKind, DirectoryKind } from '../types/editor';

export function useStorage() {
  const { state, dispatch } = useApp();

  const createEntry = useCallback(
    (parentId: string | null, kind: EntryKind = 'writing') => {
      const entry = newEntry(parentId, kind);
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
      void deleteRecordings(id).catch(console.error);
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

  const moveEntry = useCallback(
    (id: string, parentId: string | null) => {
      dispatch({ type: 'MOVE_NODE', nodeType: 'entry', id, newParentId: parentId });
    },
    [dispatch]
  );

  const createDirectory = useCallback(
    (
      parentId: string | null,
      name: string = 'New Folder',
      kind: DirectoryKind = 'folder'
    ) => {
      const dir = newDirectory(parentId, name, kind);
      dispatch({ type: 'CREATE_DIRECTORY', directory: dir });
      return dir;
    },
    [dispatch]
  );

  const moveNode = useCallback(
    (nodeType: 'entry' | 'directory', id: string, newParentId: string | null) => {
      dispatch({ type: 'MOVE_NODE', nodeType, id, newParentId });
    },
    [dispatch]
  );

  const reorderEntry = useCallback(
    (id: string, beforeId: string | null) => {
      dispatch({ type: 'REORDER_ENTRY', id, beforeId });
    },
    [dispatch]
  );

  const setDirectoryKind = useCallback(
    (id: string, kind: DirectoryKind) => {
      dispatch({ type: 'SET_DIRECTORY_KIND', id, kind });
    },
    [dispatch]
  );

  const attachNote = useCallback(
    (noteId: string, entryId: string) => {
      dispatch({ type: 'ATTACH_NOTE', noteId, entryId });
    },
    [dispatch]
  );

  const detachNote = useCallback(
    (noteId: string) => {
      dispatch({ type: 'DETACH_NOTE', noteId });
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
      const { entryIds } = collectDirectoryCascade(
        state.directories,
        state.entries,
        id
      );
      void deleteRecordingsForEntries(entryIds).catch(console.error);
      dispatch({ type: 'DELETE_DIRECTORY', id });
    },
    [dispatch, state.directories, state.entries]
  );

  const moveDirectory = useCallback(
    (id: string, parentId: string | null) => {
      dispatch({
        type: 'MOVE_NODE',
        nodeType: 'directory',
        id,
        newParentId: parentId,
      });
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
    moveEntry,
    createDirectory,
    renameDirectory,
    moveDirectory,
    deleteDirectory,
    moveNode,
    reorderEntry,
    setDirectoryKind,
    attachNote,
    detachNote,
  };
}
