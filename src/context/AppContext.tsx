import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
  type Dispatch,
} from 'react';
import type { Entry, Directory } from '../types/editor';
import type { RefinementSettings } from '../types/llm';
import { defaultVoiceConfig, defaultProsody } from '../types/audio';
import {
  loadEntries,
  saveEntries,
  loadDirectories,
  saveDirectories,
} from '../lib/storage';

export interface AppState {
  entries: Record<string, Entry>;
  directories: Record<string, Directory>;
  activeEntryId: string | null;
  refinementSettings: RefinementSettings;
}

export type AppAction =
  | { type: 'SET_ACTIVE_ENTRY'; id: string | null }
  | { type: 'CREATE_ENTRY'; entry: Entry }
  | { type: 'UPDATE_ENTRY'; id: string; updates: Partial<Entry> }
  | { type: 'DELETE_ENTRY'; id: string }
  | { type: 'CREATE_DIRECTORY'; directory: Directory }
  | { type: 'RENAME_DIRECTORY'; id: string; name: string }
  | { type: 'DELETE_DIRECTORY'; id: string }
  | { type: 'UPDATE_REFINEMENT_SETTINGS'; settings: Partial<RefinementSettings> }
  | { type: 'RENAME_ENTRY'; id: string; name: string };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_ENTRY':
      return { ...state, activeEntryId: action.id };

    case 'CREATE_ENTRY':
      return {
        ...state,
        entries: { ...state.entries, [action.entry.id]: action.entry },
        activeEntryId: action.entry.id,
      };

    case 'UPDATE_ENTRY': {
      const existing = state.entries[action.id];
      if (!existing) return state;
      return {
        ...state,
        entries: {
          ...state.entries,
          [action.id]: { ...existing, ...action.updates, updatedAt: Date.now() },
        },
      };
    }

    case 'DELETE_ENTRY': {
      const { [action.id]: _, ...rest } = state.entries;
      return {
        ...state,
        entries: rest,
        activeEntryId: state.activeEntryId === action.id ? null : state.activeEntryId,
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
      const { [action.id]: _, ...restDirs } = state.directories;
      // Also delete entries in this directory
      const restEntries: Record<string, Entry> = {};
      for (const [id, entry] of Object.entries(state.entries)) {
        if (entry.parentId !== action.id) restEntries[id] = entry;
      }
      return {
        ...state,
        directories: restDirs,
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

    default:
      return state;
  }
}

function createInitialState(): AppState {
  return {
    entries: loadEntries(),
    directories: loadDirectories(),
    activeEntryId: null,
    refinementSettings: {
      genre: 'freewrite',
      scale: 'sentence',
      temperature: 0.5,
    },
  };
}

const AppContext = createContext<{
  state: AppState;
  dispatch: Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, null, createInitialState);

  // Persist entries to localStorage on change
  useEffect(() => {
    saveEntries(state.entries);
  }, [state.entries]);

  // Persist directories to localStorage on change
  useEffect(() => {
    saveDirectories(state.directories);
  }, [state.directories]);

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

export function newEntry(parentId: string | null): Entry {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    parentId,
    rawTranscript: '',
    refinedText: '',
    prosody: defaultProsody,
    voiceConfig: defaultVoiceConfig,
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
