# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Comprosody — oral dictation to refined prose. Records speech, transcribes via faster-whisper with word-level timestamps, computes prosody metrics (pace, energy, fluency, lexical density), then refines the transcript through Ollama Cloud with genre-aware, prosody-informed system prompts.

## Commands

```bash
npm run dev          # Vite dev server (frontend, port 5173)
npm run server       # Express backend with tsx --watch (port 3001)
npm run build        # tsc -b && vite build
npm run lint         # eslint
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
npm run diagnostic   # prosody pipeline diagnostic script
```

Run a single test file: `npx vitest run src/lib/comprosody.test.ts`

Both `dev` and `server` must run simultaneously. The Vite dev server proxies `/api/*` to `localhost:3001`.

Cloud refinement requires the server-only `OLLAMA_API_KEY` in a `.env` file (see `.env.example`). Whisper transcription requires `pip install faster-whisper`.

## Architecture

### Two-process model
- **Frontend** (React 19 + Vite + Tailwind 4): SPA with recording UI, prosody display, split-pane editor
- **Backend** (Express + tsx): proxies Ollama Cloud calls (no API key in browser), runs faster-whisper transcription via Python subprocess

### Data flow
```
Record → [MediaRecorder + AudioAnalyser + Web Speech API (interim)]
  → Stop → audio blob POST /api/transcribe
  → faster-whisper returns {transcript, words: [{word, start, end}]}
  → User clicks Refine → buildSystemPrompt(genre, prosody, voiceConfig)
  → POST /api/refine (SSE streaming) → Ollama Cloud native chat API
  → Streamed refined text displayed in editor
```

### State management
Two React contexts (useReducer, no external state library):
- **AppContext** (`src/context/AppContext.tsx`): entries, directories, activeEntryId, refinementSettings. Persisted to localStorage.
- **RecordingContext** (`src/context/RecordingContext.tsx`): isRecording, session (transcripts, wordTimestamps, pauses, volumeSamples, audioBlob), prosody, voiceConfig. Ephemeral (not persisted).

### Key modules
- `src/lib/comprosody.ts` — prosody computation (WPM, energy RMS, fluency, lexical density) + interpretation labels
- `src/lib/prompts.ts` — builds genre/scale/prosody/voiceConfig-aware system prompts
- `src/lib/refinementApi.ts` — client-side fetch wrappers for `/api/refine` (SSE), `/api/refine/complete`, `/api/variants`
- `server/lib/ollama.ts` — server-side Ollama native chat adapter with NDJSON streaming and strict completion checks
- `server/lib/transcribe.ts` — spawns `python3 server/scripts/transcribe.py` with audio file, parses JSON output

### Recording flow
`MainPanel.tsx` orchestrates: a single `getUserMedia` stream is shared by MediaRecorder (audio capture), AudioAnalyser (waveform + energy), and Web Speech API (interim transcript display). On stop, the audio blob goes to Whisper for final transcription. Web Speech API is fallback if Whisper fails.

### Refinement
Three modes in `useRefinement.ts`: full-document streaming refinement, selection refinement (extracts 1 sentence context before/after), and parallel variant generation (3 temperatures: 0.2, 0.5, 0.9).

## Conventions

- Commit messages: short, lowercase, no sign-off
- TypeScript strict mode, ES2023 target
- Tests use vitest with jsdom environment, co-located as `*.test.ts` next to source
- Storage keys prefixed with `comprosody:` (in `src/constants.ts`)
- `Uint8Array<ArrayBuffer>` (not bare `Uint8Array`) for Web Audio API data to satisfy TS 5.9 strict typing
