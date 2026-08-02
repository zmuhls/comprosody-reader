# TODO

Audit findings from 2026-04-10, resolved in the 2026-07-26 optimization pass (branch `optimization-pass`). One item remains open below; everything else moved to Done with its resolution.

## Next steps — ElevenLabs phase-out (logged 2026-08-01)

Recon result: there is **no ElevenLabs code, dependency, env var, or doc reference anywhere in the tree**. The exploratory transcription wiring from 2026-07-31 never produced a commit; its only artifact was a stale git worktree at `.claude/worktrees/elevenlabs` (detached HEAD at `6c426c7`, clean, zero elevenlabs references). Transcription already runs entirely on OpenRouter (`OPENROUTER_TRANSCRIBE_MODEL`, default `google/gemini-2.5-flash`) via `POST /api/transcribe`.

- [x] Remove the stale worktree (`git worktree remove .claude/worktrees/elevenlabs`) — nothing unique in it; the checkout commit exists in the main repo.
- [x] Confirm OpenRouter transcription is the sole, permanent path (no dual-provider switch to maintain).
- [ ] **Gate for any future dedicated-STT provider** (ElevenLabs or otherwise): it must support vocabulary biasing equivalent to the `X-Lexicon` system-message hint, or the transcription-fidelity loop loses its upstream half and only the deterministic find/replace carries the lexicon. Evaluate against that requirement before wiring anything.
- [ ] If ElevenLabs voice features (e.g. TTS readback of drafts) become desirable later, they enter as a new spec under `docs/superpowers/specs/` — not a revival of the old worktree.

## Open (added 2026-08-01, library & studio workup)

- [ ] **Diagnostic blind spot for refineContext** — `scripts/prosody-pipeline-diagnostic.ts` never calls `buildSystemPrompt` with the new `refineContext` argument, so its oversized-prompt tracking misses the whole fifth dimension. Worst case adds ~200–270 tokens (cap 1200 chars). Flagged by prompt-composition review.
- [ ] **No way to create directly into an empty book** — `+ entry`/`+ note` target the active entry's parent; an empty book can only be filled by drag or *move to…*. A "new chapter here" row action on book rows would close the gap.
- [ ] **Audio hydrate/release hysteresis is viewport-based** — the takes list scrolls in its own container, so the 200px/600px root margins both collapse to the container clip edge. Works (release confirmed in e2e), but passing the container as the IntersectionObserver `root` would restore the intended hysteresis band.

## Open

- [ ] **`.env.example` missing new vars** — needs two additions (blocked for automation by the protected-files hook; edit manually):
  - `OPENROUTER_TRANSCRIBE_MODEL=google/gemini-2.5-flash` (used by `server/lib/transcribe.ts`)
  - `CORS_ORIGIN=http://localhost:5173` (comma-separated allowlist read by `server/index.ts`)

- [ ] **Refinement provenance gap** — nothing links a refinement to the settings/prosody that produced it. `entry.prosody` is a single snapshot overwritten on every recording stop (`MainPanel.tsx` `handleStop`), while `rawTranscript` accumulates across takes, so on a multi-take entry the stored prosody no longer describes what produced `refinedText`. `draftHistory` is bare `string[]` — no timestamp, no settings, no prosody. Does not affect the lexicon loop (which diffs per-take transcripts), but blocks any future refinement-style learning: you cannot learn from a signal you cannot attribute.

- [ ] **Lexicon hint efficacy unmeasured** — the deterministic pass fires exactly where the upstream vocabulary hint failed, so `AppliedSubstitution` counts are the metric for whether the hint is doing anything. Currently surfaced per-transcription in the UI but never aggregated. If the count stays flat as the lexicon grows, the hint is inert and only the find/replace is carrying the feature.

## Done

### Critical

- [x] **Selection refinement can corrupt text** — refined textarea is `readOnly` while refining (`aria-busy`, visual cue); `refineSelection` re-checks the captured selection against the current entry text before splicing and errors with `selection changed during refinement` on mismatch.
- [x] **No timeouts on upstream `fetch` calls** — `AbortSignal.timeout(60_000)` on `refineComplete`, `120_000` on transcribe; `streamRefinement` gets an idle-timeout controller (60s to first byte, 30s per chunk) combined with an optional external signal via `AbortSignal.any`.
- [x] **No input validation on backend routes** — hand-rolled `server/lib/validate.ts` (`HttpError`, `reqObject`, `reqString`, `reqNumber`) validates `/api/refine` before SSE headers and `/api/variants` including the temperatures array; unit-tested.
- [x] **`/api/variants` is fail-fast** — `Promise.allSettled`; responds `{ variants, errors }` with partial results, 502 only when all fail. Client surfaces "n of m variants returned".

### High

- [x] **`refineComplete` is dead code** — client function and `/api/refine/complete` route both deleted (`server/lib/claude.ts#refineComplete` kept — `/api/variants` uses it).
- [x] **Word timestamps pipeline is inert** — removed end to end: server returns `{ transcript }` only; `WordTimestamp`, `session.wordTimestamps`, and `ADD_WORD_TIMESTAMP` deleted from the frontend.
- [x] **VoiceConfigToggles label click dead zone** — converted to a real `<input type="checkbox">` (peer + sr-only) inside the label, with keyboard focus ring.
- [x] **`@anthropic-ai/sdk` is an unused dependency** — removed (`idb-keyval` and `diff` added instead, both actively used).
- [x] **No global JSON error handler on Express** — 4-arity JSON error middleware in `server/index.ts` (`headersSent` guard, `HttpError` status mapping); redundant per-route try/catch removed.

### Medium

- [x] **`SET_AUDIO_BLOB` dispatch is dead** — action and `session.audioBlob` removed; recordings now persist durably to IndexedDB (`src/lib/audioStore.ts`) with a per-entry takes player in the editor.
- [x] **Stale-closure fallback may lose final phrase** — `finalTranscriptRef` + `getFinalTranscript()` in `useSpeechRecognition`; fallback reads go through the ref.
- [x] **No size limit on raw audio uploads** — 25 MB cap in `/api/transcribe`: Content-Length pre-check (413) plus streamed byte counting with `req.destroy()`.
- [x] **`max_tokens: 64000` in `streamRefinement`** — shared `MAX_OUTPUT_TOKENS = 8192` used by both refinement paths.
- [x] **Empty content silently returns 200** — `refineComplete` throws on empty content; `/api/refine` emits an error event when the stream produces zero chunks.

### Low

- [x] **No localStorage write debounce** — `createDebouncedPersist` (trailing 300 ms) for entries/directories with flush on `pagehide`/`visibilitychange`; settings save immediately; all savers quota-safe.
- [x] **`generateVariants` missing `dispatch` in deps** — stale finding: the dep array already includes `dispatch` in current code; no change needed.
- [x] **`VariantCards` `LABEL_STYLES` weak typing** — typed `Record<Variant['label'], ...>`.
- [x] **Compounding CSS transparency** — Sidebar uses `bg-surface` (token already carries alpha).
- [x] **Waveform rAF lifecycle coupling** — `drawWaveform` returns a cancel function; `Waveform` cancels in its own effect cleanup. HiDPI drawing bug (device-pixel coords on a pre-scaled context) fixed alongside.
- [x] **`response.body!` non-null assertion** — explicit null checks with clear errors, client and server.
- [x] **Duplicated API key access** — `getApiKey()` exported from `server/lib/claude.ts`, shared by transcribe.
- [x] **No `X-Accel-Buffering: no` header on SSE** — added, plus `flushHeaders()` after validation.
- [x] **CORS fully open** — allowlist from `CORS_ORIGIN` env (default `http://localhost:5173`).
- [x] **`isTranscribing` does not disable `RecordButton`** — disabled while a transcription is in flight (`aria-pressed`, reason in title).

### Fixed beyond the audit

- [x] Client disconnect on `/api/refine` now aborts the upstream OpenRouter stream (stops token billing).
- [x] `DELETE_DIRECTORY` recursively cascades through nested sub-directories (was orphaning grandchildren permanently); IndexedDB recordings cascade too.
- [x] Stale interim transcript no longer bakes into the editor after recording stops.
- [x] `useProsody` interval no longer restarts on every render tick.
- [x] Safari support: MediaRecorder mimeType probe (`webm;codecs=opus` → `webm` → `mp4`), server maps Content-Type to upstream audio format.
- [x] localStorage load normalization/migration (`schemaVersion` 2) backfills new entry metadata on legacy data.

### Mobile keyboard fix (2026-08-01)

- [x] **iOS keyboard sheared the editor out of view** — root cause: `h-screen` shell + `overflow-hidden` vs iOS Safari's overlay keyboard (layout viewport never resizes; Safari pans the window instead). Fixed with `useAppViewportHeight` (VisualViewport → `--app-height` → `h-app` utility), a below-`xl` scrollable pane column (panes size to content, iOS caret-reveal scrolls the focused pane into view), the `short:` variant (≤520px height melts the entry header away), and a 16px form-control floor on coarse pointers to stop focus auto-zoom.
- [x] **Margin-notes bottom sheet overlays the footer below `xl`** — now `absolute` inside the editor column, docked above the footer; also keeps it above the on-screen keyboard.

### New features (2026-07-26)

- [x] Durable audio takes: IndexedDB persistence + per-entry takes player with native audio controls.
- [x] Transcription retry UX: failed uploads offer `retry upload` / `use live transcript` instead of silently falling back; live transcript auto-rescued if a new recording starts.
- [x] Export/copy: markdown download and clipboard copy per entry (`src/lib/export.ts`).
- [x] Undo: `draftHistory` (cap 10) with toolbar undo across refine/splice/variant overwrites.
- [x] Raw-vs-refined diff view (`diffWords`) toggle in the refined pane.
- [x] Sidebar search over name/transcript/draft with directory-aware filtering.
- [x] Keyboard shortcuts: Ctrl/Cmd+Shift+Space record toggle, Ctrl/Cmd+Enter refine, Ctrl/Cmd+Shift+C copy.
- [x] Live recording stats (elapsed `m:ss`, running word count) in the footer; per-entry word badge in the sidebar; take-duration chip in the editor.
- [x] Delete confirmations on entries/directories; health check re-polls every 30 s and on window focus.

### Lexicon — transcription fidelity loop (2026-07-31)

Closes the loop `correction → confirmed term → vocabulary hint → fewer corrections`. Design: `docs/superpowers/specs/`; plan approved on branch `optimization-pass`.

- [x] `src/lib/lexicon.ts` — pure phonetic filter (`phoneticSimilarity` via normalized Levenshtein + folded consonant skeleton), `extractCandidates` (reuses `diffWords`), `applyLexicon`, `rankForHint`, `encodeLexiconHint`, `mergeCandidate`. 40 unit tests.
- [x] `StoredRecording.transcript` — each take records the text it contributed, giving the correction diff its baseline and closing the "takes stored without their transcript" gap.
- [x] Confirm chips (`CorrectionChips`) in the transcript pane; phonetic filter rejects content edits, sentence rewrites, and case-only changes so they never reach the lexicon.
- [x] Vocabulary hint reaches the model: base64 `X-Lexicon` header (raw-audio body has no JSON envelope) → `optHeaderStringArray` → `transcribe(audio, format, vocabulary)` system message. Malformed hints decode to `[]` rather than blocking transcription. Wire format pinned by a literal asserted on both sides.
- [x] Client-side deterministic pass with case-sensitive, word-bounded matching; `AutoCorrectionNotice` reports what was rewritten after the model produced it.
- [x] Misfire demotion — reverting a substitution disables that rule (`misfires >= confirmations`), keeping a bad entry from rewriting every future transcript. Demoted terms still feed the upstream hint.
- [x] `LexiconPanel` in the sidebar: list, hand-add (incl. hint-only terms), delete, re-enable demoted.
