# Claude Handoff

## What was verified

- Frontend starts successfully with `npm run dev -- --host 127.0.0.1`.
- The app shell renders in a real browser.
- Browser-side text probe returned:

```text
COMPROSODY

dictation → prose

+ folder
+ entry
No entries yet. Create one to start.
✓ server connected
pace
0 wpm
energy
0%
fluency
100%
density
0%
silences as structure
false starts
fillers
cadence as guide
Select or create an entry to begin.
```

- Production frontend build passes with `npm run build`.
- Backend health check works once the server is actually running:

```json
{"ok":true}
```

## Main problems

### 1. Backend start script is unreliable in this environment

`package.json` uses:

```json
"server": "npx tsx --watch server/index.ts"
```

In this Codex environment, `tsx` is problematic because it tries to open an IPC pipe. One direct repro:

```text
Error: listen EPERM: operation not permitted /var/folders/.../tsx-501/...pipe
```

I was able to verify the backend code by temporarily compiling `server/*.ts` to JS and running that with `node`, which confirmed the Express app itself is fine.

This may be environment-specific, but if Claude sees weird `tsx` behavior, that is the reason to check first.

### 2. Ollama Cloud configuration is missing

There is no local `.env` file.

`POST /api/refine/complete` returns:

```http
HTTP/1.1 503 Service Unavailable
...
{"error":"OLLAMA_API_KEY is not configured"}
```

Required config from `.env.example`:

```dotenv
OLLAMA_API_KEY=your-ollama-api-key
PORT=3001
```

`PORT` is optional because the server defaults to `3001`.

### 3. Whisper transcription dependency is missing

This import currently fails:

```text
ModuleNotFoundError: No module named 'faster_whisper'
```

So recording can fall back to Web Speech interim/final text, but server-side Whisper transcription is not actually available until Python deps are installed.

Likely needed:

```bash
pip install faster-whisper
```

Use a venv if the repo expects one.

### 4. `/api/transcribe` error reporting is weak

Probe:

```http
POST /api/transcribe
```

Response:

```http
HTTP/1.1 500 Internal Server Error
...
{"error":"transcribe.py exited with code 1: "}
```

Root cause is probably the missing `faster_whisper` dependency, but the server loses the useful message because:

- `transcribe.py` prints JSON errors to stdout
- `server/lib/transcribe.ts` only includes `stderr` in the thrown error on non-zero exit

So Claude should consider fixing that plumbing to surface the actual Python error text.

### 5. Test run appears to hang

`npm test` did not complete cleanly during this pass. It printed:

```text
RUN  v4.1.1 /Users/milwright/Desktop/STUDIO/projects/comprosody
```

and then stalled.

`npm run build` did pass, so this looks more like a Vitest/runtime issue than a TypeScript/build issue.

## Browser/runtime requirements

- Microphone permission is required for recording.
- `useSpeechRecognition` uses `window.SpeechRecognition || window.webkitSpeechRecognition`.
- That means interim browser transcript behavior depends on Web Speech API support, but the final intended transcript path is the server-side Whisper endpoint.

## Suggested next steps for Claude

1. Create a real `.env` from `.env.example` and add `OLLAMA_API_KEY`.
2. Install Python transcription deps, starting with `faster-whisper`.
3. Improve `server/lib/transcribe.ts` so Python stdout errors are surfaced when the subprocess exits non-zero.
4. Re-run end-to-end recording/refinement after config is present.
5. Investigate why `npm test` hangs.

## Notes from this session

- I used Playwright to confirm the frontend shell really loads.
- I did **not** commit any temporary verification artifacts.
- If local startup seems inconsistent, check whether the issue is the app itself or `tsx` under the current environment.
