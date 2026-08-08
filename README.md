# Comprosody

Voice-first writing tool — an agentic reader for vocal composition. Record speech, watch prosody diagnostics (pace, energy, fluency, lexical density) track your delivery live, then refine the transcript into prose shaped by how you actually spoke. Work collects into a library of books, chapters, and notes; the app learns your vocabulary from your own corrections.

## Setup

```bash
npm install
cp .env.example .env
# add only the server-side provider credentials you intend to use
```

## Configuration

Provider credentials stay on the server. The integrated workspace supports local
transcription, ElevenLabs Scribe and timed speech, and Ollama refinement. Set
only the routes you use in `.env`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_API_KEY` | — | Ollama refinement key |
| `OLLAMA_MODEL` | `qwen3.5:397b` | Ollama refinement model |
| `ELEVENLABS_API_KEY` | — | Scribe and timed read-aloud |
| `TRANSCRIPTION_PROVIDER` | `local` | server transcription fallback |
| `COMPROSODY_API_KEY` | — | required for non-loopback or production API access |
| `CORS_ORIGIN` | `http://localhost:5173` | comma-separated CORS allowlist |
| `PORT` | `3001` | backend server port |

## Running

```bash
# terminal 1: vite dev server (frontend)
npm run dev

# terminal 2: express backend (tsx --watch, auto-reloads on change)
npm run server
```

Frontend at `http://localhost:5173`, backend at `http://localhost:3001`. Vite proxies `/api` to the backend.

## How it works

1. **Record** — the seal button in the footer (or Ctrl/Cmd+Shift+Space). Web Speech API shows interim text while you talk; prosody readings update every half second; the breath-line waveform mirrors the mic. `+ note` in the footer records a vocal note attached to the open entry.
2. **Transcribe** — on stop, the take persists to IndexedDB and follows the selected local or cloud provider boundary, with bounded vocabulary hints where supported. If transcription fails you choose: retry the upload or keep the live transcript.
3. **Refine** — pick a register (academic, narrative, analytical, field-journal, freewrite), a scale (word through paragraph), and reach. The system prompt composes those with your prosody readings, voice config, and any margin notes marked for inclusion. Refinement streams through the configured server adapter; select a passage and refine just the selection.
4. **Passes** — generate cool/warm/hot passes at different reach. Each pass previews as a diff over the draft; accept it, save it as an attached note, or append it as a new chapter.

## Library

The sidebar tree holds folders and books of writing entries and notes. Drag rows to move them (or use the `⋯` row menu); promote a folder to a book to freeze its order as chapters; page between sibling chapters with `[` / `]` or a swipe. Drop a note onto a writing entry to pin it — pinned notes appear as margin notes beside the draft and can travel into the refinement context.

## Lexicon

When you correct a mishearing in the transcript pane, a confirm chip proposes the pair (a phonetic filter keeps content edits out). Confirmed terms feed two mechanisms: an upstream vocabulary hint on every transcription, and a deterministic find/replace on arriving text. Substitutions are reported in the editor; reverting one demotes the rule so a bad entry can't rewrite future transcripts. Manage terms in the sidebar's lexicon panel.

## Voice config

The `voice` button in the footer:

- **Silences as structure** — long pauses become paragraph breaks
- **False starts** — preserve or collapse self-corrections
- **Fillers** — keep or remove um/uh/like
- **Cadence as guide** — mirror speaking rhythm in sentence length

## Architecture

```
src/                    # React frontend (Vite + Tailwind v4)
  components/
    dictation/          # RecordButton, Waveform, RecordingFooter, VoiceConfigToggles
    editor/             # Editor, Toolbar, SettingsRail, PassesBar, DiffView,
                        # MarginNotes, AudioTakes, CorrectionChips
    layout/             # Sidebar, MainPanel
    sidebar/            # DirectoryTree, TreeNode, RowMenu, LexiconPanel, dnd
  context/              # AppContext (entries/dirs/lexicon), RecordingContext (session)
  hooks/                # useMediaRecorder, useSpeechRecognition, useProsody,
                        # useAppViewportHeight, useSwipePaging, ...
  lib/                  # comprosody (prosody math), prompts (system prompt builder),
                        # lexicon, refineContext, audioStore, storage, export

server/                 # Express backend — stateless provider gateway
  lib/ollama.ts         # Ollama streaming and complete refinement
  lib/transcribe.ts     # provider-neutral audio transcription
  lib/validate.ts       # request validation
  routes/refine.ts      # /api/refine, complete titles, and variants
  routes/speech.ts      # bounded ElevenLabs speech and timed alignment
  routes/transcribe.ts  # /api/transcribe (raw audio body, 50 MB cap)
```

State lives client-side: entries, library structure, and lexicon in localStorage (debounced writes); audio takes in IndexedDB with lazy, metadata-first hydration. The backend keeps nothing.

Works on phones: the layout tracks the visual viewport, keeps the microphone in
its own touch-sized dock, and scrolls focused writing controls above the on-screen
keyboard. A selectable background-recording window finalizes on return or at its
hard cutoff; iOS may still suspend browser execution while another app is active.

The hosted Readings deployment mounts Comprosody at `/studio` behind the same
authenticated session and injects its service credential only at the private
server gateway.

## Tests

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```
