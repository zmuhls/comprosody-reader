import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { Entry, Directory, EntryKind, DirectoryKind } from '../types/editor';
import type { LexiconTerm, CorrectionCandidate } from '../types/lexicon';
import type { RefinementSettings } from '../types/llm';
import { defaultVoiceConfig, defaultProsody } from '../types/audio';
import {
  createDebouncedPersist,
  loadEntries,
  saveEntries,
  loadDirectories,
  saveDirectories,
  loadLexicon,
  saveLexicon,
  loadRefinementSettings,
  saveRefinementSettings,
} from '../lib/storage';
import { mergeCandidate } from '../lib/lexicon';
import { countWords } from '../lib/entries';

const DEFAULT_REFINEMENT_SETTINGS: RefinementSettings = {
  genre: 'freewrite',
  scale: 'sentence',
  temperature: 0.5,
};

export interface AppState {
  entries: Record<string, Entry>;
  directories: Record<string, Directory>;
  activeEntryId: string | null;
  refinementSettings: RefinementSettings;
  lexicon: Record<string, LexiconTerm>;
}

export type AppAction =
  | { type: 'SET_ACTIVE_ENTRY'; id: string | null }
  | { type: 'CREATE_ENTRY'; entry: Entry }
  | { type: 'UPDATE_ENTRY'; id: string; updates: Partial<Entry> }
  | { type: 'DELETE_ENTRY'; id: string }
  | { type: 'CREATE_DIRECTORY'; directory: Directory }
  | { type: 'RENAME_DIRECTORY'; id: string; name: string }
  | { type: 'DELETE_DIRECTORY'; id: string }
  | { type: 'MOVE_NODE'; nodeType: 'entry' | 'directory'; id: string; newParentId: string | null }
  | { type: 'REORDER_ENTRY'; id: string; beforeId: string | null }
  | { type: 'SET_DIRECTORY_KIND'; id: string; kind: DirectoryKind }
  | { type: 'ATTACH_NOTE'; noteId: string; entryId: string }
  | { type: 'DETACH_NOTE'; noteId: string }
  | { type: 'UPDATE_REFINEMENT_SETTINGS'; settings: Partial<RefinementSettings> }
  | { type: 'RENAME_ENTRY'; id: string; name: string }
  | { type: 'CONFIRM_LEXICON_TERM'; candidate: CorrectionCandidate }
  | { type: 'DELETE_LEXICON_TERM'; id: string }
  | { type: 'RECORD_LEXICON_MISFIRE'; id: string };

/** True when `candidateId` sits anywhere below `ancestorId` in the directory tree. */
export function isDescendantDirectory(
  directories: Record<string, Directory>,
  candidateId: string,
  ancestorId: string
): boolean {
  let cursor = directories[candidateId]?.parentId ?? null;
  while (cursor !== null) {
    if (cursor === ancestorId) return true;
    cursor = directories[cursor]?.parentId ?? null;
  }
  return false;
}

function maxOrderIn(entries: Record<string, Entry>, parentId: string | null): number {
  let max = -1;
  for (const entry of Object.values(entries)) {
    if (entry.parentId === parentId && entry.order > max) max = entry.order;
  }
  return max;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_ENTRY':
      return { ...state, activeEntryId: action.id };

    case 'CREATE_ENTRY': {
      // The reducer owns ordering: whatever the caller set, a new entry lands
      // after its siblings so books never get colliding chapter positions.
      const order = maxOrderIn(state.entries, action.entry.parentId) + 1;
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.entry.id]: { ...action.entry, order },
        },
        activeEntryId: action.entry.id,
      };
    }

    case 'UPDATE_ENTRY': {
      const existing = state.entries[action.id];
      if (!existing) return state;
      const merged = { ...existing, ...action.updates, updatedAt: Date.now() };
      if (action.updates.rawTranscript !== undefined) {
        merged.wordCount = countWords(action.updates.rawTranscript);
      }
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.id]: merged,
        },
      };
    }

    case 'DELETE_ENTRY': {
      const nextEntries = { ...state.entries };
      delete nextEntries[action.id];
      // Notes pinned to the deleted entry survive, unpinned.
      for (const [id, entry] of Object.entries(nextEntries)) {
        if (entry.attachedToId === action.id) {
          const detached = { ...entry };
          delete detached.attachedToId;
          nextEntries[id] = detached;
        }
      }
      return {
        ...state,
        entries: nextEntries,
        activeEntryId: state.activeEntryId === action.id ? null : state.activeEntryId,
      };
    }

    case 'MOVE_NODE': {
      if (action.nodeType === 'directory') {
        const dir = state.directories[action.id];
        if (!dir || dir.parentId === action.newParentId) return state;
        if (action.newParentId !== null) {
          if (!state.directories[action.newParentId]) return state;
          if (
            action.newParentId === action.id ||
            isDescendantDirectory(state.directories, action.newParentId, action.id)
          ) {
            return state;
          }
        }
        return {
          ...state,
          directories: {
            ...state.directories,
            [action.id]: { ...dir, parentId: action.newParentId },
          },
        };
      }

      const entry = state.entries[action.id];
      if (!entry || entry.parentId === action.newParentId) return state;
      if (action.newParentId !== null && !state.directories[action.newParentId]) {
        return state;
      }
      const moved: Entry = {
        ...entry,
        parentId: action.newParentId,
        order: maxOrderIn(state.entries, action.newParentId) + 1,
        updatedAt: Date.now(),
      };
      // A note dragged away on its own comes unpinned; an entry that moves
      // brings its pinned notes with it so display and location stay aligned.
      if (moved.kind === 'note' && moved.attachedToId !== undefined) {
        delete moved.attachedToId;
      }
      const nextEntries = { ...state.entries, [action.id]: moved };
      for (const [id, candidate] of Object.entries(state.entries)) {
        if (candidate.attachedToId === action.id) {
          nextEntries[id] = { ...candidate, parentId: action.newParentId };
        }
      }
      return { ...state, entries: nextEntries };
    }

    case 'REORDER_ENTRY': {
      const entry = state.entries[action.id];
      if (!entry || action.beforeId === action.id) return state;
      const siblings = Object.values(state.entries)
        .filter(
          (e) =>
            e.parentId === entry.parentId &&
            e.id !== entry.id &&
            e.attachedToId === undefined
        )
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      const insertAt =
        action.beforeId === null
          ? siblings.length
          : siblings.findIndex((s) => s.id === action.beforeId);
      if (insertAt === -1) return state;
      siblings.splice(insertAt, 0, entry);
      const nextEntries = { ...state.entries };
      siblings.forEach((sibling, index) => {
        if (nextEntries[sibling.id].order !== index) {
          nextEntries[sibling.id] = { ...nextEntries[sibling.id], order: index };
        }
      });
      return { ...state, entries: nextEntries };
    }

    case 'SET_DIRECTORY_KIND': {
      const dir = state.directories[action.id];
      if (!dir || dir.kind === action.kind) return state;
      let entries = state.entries;
      if (action.kind === 'book') {
        // Promotion freezes the alphabetical order the folder was showing.
        const children = Object.values(state.entries)
          .filter((e) => e.parentId === action.id && e.attachedToId === undefined)
          .sort((a, b) => a.name.localeCompare(b.name));
        const next = { ...state.entries };
        children.forEach((child, index) => {
          next[child.id] = { ...child, order: index };
        });
        entries = next;
      }
      return {
        ...state,
        entries,
        directories: {
          ...state.directories,
          [action.id]: { ...dir, kind: action.kind },
        },
      };
    }

    case 'ATTACH_NOTE': {
      const note = state.entries[action.noteId];
      const target = state.entries[action.entryId];
      if (
        !note ||
        !target ||
        note.kind !== 'note' ||
        target.kind === 'note' ||
        action.noteId === action.entryId
      ) {
        return state;
      }
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.noteId]: {
            ...note,
            attachedToId: action.entryId,
            parentId: target.parentId,
          },
        },
      };
    }

    case 'DETACH_NOTE': {
      const note = state.entries[action.noteId];
      if (!note || note.attachedToId === undefined) return state;
      const detached = { ...note };
      delete detached.attachedToId;
      return {
        ...state,
        entries: { ...state.entries, [action.noteId]: detached },
      };
    }

    case 'CREATE_DIRECTORY':
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.directory.id]: action.directory,
        },
      };

    case 'RENAME_DIRECTORY': {
      const dir = state.directories[action.id];
      if (!dir) return state;
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.id]: { ...dir, name: action.name },
        },
      };
    }

    case 'DELETE_DIRECTORY': {
      const { directoryIds } = collectDirectoryCascade(
        state.directories,
        state.entries,
        action.id
      );
      const nextDirectories: Record<string, Directory> = {};
      for (const [id, dir] of Object.entries(state.directories)) {
        if (!directoryIds.has(id)) nextDirectories[id] = dir;
      }
      const restEntries: Record<string, Entry> = {};
      for (const [id, entry] of Object.entries(state.entries)) {
        if (entry.parentId === null || !directoryIds.has(entry.parentId)) {
          restEntries[id] = entry;
        }
      }
      // Unpin survivors whose target entry died in the cascade.
      for (const [id, entry] of Object.entries(restEntries)) {
        if (entry.attachedToId !== undefined && !restEntries[entry.attachedToId]) {
          const detached = { ...entry };
          delete detached.attachedToId;
          restEntries[id] = detached;
        }
      }
      return {
        ...state,
        directories: nextDirectories,
        entries: restEntries,
        activeEntryId:
          state.activeEntryId && !restEntries[state.activeEntryId]
            ? null
            : state.activeEntryId,
      };
    }

    case 'UPDATE_REFINEMENT_SETTINGS':
      return {
        ...state,
        refinementSettings: { ...state.refinementSettings, ...action.settings },
      };

    case 'RENAME_ENTRY': {
      const entry = state.entries[action.id];
      if (!entry) return state;
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.id]: { ...entry, name: action.name, updatedAt: Date.now() },
        },
      };
    }

    case 'CONFIRM_LEXICON_TERM':
      return {
        ...state,
        lexicon: mergeCandidate(state.lexicon, action.candidate, Date.now()),
      };

    case 'DELETE_LEXICON_TERM': {
      if (!state.lexicon[action.id]) return state;
      const nextLexicon = { ...state.lexicon };
      delete nextLexicon[action.id];
      return { ...state, lexicon: nextLexicon };
    }

    case 'RECORD_LEXICON_MISFIRE': {
      const term = state.lexicon[action.id];
      if (!term) return state;
      return {
        ...state,
        lexicon: {
          ...state.lexicon,
          [action.id]: { ...term, misfires: term.misfires + 1, lastUsedAt: Date.now() },
        },
      };
    }

    default:
      return state;
  }
}

export function collectDirectoryCascade(
  directories: Record<string, Directory>,
  entries: Record<string, Entry>,
  rootId: string
): { directoryIds: Set<string>; entryIds: string[] } {
  const directoryIds = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const dir of Object.values(directories)) {
      if (dir.parentId === parentId && !directoryIds.has(dir.id)) {
        directoryIds.add(dir.id);
        queue.push(dir.id);
      }
    }
  }
  const entryIds = Object.values(entries)
    .filter((entry) => entry.parentId !== null && directoryIds.has(entry.parentId))
    .map((entry) => entry.id);
  return { directoryIds, entryIds };
}

function createInitialState(): AppState {
  const savedSettings = loadRefinementSettings();
  return {
    entries: loadEntries(),
    directories: loadDirectories(),
    activeEntryId: null,
    refinementSettings: savedSettings ?? DEFAULT_REFINEMENT_SETTINGS,
    lexicon: loadLexicon(),
  };
}

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, null, createInitialState);
  const entriesPersist = useMemo(() => createDebouncedPersist(saveEntries), []);
  const dirsPersist = useMemo(() => createDebouncedPersist(saveDirectories), []);
  const lexiconPersist = useMemo(() => createDebouncedPersist(saveLexicon), []);
  const hasHydratedEntries = useRef(false);
  const hasHydratedDirs = useRef(false);
  const hasHydratedLexicon = useRef(false);

  // Persist entries to localStorage, debounced; skip the redundant mount write
  useEffect(() => {
    if (!hasHydratedEntries.current) {
      hasHydratedEntries.current = true;
      return;
    }
    entriesPersist.schedule(state.entries);
  }, [state.entries, entriesPersist]);

  // Persist directories to localStorage, debounced; skip the redundant mount write
  useEffect(() => {
    if (!hasHydratedDirs.current) {
      hasHydratedDirs.current = true;
      return;
    }
    dirsPersist.schedule(state.directories);
  }, [state.directories, dirsPersist]);

  // Persist the lexicon to localStorage, debounced; skip the redundant mount write
  useEffect(() => {
    if (!hasHydratedLexicon.current) {
      hasHydratedLexicon.current = true;
      return;
    }
    lexiconPersist.schedule(state.lexicon);
  }, [state.lexicon, lexiconPersist]);

  useEffect(() => {
    saveRefinementSettings(state.refinementSettings);
  }, [state.refinementSettings]);

  // Flush pending writes on tab close / backgrounding; setItem is synchronous, so this is reliable
  useEffect(() => {
    const flushAll = () => {
      entriesPersist.flush();
      dirsPersist.flush();
      lexiconPersist.flush();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushAll();
    };
  }, [entriesPersist, dirsPersist, lexiconPersist]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function newEntry(parentId: string | null, kind: EntryKind = 'writing'): Entry {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    parentId,
    kind,
    order: 0,
    rawTranscript: '',
    refinedText: '',
    prosody: defaultProsody,
    voiceConfig: defaultVoiceConfig,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: 0,
    recordedDurationMs: 0,
    audioTakes: 0,
    draftHistory: [],
  };
}

export function newDirectory(
  parentId: string | null,
  name: string,
  kind: DirectoryKind = 'folder'
): Directory {
  return {
    id: crypto.randomUUID(),
    name,
    parentId,
    kind,
  };
}
