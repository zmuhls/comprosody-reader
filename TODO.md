# TODO

Audit findings from 2026-04-10. The app is functionally wired up end-to-end — recording, transcription, refinement, and variants all work. Items below are improvements, not blockers, unless flagged otherwise.

## Critical

- [ ] **Selection refinement can corrupt text** — `src/hooks/useRefinement.ts` `refineSelection` captures `selectionStart`/`selectionEnd` at call time but the textarea stays editable during the async API call. If the user types during refinement, the splice lands at the wrong position. Fix: lock the textarea (`readOnly`) while the selection refinement is in flight, or re-find the original substring before splicing.
- [ ] **No timeouts on upstream `fetch` calls** — `server/lib/claude.ts` and `server/lib/transcribe.ts` call OpenRouter with no timeout. A hung connection holds the Express response open indefinitely. Add `AbortController` with a sane timeout (e.g. 60s for refine, 120s for transcribe).
- [ ] **No input validation on backend routes** — all three refine endpoints and `/api/transcribe` pass body fields straight to upstream calls. Missing/wrong-type fields produce opaque OpenRouter errors instead of helpful 400s. Add a small validator (zod or hand-rolled) at each route.
- [ ] **`/api/variants` is fail-fast** — `server/routes/refine.ts` uses `Promise.all`, so one failed variant call discards all completed variants. Switch to `Promise.allSettled` and return partial results.

## High

- [ ] **`refineComplete` is dead code** — `src/lib/claude.ts` exports `refineComplete()` calling `POST /api/refine/complete`. Nothing imports it. Either wire it into a UI affordance or delete both the client function and the server route.
- [ ] **Word timestamps pipeline is inert** — `server/lib/transcribe.ts` hardcodes `words: []`, `duration: 0`, `language: 'en'`. The frontend loop in `src/hooks/useTranscription.ts:46-52` that would dispatch `ADD_WORD_TIMESTAMP` never runs. Either make the transcribe model return word-level timing (and parse it) or remove the dead dispatch and the `wordTimestamps` field from `RecordingSession`.
- [ ] **VoiceConfigToggles label click dead zone** — `src/components/dictation/VoiceConfigToggles.tsx` `Toggle` subcomponent: the `<label>` wraps no `<input>` and has no `htmlFor`, so clicking the text label does nothing — only the small toggle square is clickable. Fix: move the `onClick` to the outer `label`, or convert to a real `<input type="checkbox">` with `htmlFor`.
- [ ] **`@anthropic-ai/sdk` is an unused dependency** — listed in `package.json` but never imported. Remove it.
- [ ] **No global JSON error handler on Express** — `server/index.ts` has no `app.use((err, req, res, next) => ...)`. Express 5's default handler returns HTML, which breaks JSON-expecting clients. Add a JSON error middleware.

## Medium

- [ ] **`SET_AUDIO_BLOB` dispatch is dead** — `src/hooks/useTranscription.ts:55` stores the blob in `RecordingContext.session.audioBlob` but nothing reads it. Remove the dispatch and the field, or wire up a "play back recording" affordance.
- [ ] **Stale-closure fallback may lose final phrase** — when `/api/transcribe` fails and we fall back to Web Speech API, `recState.session.finalTranscript` may be missing the last phrase due to React's batched state update after `speech.stop()`. Capture `finalTranscript` via a ref synced in `useSpeechRecognition`.
- [ ] **`OPENROUTER_TRANSCRIBE_MODEL` missing from `.env.example`** — used in `server/lib/transcribe.ts` but undocumented for new contributors.
- [ ] **No size limit on raw audio uploads** — `/api/transcribe` reads the body stream with no cap. The global `express.json({ limit: '10mb' })` doesn't apply to non-JSON bodies. Add an explicit byte limit.
- [ ] **`max_tokens: 64000` in `streamRefinement`** — exceeds most model context windows. OpenRouter silently clamps for some models, errors for others. Lower to a realistic value (e.g. 8192).
- [ ] **Empty content silently returns 200** — `refineComplete` and per-variant calls in `server/lib/claude.ts` use `?? ''`, so an empty upstream response looks like a successful empty result. Surface this as an error.

## Low

- [ ] **No localStorage write debounce** — `src/context/AppContext.tsx` persists the entire entries map on every keystroke. Add a 200–500ms debounce.
- [ ] **`generateVariants` missing `dispatch` in deps** — `src/hooks/useRefinement.ts:160`. `dispatch` is stable from `useReducer` so no runtime bug, but it violates `react-hooks/exhaustive-deps`.
- [ ] **`VariantCards` `LABEL_STYLES` weak typing** — typed as `Record<string, ...>` instead of `Record<'cool' | 'warm' | 'hot', ...>`. Tighten the type.
- [ ] **Compounding CSS transparency** — `bg-surface/80` on the Sidebar applies 80% opacity to a token that's already `rgba(..., 0.82)`. Pick one source of transparency.
- [ ] **Waveform rAF lifecycle coupling** — `src/components/dictation/Waveform.tsx` cannot cancel its own rAF loop. It relies on `MainPanel.handleStop` calling `audio.stop()`. Fragile if a new stop path is added. Make `Waveform` cancel on unmount/`isRecording=false`.
- [ ] **`response.body!` non-null assertion** — `src/lib/claude.ts:16` and `server/lib/claude.ts:50`. Replace with explicit null check.
- [ ] **Duplicated API key access** — `server/lib/transcribe.ts` reads `process.env.OPENROUTER_API_KEY` inline instead of using the `getApiKey()` helper from `server/lib/claude.ts`.
- [ ] **No `X-Accel-Buffering: no` header on SSE** — only matters if deployed behind nginx, but worth adding pre-emptively.
- [ ] **CORS fully open** — `server/index.ts` uses `cors()` with no origin whitelist. Fine for local dev, restrict before any deploy.
- [ ] **`isTranscribing` does not disable `RecordButton`** — user can start a new recording while a previous transcription POST is still in flight, racing the pending `appendTranscript` call.

## Done

(none yet)
