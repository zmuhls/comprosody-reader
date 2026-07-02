# comprosody TODO

Generated from LLM-as-a-judge review. Critical issues (🔴) have been fixed;
remaining issues are organized by severity below.

## Already Fixed (since review)

- [x] Model identifier updated to `claude-sonnet-4-20250514` (was `claude-3-7-sonnet-20250219`)
- [x] Production server script added (`npm run server:prod`)
- [x] localStorage writes debounced (500ms via `useDebouncedSaver`)
- [x] WhisperModel loaded once via persistent worker (`whisperWorker.ts` / `whisper_worker.py`)
- [x] Recursive directory deletion (`collectDescendantDirectoryIds` cleans children + entries)
- [x] Simple shared-secret auth (`COMPROSODY_API_KEY` env var, enforced in production)
- [x] CORS restricted to allowed origins (`ALLOWED_ORIGINS` env var)
- [x] Request validation on `/refine`, `/refine/complete`, `/variants`
- [x] Abort/cleanup on client disconnect for streaming routes
- [x] Audio size limit (50 MB) on `/transcribe`
- [x] `requirements.txt` exists with `faster-whisper>=1.1.0`
- [x] Error dispatch via `SET_ERROR` in `AppContext` + `ErrorBanner` component displays errors in UI
- [x] `dist/` is gitignored and not tracked in git

## High Priority — All Fixed

- [x] Surface transcription/refinement errors in the UI (`ErrorBanner` component + `SET_ERROR` dispatch)
- [x] Add undo/history for refinement (`recordHistory: true` on final commit after streaming)
- [x] Rate limiting on API routes (in-memory per-IP limiter, 60 req/min)
- [x] Fix 500ms re-render during recording (`useProsody` uses local `liveProsody` state, only dispatches `FINALIZE_PROSODY` on stop)
- [x] Fix per-token re-render during streaming (`useRefinement` uses local `streamingText` state, single dispatch on completion)
- [x] Consolidate `useRefinement` to single instance (called once in `Editor`, props passed to `Toolbar`)
- [x] `refineComplete` uses `messages.create()` instead of `stream().finalMessage()` (no streaming overhead)
- [x] `/api/variants` runs sequentially instead of `Promise.all` (avoids 3x rate-limit exposure)

## Medium Priority

- [ ] Prosody metrics not recomputed after manual transcript edits
      `src/lib/comprosody.ts` only used in `useProsody.ts` during recording
- [ ] `computeFluency` can exceed 1.0 if pauses overlap or start before `startedAt`
      `src/lib/comprosody.ts:51-58`
- [ ] `computeEnergy` scaling (`rms * 3`) saturates at 1 for typical speech, losing dynamic range
      `src/lib/comprosody.ts:41-49`
- [ ] `interpretPace` boundary labels are brittle (1 WPM difference flips LLM instruction)
      `src/lib/comprosody.ts:67-73`, `src/lib/prompts.ts`
- [ ] Selection refine context extraction splits on `/[.!?]\s/` — breaks on `Dr.`, `e.g.`, decimals
      `src/hooks/useRefinement.ts:82-85`
- [ ] `RecordingContext` session includes `audioBlob` but never persisted (lost on refresh)
      `src/types/audio.ts`, `src/hooks/useTranscription.ts`
- [ ] `useSpeechRecognition` restart loop on `onend` if `shouldRestartRef.current` is true
      May spin-crash loop on genuine API errors
      `src/hooks/useSpeechRecognition.ts:71-78`
- [ ] `activeEntry` lookup duplicated everywhere — extract to a `useActiveEntry` hook
      `src/hooks/useRefinement.ts:19-21`, `src/components/editor/Editor.tsx:19-21`, etc.
- [ ] Prompt cache `ephemeral` with no cache-breaker strategy or measurement
      `server/lib/claude.ts:48-53`
- [ ] No accessibility labels on toggles/buttons
      `src/components/dictation/VoiceConfigToggles.tsx`, `src/components/editor/Toolbar.tsx`
- [ ] UI is not responsive — fixed sidebar width, two-pane split, tiny `text-[9px]`
      `src/components/layout/Sidebar.tsx`, `src/components/editor/Editor.tsx`
- [ ] No empty-state guidance for new users
      `src/components/editor/Editor.tsx:50-56`
- [ ] `SET_TRANSCRIPT` clears word timestamps mid-flow
      `src/context/RecordingContext.tsx`
- [ ] `RecordButton` derives `isRecording` from speech hook, not recording context
      `src/components/layout/MainPanel.tsx`
- [ ] `Sidebar` health check fires once, never refreshes
      `src/components/layout/Sidebar.tsx:12-17`
- [ ] Transcription error plumbing loses Python stdout (only surfaces stderr)
      `server/lib/transcribe.ts` — though whisperWorker now reads stdout JSON
- [ ] `tsconfig.node.json` only includes `vite.config.ts`
      `eslint.config.js` not type-checked

## Low Priority

- [ ] `README.md` is still the Vite template — needs real onboarding/architecture docs
- [ ] `Waveform` starts new rAF loop on every `isRecording` change
      `src/components/dictation/Waveform.tsx:11-15`
- [ ] `VariantCards` truncates at 300 chars with hardcoded ellipsis
      `src/components/editor/VariantCards.tsx:44-45`
- [ ] Health check doesn't verify downstream deps (Anthropic/Whisper)
      `server/index.ts:50-52`
- [ ] `VoiceConfigToggles` uses inline object dispatch (harmless but creates new refs)
      `src/components/dictation/VoiceConfigToggles.tsx:14-16`
- [ ] Pre-existing TS error: `whisperWorker.ts:28` unused `ready` field
      Either use it (gate `transcribe()` calls) or remove it
- [ ] `tempfile` path prefix is predictable (`/tmp/comprosody-${uuid}.webm`)
      Minor symlink race risk on shared `/tmp`
- [ ] `express.json({ limit: '10mb' })` but `/transcribe` is raw binary — inconsistent
      `server/index.ts:45`