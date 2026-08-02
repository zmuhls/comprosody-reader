/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { Entry, Directory } from '../types/editor';
import type { RefinementSettings } from '../types/llm';
import type { VoiceProfile } from '../lib/voiceProfile';
import { defaultVoiceConfig, defaultProsody } from '../types/audio';
import { buildVoiceProfile } from '../lib/voiceProfile';
import {
  hydrateWorkspaceDatabase,
  persistVoiceProfileDatabase,
  persistWorkspaceDatabase,
} from '../lib/database';
import {
  loadEntries,
  saveEntries,
  loadDirectories,
  saveDirectories,
  saveVoiceProfile,
  loadRefinementSettings,
  saveRefinementSettings,
} from '../lib/storage';

export interface AppError {
  id: string;
  message: string;
  type: 'transcription' | 'refinement' | 'network' | 'generic';
}

export interface AppState {
  entries: Record<string, Entry>;
  directories: Record<string, Directory>;
  activeEntryId: string | null;
  refinementSettings: RefinementSettings;
  errors: AppError[];
  history: Record<string, Entry>[];
  historyIndex: number;
}

export type AppAction =
  | {
      type: 'HYDRATE_WORKSPACE';
      entries: Record<string, Entry>;
      directories: Record<string, Directory>;
    }
  | { type: 'SET_ACTIVE_ENTRY'; id: string | null }
  | { type: 'CREATE_ENTRY'; entry: Entry }
  | { type: 'UPDATE_ENTRY'; id: string; updates: Partial<Entry>; recordHistory?: boolean }
  | { type: 'DELETE_ENTRY'; id: string }
  | { type: 'CREATE_DIRECTORY'; directory: Directory }
  | { type: 'RENAME_DIRECTORY'; id: string; name: string }
  | { type: 'DELETE_DIRECTORY'; id: string }
  | { type: 'MOVE_ENTRY'; id: string; parentId: string | null }
  | { type: 'MOVE_DIRECTORY'; id: string; parentId: string | null }
  | { type: 'UPDATE_REFINEMENT_SETTINGS'; settings: Partial<RefinementSettings> }
  | { type: 'RENAME_ENTRY'; id: string; name: string }
  | { type: 'SET_ERROR'; error: AppError }
  | { type: 'CLEAR_ERROR'; id: string }
  | { type: 'UNDO' }
  | { type: 'REDO' };

const HISTORY_LIMIT = 30;

function recordHistory(
  state: AppState,
  nextEntries: Record<string, Entry>
): { history: Record<string, Entry>[]; historyIndex: number } {
  const history = state.history.slice(0, state.historyIndex + 1);
  // Ensure the previous current state is captured before the new one.
  if (history.length === 0 || history[history.length - 1] !== state.entries) {
    history.push(state.entries);
  }
  history.push(nextEntries);
  while (history.length > HISTORY_LIMIT) {
    history.shift();
  }
  return { history, historyIndex: history.length - 1 };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'HYDRATE_WORKSPACE':
      return {
        ...state,
        entries: action.entries,
        directories: action.directories,
        activeEntryId:
          state.activeEntryId && action.entries[state.activeEntryId]
            ? state.activeEntryId
            : mostRecentEntryId(action.entries),
        history: [],
        historyIndex: -1,
      };

    case 'SET_ACTIVE_ENTRY':
      return { ...state, activeEntryId: action.id };

    case 'CREATE_ENTRY': {
      const nextEntries = { ...state.entries, [action.entry.id]: action.entry };
      return {
        ...state,
        entries: nextEntries,
        activeEntryId: action.entry.id,
        ...recordHistory(state, nextEntries),
      };
    }

    case 'UPDATE_ENTRY': {
      const existing = state.entries[action.id];
      if (!existing) return state;
      const nextEntries = {
        ...state.entries,
        [action.id]: { ...existing, ...action.updates, updatedAt: Date.now() },
      };
      return {
        ...state,
        entries: nextEntries,
        ...(action.recordHistory !== false ? recordHistory(state, nextEntries) : {}),
      };
    }

    case 'DELETE_ENTRY': {
      const rest = { ...state.entries };
      delete rest[action.id];
      return {
        ...state,
        entries: rest,
        activeEntryId: state.activeEntryId === action.id ? null : state.activeEntryId,
        ...recordHistory(state, rest),
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
      const idsToRemove = collectDescendantDirectoryIds(action.id, state.directories);
      idsToRemove.add(action.id);

      const restDirs: Record<string, Directory> = {};
      for (const [id, dir] of Object.entries(state.directories)) {
        if (!idsToRemove.has(id)) restDirs[id] = dir;
      }

      const restEntries: Record<string, Entry> = {};
      for (const [id, entry] of Object.entries(state.entries)) {
        if (!idsToRemove.has(entry.parentId ?? '')) restEntries[id] = entry;
      }

      const nextActive =
        state.activeEntryId && !restEntries[state.activeEntryId]
          ? null
          : state.activeEntryId;

      return {
        ...state,
        directories: restDirs,
        entries: restEntries,
        activeEntryId: nextActive,
        ...recordHistory(state, restEntries),
      };
    }

    case 'MOVE_ENTRY': {
      const entry = state.entries[action.id];
      if (!entry || entry.parentId === action.parentId) return state;
      if (action.parentId !== null && !state.directories[action.parentId]) return state;
      const nextEntries = {
        ...state.entries,
        [action.id]: { ...entry, parentId: action.parentId, updatedAt: Date.now() },
      };
      return {
        ...state,
        entries: nextEntries,
        ...recordHistory(state, nextEntries),
      };
    }

    case 'MOVE_DIRECTORY': {
      const directory = state.directories[action.id];
      if (!directory || directory.parentId === action.parentId) return state;
      if (action.parentId !== null && !state.directories[action.parentId]) return state;
      if (action.parentId === action.id) return state;
      if (
        action.parentId !== null
        && collectDescendantDirectoryIds(action.id, state.directories).has(action.parentId)
      ) {
        return state;
      }
      return {
        ...state,
        directories: {
          ...state.directories,
          [action.id]: { ...directory, parentId: action.parentId },
        },
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
      const nextEntries: Record<string, Entry> = {
        ...state.entries,
        [action.id]: {
          ...entry,
          name: action.name,
          titleSource: 'manual',
          titleBasis: undefined,
          updatedAt: Date.now(),
        },
      };
      return {
        ...state,
        entries: nextEntries,
        ...recordHistory(state, nextEntries),
      };
    }

    case 'SET_ERROR':
      return {
        ...state,
        errors: [...state.errors, action.error],
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        errors: state.errors.filter((e) => e.id !== action.id),
      };

    case 'UNDO':
      if (state.historyIndex <= 0) return state;
      return {
        ...state,
        entries: state.history[state.historyIndex - 1],
        historyIndex: state.historyIndex - 1,
      };

    case 'REDO':
      if (state.historyIndex >= state.history.length - 1) return state;
      return {
        ...state,
        entries: state.history[state.historyIndex + 1],
        historyIndex: state.historyIndex + 1,
      };

    default:
      return state;
  }
}

function collectDescendantDirectoryIds(
  rootId: string,
  directories: Record<string, Directory>
): Set<string> {
  const ids = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dir of Object.values(directories)) {
      if (dir.parentId === current) {
        ids.add(dir.id);
        queue.push(dir.id);
      }
    }
  }
  return ids;
}

function mostRecentEntryId(entries: Record<string, Entry>): string | null {
  const entriesByRecency = Object.values(entries).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  return entriesByRecency[0]?.id ?? null;
}

function createInitialState(): AppState {
  const storedSettings = loadRefinementSettings();
  const entries = loadEntries();
  return {
    entries,
    directories: loadDirectories(),
    activeEntryId: mostRecentEntryId(entries),
    refinementSettings: {
      genre: 'academic',
      scale: 'sentence',
      temperature: 0.2,
      mode: 'faithful',
      highFidelity: true,
      autoRefine: true,
      ...storedSettings,
    },
    errors: [],
    history: [],
    historyIndex: -1,
  };
}

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
  voiceProfile: VoiceProfile;
  storageReady: boolean;
} | null>(null);

function useDebouncedSaver<T>(
  value: T,
  save: (value: T) => void,
  delayMs: number = 500
): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized === lastSavedRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      save(value);
      lastSavedRef.current = serialized;
      timeoutRef.current = null;
    }, delayMs);

    const handleBeforeUnload = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        save(value);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [value, save, delayMs]);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, reducerDispatch] = useReducer(appReducer, null, createInitialState);
  const [storageReady, setStorageReady] = useState(false);
  const storageReadyRef = useRef(false);
  const pendingWorkspaceActionsRef = useRef<AppAction[]>([]);
  const dispatch = useCallback<Dispatch<AppAction>>(
    (action) => {
      if (
        !storageReadyRef.current &&
        action.type !== 'HYDRATE_WORKSPACE' &&
        action.type !== 'SET_ERROR' &&
        action.type !== 'CLEAR_ERROR' &&
        action.type !== 'UPDATE_REFINEMENT_SETTINGS'
      ) {
        pendingWorkspaceActionsRef.current.push(action);
      }
      reducerDispatch(action);
    },
    [],
  );
  const voiceProfile = useMemo(
    () => buildVoiceProfile(state.entries),
    [state.entries],
  );

  useDebouncedSaver(state.entries, saveEntries, 500);
  useDebouncedSaver(state.directories, saveDirectories, 500);
  useDebouncedSaver(voiceProfile, saveVoiceProfile, 1_000);
  useDebouncedSaver(
    state.refinementSettings,
    saveRefinementSettings,
    500,
  );

  useEffect(() => {
    let cancelled = false;
    hydrateWorkspaceDatabase({
      entries: state.entries,
      directories: state.directories,
    })
      .then((workspace) => {
        if (cancelled) return;
        reducerDispatch({ type: 'HYDRATE_WORKSPACE', ...workspace });
        for (const action of pendingWorkspaceActionsRef.current) {
          reducerDispatch(action);
        }
        pendingWorkspaceActionsRef.current = [];
        storageReadyRef.current = true;
        setStorageReady(true);
      })
      .catch((error) => {
        console.error('IndexedDB hydration failed; using local backup:', error);
        if (!cancelled) {
          pendingWorkspaceActionsRef.current = [];
          storageReadyRef.current = true;
          setStorageReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // The initial local snapshot is intentionally imported only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const timer = setTimeout(() => {
      Promise.all([
        persistWorkspaceDatabase({
          entries: state.entries,
          directories: state.directories,
        }),
        persistVoiceProfileDatabase(voiceProfile),
      ]).catch((error) => {
        console.error('IndexedDB save failed; local backup remains available:', error);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [state.entries, state.directories, storageReady, voiceProfile]);

  return (
    <AppContext.Provider
      value={{ state, dispatch, voiceProfile, storageReady }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function newEntry(parentId: string | null): Entry {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    titleSource: 'fallback',
    parentId,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function newDirectory(parentId: string | null, name: string): Directory {
  return {
    id: crypto.randomUUID(),
    name,
    parentId,
  };
}
