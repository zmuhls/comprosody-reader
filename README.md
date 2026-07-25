# Cadence

Cadence is a transcription-first, local-first notes workspace for turning spoken thought into editable prose. It combines a quiet, Typora-inspired writing surface with a directory tree, live dictation, selectable transcription providers, a device-local vocabulary and prosody profile, and conservative AI refinement.

The repository retains the historical package name `comprosody`; the application name is Cadence.

## What is implemented

- A responsive directory-and-note workspace with a large, distraction-light editor.
- A [Tiptap](https://tiptap.dev/)/ProseMirror editor that stores Markdown, keeps the source transcript separately, and exports `.md` files.
- Microphone capture, a compact live waveform, and word-timestamped transcription without an undisclosed browser speech-recognition service.
- A transcription provider boundary with local [faster-whisper](https://github.com/SYSTRAN/faster-whisper) as the default and ElevenLabs Scribe v2 as an opt-in cloud provider.
- Device-local vocabulary learning and rolling/lifetime prosody summaries for pace, energy, fluency, and lexical density.
- Vocabulary and phrase hints fed back into local Whisper hotwords or ElevenLabs keyterms.
- A default high-fidelity refinement pass for humanities prose, a small focused-instruction field, selection-only refinement, automatic refinement after dictation, and a separate full-overhaul mode.
- Local note search and commands with `Cmd/Ctrl+K`; `Cmd/Ctrl+N` creates a note.
- IndexedDB persistence through Dexie, with a compatibility backup and one-time migration from the earlier localStorage schema.

Scholarship search is deliberately **not implemented yet**. The slim search rail is a labeled placeholder for a later, separately permissioned module; see [Architecture and roadmap](docs/ARCHITECTURE.md).

## Quick start

Prerequisites: a current Node.js LTS release, npm, Python 3, and a browser with microphone support. Local transcription and note editing run without cloud credentials. Add an Ollama Cloud key only when you want AI refinement.

```bash
npm install

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

cp .env.example .env
```

To enable refinement, edit `.env` and set its server-side credential:

```dotenv
OLLAMA_API_KEY=your-ollama-api-key
# Optional non-secret overrides:
# OLLAMA_MODEL=qwen3.5:397b
# OLLAMA_BASE_URL=https://ollama.com
```

Never put service keys in frontend code, commit `.env`, or paste keys into notes. All supported service credentials are read by the Express server.

Start the API and frontend in separate terminals, with the Python environment active in the API terminal:

```bash
# terminal 1
source .venv/bin/activate
npm run server
```

```bash
# terminal 2
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`), create a note, allow microphone access, and use the provider control beside the record button. Vite proxies `/api` to `http://127.0.0.1:3001`.

The first local transcription can take longer while faster-whisper downloads and loads the selected model. The current local default is `base`.

## Transcription providers

### Local faster-whisper (default)

No transcription credential is required. Audio is sent from the browser to the Cadence server running on the same machine. The server writes a temporary WebM file, sends it to a persistent Python worker, and removes the file after success, failure, or timeout. The worker uses word timestamps, voice-activity detection, and locally learned vocabulary as hotwords.

Supported model names are `tiny`, `base`, `small`, `medium`, `large-v1`, `large-v2`, `large-v3`, `large-v3-turbo`, and `turbo`. Set `FASTER_WHISPER_MODEL=large-v3-turbo` for the strongest local quality starting point your machine can comfortably run; the conservative default remains `base` until the user's hardware and corpus are benchmarked. A request can also specify `?model=...`.

### ElevenLabs Scribe v2 (opt-in cloud upload)

Add the key only to `.env` on the server:

```dotenv
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_SCRIBE_MODEL=scribe_v2
```

Selecting ElevenLabs sends the recording and selected learned keyterms to ElevenLabs. The key never enters the browser bundle. Cadence normalizes the cloud response into the same transcript, language, duration, and word-timestamp shape used by the local provider.

`TRANSCRIPTION_PROVIDER=local` controls the server fallback for requests that omit a provider. The current browser explicitly sends the provider selected in the recording dock and remembers that choice on the device.

To add another provider, implement the small `TranscriptionProvider` interface in `server/lib/transcription/`, normalize its result, and register it in `server/lib/transcribe.ts`. The HTTP route and editor do not need provider-specific response handling.

## Refinement behavior

The default settings are academic register, sentence scale, temperature `0.2`, faithful mode, high fidelity on, and automatic refinement on. The faithful prompt is designed to:

- join adjacent fragments and make obvious transcription/copy edits;
- add only enough connective tissue for continuous prose;
- preserve characteristic vocabulary, ambiguity, hesitation, and provisional claims when meaningful; and
- prohibit invented facts, citations, arguments, examples, or theoretical vocabulary.

Focused instructions apply to the current selection when text is selected and to the whole note otherwise. Full overhaul may reorder and consolidate passages around an intermittently recurring idea, but it retains the same factuality and voice-preservation constraints. Refinement streams from the server and records the completed edit in note history.

Refinement uses Ollama Cloud's native chat API through a server-only adapter. The default direct-API model is `qwen3.5:397b`; `OLLAMA_MODEL` and `OLLAMA_BASE_URL` are validated server-side overrides. Streaming responses are accepted only after Ollama emits `done: true`, so an interrupted response cannot silently replace a note with partial prose. The provider boundary remains separate from transcription so a later fully local adapter can replace it without changing the editor.

## Local data and privacy

Cadence uses the IndexedDB database `cadence-notes` as its canonical browser store:

- `entries`: note title, source transcript, edited Markdown, per-entry prosody, and timestamps;
- `directories`: the note tree;
- `voiceProfiles`: the derived device-local profile; and
- `meta`: migration markers.

On the first run of this version, an empty IndexedDB store imports existing `comprosody:entries` and `comprosody:directories` localStorage data in one transaction, then writes a marker so the import is not repeated. Debounced localStorage copies remain as a compatibility fallback. Refinement settings, the voice-profile copy, and the selected transcription provider also remain device-local.

The voice profile is a bounded personalization profile, **not a biometric identity system or secure voiceprint**. It is deterministically rebuilt from source transcripts and a maximum of 50 derived prosody observations per note; it does not retain raw audio or use refined model output as training data. Current limits retain up to 2,048 ranked terms, 1,024 two/three-word phrases, and a 20-session rolling prosody window.

Privacy depends on the operation:

- Local transcription keeps audio and vocabulary hints on the machine running the browser and server.
- ElevenLabs transcription uploads audio and selected vocabulary hints to ElevenLabs.
- Ollama Cloud refinement sends the active note text, focused instruction, only learned terms already present in that request, and the active entry's derived prosody guidance to the configured Ollama host.
- Cadence does not persist raw microphone audio in IndexedDB, localStorage, or recording-session state after transcription.

For sensitive material, run Cadence on a machine you control, choose Private
Whisper, and do not invoke cloud-backed refinement. In the hosted Readings
deployment, Private Whisper sends audio to the private Cadence Railway service;
it is not on-device transcription. A fully local refinement provider remains
roadmap work.

## Commands

```bash
npm run dev          # Vite development server
npm run server       # Express API with TypeScript watch mode
npm run server:prod  # Express API without watch mode
npm run build        # Type-check and production frontend build
npm run preview      # Preview the production frontend build
npm run lint         # ESLint
npm test             # Browser-side and server-side Vitest suites
npm run test:server  # Server tests only
npm run test:watch   # Browser-side tests in watch mode
npm run diagnostic   # Prosody pipeline diagnostic
```

The API exposes `GET /api/health`, `POST /api/transcribe`, streaming `POST /api/refine`, `POST /api/refine/complete`, and `POST /api/variants`. Transcription accepts raw audio up to 50 MB. Learned terms travel in a bounded request header rather than the URL. The server binds to `127.0.0.1` by default; a non-loopback `HOST` is refused unless `COMPROSODY_API_KEY` is configured. API routes also have a simple in-memory per-IP rate limit and configurable CORS origins.

## Open-source building blocks

Cadence favors focused, maintained components over custom infrastructure:

- React, TypeScript, Vite, and Tailwind CSS for the client shell.
- Tiptap/ProseMirror and Tiptap Markdown for editing and serialization.
- Dexie for IndexedDB transactions and schema evolution.
- Radix UI for accessible menus, tooltips, and switches.
- cmdk and MiniSearch for the command palette and in-browser note search.
- Express for the narrow server boundary.
- faster-whisper/CTranslate2 for local speech-to-text.
- Vitest and Testing Library for regression coverage.

This is reuse with boundaries: each external engine sits behind a small local adapter, while Cadence owns the note schema, privacy rules, prompts, and provider-neutral result types. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the component map, extension points, and staged roadmap.
