# comprosody

Dictation-to-prose writing tool. Record speech, analyze prosody (pace, energy, fluency, lexical density), and refine transcripts into polished prose with LLM assistance.

## Setup

```bash
npm install
cp .env.example .env
# add your OpenRouter API key to .env
```

## Configuration

All model routing goes through [OpenRouter](https://openrouter.ai). Set these in `.env`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | — | your OpenRouter key |
| `OPENROUTER_MODEL` | `moonshotai/kimi-k2-0905` | LLM for refinement |
| `OPENROUTER_TRANSCRIBE_MODEL` | `google/gemini-2.5-flash` | audio transcription |
| `PORT` | `3001` | backend server port |

## Running

```bash
# terminal 1: vite dev server (frontend)
npm run dev

# terminal 2: express backend
npm run server
```

Frontend at `http://localhost:5173`, backend at `http://localhost:3001`.

The backend script runs without file watching so it starts reliably across environments. If you change code under `server/`, restart `npm run server`.

## How it works

1. **Record** — click the record button, speak. Web Speech API provides real-time interim text while you talk. Prosody diagnostics (pace, energy, fluency, density) update live.
2. **Transcribe** — on stop, audio is sent to OpenRouter (Gemini Flash) for transcription. Falls back to Web Speech API if that fails.
3. **Refine** — choose a genre (academic, narrative, analytical, field-journal, freewrite), a scale (word through paragraph), and a temperature. Hit refine. The LLM rewrites your transcript into prose, informed by your prosody readings and voice config.
4. **Variants** — generate cool/warm/hot variants at different temperatures and pick the one you like.

## Voice config

Accessible via the gear icon in the recording strip:

- **Silences as structure** — long pauses become paragraph breaks
- **False starts** — preserve or collapse self-corrections
- **Fillers** — keep or remove um/uh/like
- **Cadence as guide** — mirror speaking rhythm in sentence length

## Architecture

```
src/                    # React frontend (Vite + Tailwind v4)
  components/
    dictation/          # RecordButton, Waveform, ProsodyPanel, VoiceConfigToggles
    editor/             # Editor, Toolbar, TranscriptView, VariantCards
    layout/             # Sidebar, MainPanel
    sidebar/            # DirectoryTree, EntryActions, TreeNode
  context/              # AppContext (entries/dirs), RecordingContext (session state)
  hooks/                # useAudioAnalyser, useMediaRecorder, useProsody, etc.
  lib/                  # comprosody (prosody math), prompts (system prompt builder), claude (API client)

server/                 # Express backend
  lib/claude.ts         # OpenRouter chat completions (streaming + complete)
  lib/transcribe.ts     # OpenRouter audio transcription
  routes/refine.ts      # /api/refine, /api/refine/complete, /api/variants
  routes/transcribe.ts  # /api/transcribe
```

## Tests

```bash
npm test
```
