# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # vite dev server (frontend, port 5173)
npm run server       # express backend (port 3001, tsx --watch for auto-reload)
npm run build        # tsc -b && vite build
npm run lint         # eslint
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run diagnostic   # npx tsx scripts/prosody-pipeline-diagnostic.ts
```

Both `dev` and `server` must run simultaneously. Vite proxies `/api` to `localhost:3001`.

## Configuration

All model calls route through OpenRouter (OpenAI-compatible API, no vendor SDKs). Set in `.env`:

- `OPENROUTER_API_KEY` — required
- `OPENROUTER_MODEL` — refinement LLM (default: `moonshotai/kimi-k2-0905`)
- `OPENROUTER_TRANSCRIBE_MODEL` — audio transcription (default: `google/gemini-2.5-flash`)

## Architecture

### Two-process split

**Frontend** (React 19 + Vite + Tailwind CSS v4): recording UI, prosody analysis, transcript editing, refinement controls. All state client-side with localStorage persistence.

**Backend** (Express 5 + tsx): stateless API proxy. No database, no auth — just relays to OpenRouter.

### Server routes and libs

- `server/lib/claude.ts` — `streamRefinement()` (SSE generator) and `refineComplete()` via OpenRouter `/chat/completions`. Both use direct `fetch`, no SDK.
- `server/lib/transcribe.ts` — `transcribe()` sends base64-encoded webm audio as `input_audio` content type to an audio-capable model. Returns transcript text (no word-level timestamps).
- `server/routes/refine.ts` — `POST /api/refine` (SSE stream), `POST /api/refine/complete`, `POST /api/variants` (3 temperatures in parallel)
- `server/routes/transcribe.ts` — `POST /api/transcribe` receives raw audio buffer

### Frontend state (two contexts, both useReducer)

**AppContext** — entries (`Record<string, Entry>`), directories, `activeEntryId`, refinementSettings (genre, scale, temperature). Persisted to localStorage via `src/lib/storage.ts` on every reducer dispatch.

**RecordingContext** — `isRecording`, session (interim/final transcripts, word timestamps, pauses, volume samples, audioBlob), prosody diagnostics (`ProsodyDiagnostics`), voice config (`VoiceConfig`). Ephemeral — resets each recording.

### Recording pipeline

`MainPanel` orchestrates four hooks sharing one `MediaStream`:

1. **useAudioAnalyser** — Web Audio `AnalyserNode` for waveform canvas drawing + `getTimeDomainData()` for energy measurement
2. **useMediaRecorder** — captures audio chunks into a Blob (webm/opus, 1s intervals)
3. **useSpeechRecognition** — Web Speech API for real-time interim transcript display (fallback if server transcription fails)
4. **useProsody** — runs every 500ms: computes pace/energy/fluency/density from the above, dispatches `UPDATE_PROSODY`

On stop: audio blob → `POST /api/transcribe` (OpenRouter Gemini Flash via `input_audio`) → on failure falls back to Web Speech API `finalTranscript`.

### Prompt composition system

`src/lib/prompts.ts` builds the refinement system prompt from four dimensions:

- **Genre** (5 registers: academic/narrative/analytical/field-journal/freewrite) → defines editorial voice in a preamble paragraph
- **Scale** (word/phrase/clause/sentence/paragraph) → constrains scope of edits
- **Prosody readings** → each metric (pace, energy, fluency, density) is mapped through `interpret*()` to a human label, then to an implication sentence from a lookup table (e.g., "slow, deliberate" → "preserve complex syntactic structures")
- **Voice config** (4 booleans) → structural rules: silences-as-paragraphs, preserve-false-starts, preserve-fillers, mirror-cadence
- **Transition guidance** — dynamically generated rules for smoothing oral-to-written artifacts, conditioned on fluency level

These compose into a single system prompt. Raw transcript goes as user message. Selection refinement adds `[START]`/`[END]` markers with surrounding context.

### Prosody math

`src/lib/comprosody.ts` — pure functions: `computeWpm` (words/elapsed), `computeEnergy` (RMS from analyser byte data, ×3 scaling, clamped to \[0,1\]), `computeFluency` (1 − pause ratio), `computeLexicalDensity` (content words / total using a 100+ word function-word set). Each has an `interpret*()` function mapping to human labels at fixed thresholds.

The `scripts/prosody-pipeline-diagnostic.ts` exercises these with synthetic archetypes and reports on lexical density precision, energy scaling, prompt token budgets, signal discrimination, and boundary sensitivity.

### Design system

Tailwind v4 `@theme` in `src/index.css`. Warm amber-on-charcoal palette. Three font stacks via CSS custom properties:
- `--font-brand` (EB Garamond) — logo/headings, used via `.font-brand`
- `--font-writing` (Crimson Pro) — text areas, also set as default `textarea` font
- `--font-ui` (JetBrains Mono) — UI labels, body default

Color tokens follow `--color-{name}` convention mapping to Tailwind utilities (`bg-surface`, `text-accent`, `border-border`, etc.). Recording state uses `.recording-active` CSS class for ambient glow animation.

## Testing

Vitest with jsdom. Globals enabled (no imports needed for `describe`/`it`/`expect`). Tests live alongside source: `*.test.ts`. Testing library available (`@testing-library/react`, `@testing-library/jest-dom`).

## TypeScript

Strict mode. Composite project: `tsconfig.app.json` (frontend, JSX), `tsconfig.node.json` (Vite config), `server/tsconfig.json` (backend). All `noEmit: true` — tsx handles server runtime, Vite handles frontend bundling.

## Commit convention

Lowercase, short messages. Author: zmuhls.

## Known issues and pending work

See `TODO.md` for the active backlog of audit findings, bugs, and improvements. Consult it before starting work on the recording pipeline, refinement flow, or backend routes — many of the obvious-looking gaps are already tracked there.
