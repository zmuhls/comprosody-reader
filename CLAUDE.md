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
- `CORS_ORIGIN` — comma-separated CORS allowlist (default: `http://localhost:5173`)

## Architecture

### Two-process split

**Frontend** (React 19 + Vite + Tailwind CSS v4): recording UI, prosody analysis, transcript editing, refinement controls. All state client-side with localStorage persistence.

**Backend** (Express 5 + tsx): stateless API proxy. No database, no auth — just relays to OpenRouter.

### Server routes and libs

- `server/lib/claude.ts` — `streamRefinement()` (SSE generator, idle-timeout abort: 60s to first byte / 30s per chunk, accepts an external signal) and `refineComplete()` (60s timeout, throws on empty content) via OpenRouter `/chat/completions`. Direct `fetch`, no SDK. Shared `getApiKey()` and `MAX_OUTPUT_TOKENS` (8192).
- `server/lib/transcribe.ts` — `transcribe()` sends base64 audio as `input_audio` to an audio-capable model (120s timeout). Returns `{ transcript }`. `audioFormatFromContentType()` maps the request Content-Type (webm/mp4/ogg/wav) to the upstream format string.
- `server/lib/validate.ts` — hand-rolled request validation: `HttpError`, `reqObject`, `reqString`, `reqNumber`. Async route rejections flow to the global 4-arity JSON error middleware in `server/index.ts`.
- `server/routes/refine.ts` — `POST /api/refine` (SSE stream; validates before headers; client disconnect aborts upstream), `POST /api/variants` (`Promise.allSettled` → `{ variants, errors }`, 502 only when all fail)
- `server/routes/transcribe.ts` — `POST /api/transcribe` receives a raw audio buffer (25 MB cap: Content-Length pre-check plus streamed byte counting)
- `GET /api/health` — `{ status: 'ok', keyConfigured }`

### Frontend state (two contexts, both useReducer)

**AppContext** — entries (`Record<string, Entry>`), directories, `activeEntryId`, refinementSettings (genre, scale, temperature), lexicon (`Record<string, LexiconTerm>`). Entries/directories/lexicon persist to localStorage via a 300 ms trailing debounce (`createDebouncedPersist` in `src/lib/storage.ts`) with flush on `pagehide`/`visibilitychange`; settings save immediately. Any new debounced collection must also register its `flush()` in `flushAll`, or up to 300 ms of writes are lost on tab close. All savers are quota-safe. `loadEntries` normalizes legacy data (backfills `wordCount`, `recordedDurationMs`, `audioTakes`, `draftHistory`; `schemaVersion` `'2'`). `DELETE_DIRECTORY` cascades recursively (shared `collectDirectoryCascade` BFS, also used by `useStorage` to cascade IndexedDB deletes).

**RecordingContext** — `isRecording`, session (interim/final transcripts, pauses, volume samples), prosody diagnostics (`ProsodyDiagnostics`), voice config (`VoiceConfig`). Ephemeral — resets each recording. Audio itself persists durably to IndexedDB via `src/lib/audioStore.ts` (idb-keyval; one record per take, keyed `${entryId}:${recordedAt}`), surfaced by the `AudioTakes` player in the editor.

### Recording pipeline

`MainPanel` orchestrates four hooks sharing one `MediaStream`:

1. **useAudioAnalyser** — Web Audio `AnalyserNode` for waveform canvas drawing + `getTimeDomainData()` for energy measurement
2. **useMediaRecorder** — captures audio chunks into a Blob (mimeType probed: `webm;codecs=opus` → `webm` → `mp4` for Safari; 1s intervals)
3. **useSpeechRecognition** — Web Speech API for real-time interim transcript display; `getFinalTranscript()` reads a ref to avoid stale closures
4. **useProsody** — 500ms interval keyed on `isRecording`: computes pace/energy/fluency/density, dispatches `UPDATE_PROSODY`

On stop: the take is saved to IndexedDB (fire-and-forget) and the blob goes to `POST /api/transcribe`. On transcription failure the footer offers `retry upload` / `use live transcript` (Web Speech fallback) instead of silently substituting; a pending failed take's live transcript is auto-rescued if a new recording starts.

### Lexicon (transcription fidelity loop)

The app learns the user's vocabulary from their own corrections. `src/lib/lexicon.ts` holds the pure functions; nothing here is per-entry — the lexicon is global.

**Capture.** Each take records the text it contributed (`StoredRecording.transcript`). `loadTranscriptBaseline()` concatenates those in recording order; `extractCandidates()` diffs that baseline against the current `rawTranscript` with `diffWords` and keeps adjacent removed/added pairs that survive a phonetic filter — `phoneticSimilarity()` (normalized Levenshtein plus a folded consonant skeleton), a ≤3-word cap, and a ≥4-char minimum. The filter exists because the transcript pane serves two purposes a diff cannot tell apart: fixing mishearings and revising content. Survivors surface as confirm chips (`CorrectionChips`, via `useCorrectionCandidates`).

**Apply.** Two deliberately overlapping mechanisms:
- *Upstream hint* — `rankForHint()` → `encodeLexiconHint()` → base64 `X-Lexicon` header → `optHeaderStringArray()` → a `role: 'system'` message in `transcribe()`. Generalizes to word forms never explicitly taught. The header exists because `/api/transcribe` streams raw audio as its body, so there is no JSON envelope; a malformed hint decodes to `[]` rather than blocking transcription. The wire format is pinned by a literal asserted in both `src/lib/lexicon.test.ts` and `server/lib/validate.test.ts`.
- *Deterministic pass* — `applyLexicon()` runs client-side in `MainPanel`'s `ingestTranscript` before text reaches the entry. Case-sensitive and word-bounded. Two distinct safety guards: case sensitivity lets `Marc → Mark` fire without touching the common word `marc`, while `differsOnlyByCase` refuses rules like `mark → Mark` outright.

Substitutions are reported by `AutoCorrectionNotice` — the transcript no longer matches the model's output, so saying so is required. Reverting there records a misfire; `isSubstitutionActive()` stops a rule firing once `misfires >= confirmations`, which is what prevents a bad entry from rewriting every future transcript. Demoted terms still feed the upstream hint (demotion disables the blunt find/replace, not the vocabulary). `LexiconPanel` in the sidebar lists, adds (including hint-only terms with no heard form), deletes, and re-enables.

**The metric:** deterministic substitutions fire exactly where the upstream hint failed. If that count trends down as the lexicon grows, the hint works; if it stays flat, only the find/replace is carrying the feature.

### Editor features

Refined-pane textarea locks (`readOnly`) while refinement streams; `refineSelection` verifies the captured selection still matches before splicing. `entry.draftHistory` (cap 10) backs toolbar undo across full-refine/selection/variant overwrites. `DiffView` renders raw-vs-refined via `diffWords` (from `diff`). `src/lib/export.ts` provides markdown download and clipboard copy. Shortcuts: Ctrl/Cmd+Shift+Space (record), Ctrl/Cmd+Enter (refine), Ctrl/Cmd+Shift+C (copy).

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

Vitest with jsdom. Globals enabled (no imports needed for `describe`/`it`/`expect`). Tests live alongside source: `*.test.ts`, in both `src/` and `server/` (vitest include covers both). Testing library available (`@testing-library/react`, `@testing-library/jest-dom`).

## TypeScript

Strict mode. Composite project: `tsconfig.app.json` (frontend, JSX), `tsconfig.node.json` (Vite config), `server/tsconfig.json` (backend). All `noEmit: true` — tsx handles server runtime, Vite handles frontend bundling.

## Commit convention

Lowercase, short messages. Author: zmuhls.

## Known issues and pending work

See `TODO.md` for the active backlog of audit findings, bugs, and improvements. Consult it before starting work on the recording pipeline, refinement flow, or backend routes — many of the obvious-looking gaps are already tracked there.
