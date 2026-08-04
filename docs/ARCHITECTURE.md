# Cadence architecture and roadmap

## Design priorities

Cadence is organized around five constraints:

1. Dictation should enter the same document surface in which it is edited.
2. The default refinement must be conservative enough to preserve a humanities scholar's vocabulary, uncertainty, and argumentative direction.
3. Notes, learned vocabulary, and prosodic summaries should survive locally without requiring an account.
4. Any operation that sends audio or prose to a service must cross a visible, replaceable provider boundary.
5. The interface should remain quiet at rest; secondary actions reveal on hover, focus, or explicit invocation.

## Runtime map

```text
Browser
├─ React application shell
│  ├─ directory tree + command palette
│  ├─ Tiptap/ProseMirror Markdown editor
│  ├─ recording dock + Web Audio prosody sampling
│  └─ faithful / focused / overhaul refinement controls
├─ IndexedDB (`cadence-notes`, via Dexie)
└─ localStorage compatibility backup and UI settings
           │
           │ Vite proxy in development: /api → :3001
           ▼
Express API
├─ /api/transcribe
│  └─ provider registry
│     ├─ local: persistent faster-whisper Python worker
│     └─ cloud: ElevenLabs Scribe v2 adapter
├─ /api/refine + /api/refine/complete
│  └─ Ollama Cloud native chat streaming/completion adapter
└─ /api/variants
   └─ sequential Ollama Cloud completion calls
```

The frontend works with provider-neutral transcription results:

```ts
interface TranscriptionResult {
  transcript: string;
  words: Array<{ word: string; start: number; end: number }>;
  language: string;
  duration: number;
}
```

Provider-specific authentication, multipart construction, error translation, and response normalization stay on the server.

## Note lifecycle

An `Entry` keeps the unrefined speech record separate from the working document:

- `rawTranscript` is append-only during dictation and remains available in the source drawer.
- `refinedText` is the editor's Markdown document. Tiptap parses it on load and serializes it on change.
- `prosody` stores the latest aggregate pace, energy, fluency, and lexical-density observation; `prosodyHistory` retains at most 50 derived recording observations for real session-level baselines.
- `voiceConfig` stores the user's per-note preservation preferences.

When recording starts, Cadence pins the originating note, provider, and bounded vocabulary hints, then opens one microphone stream for MediaRecorder and Web Audio analysis. It deliberately does not invoke the browser Web Speech service because browsers may perform that recognition remotely. When recording stops:

1. The captured blob is submitted to the selected transcription provider.
2. The normalized transcript is appended to `rawTranscript` and to the current working document, so speech remains visible even if refinement is disabled or fails.
3. Per-entry prosody and voice configuration are saved.
4. If auto-refine is enabled, the current edited document plus the new speech enters the faithful refinement pass; prior manual prose is never reconstructed from the raw archive.
5. The final model output is committed once to `refinedText` and note history.

Raw audio is not added to the durable note schema or retained in recording-session state after transcription.

## Persistence and migration

Dexie owns the `cadence-notes` IndexedDB schema:

| Table | Purpose | Important indexes |
| --- | --- | --- |
| `entries` | Source and edited notes | `id`, `parentId`, timestamps, name |
| `directories` | Hierarchical folders | `id`, `parentId`, name |
| `voiceProfiles` | Versioned derived profile | `id`, `updatedAt`, `schemaVersion` |
| `meta` | One-time operations | `key` |

Hydration starts with the legacy localStorage snapshot. If IndexedDB is empty and the `local-storage-imported` marker is absent, entries and directories are imported in one transaction and the marker is recorded. Thereafter IndexedDB is canonical. Debounced localStorage writes remain a recovery/compatibility copy while the migration settles; removing that backup should be a deliberate future data-migration decision, not a cleanup shortcut.

## Voice profile and transcription feedback

The versioned `voice-profile-v1` algorithm reads only source transcripts, entry identity/timestamps, and bounded recording-level prosody observations. It excludes refined model output and raw audio so generated wording cannot recursively become the user's learned vocabulary.

The derived profile contains:

- frequency- and document-ranked terms with preferred casing;
- ranked contiguous two- and three-word phrases;
- lifetime and rolling mean, standard deviation, minimum, maximum, and latest values for four prosody metrics; and
- rolling-minus-lifetime trends.

The data structure is deterministic and bounded. Common fillers/function words are excluded when choosing transcription hints. The selected hints are sanitized, deduplicated, limited to five words and 50 characters each, capped at 100, and sent in a request header rather than a log-prone URL.

Feedback differs by provider:

- faster-whisper receives a joined local `hotwords` string.
- ElevenLabs receives repeated multipart `keyterms` fields along with the uploaded recording.

This is spelling and vocabulary adaptation, not acoustic speaker adaptation. A future acoustic profile would need a separate opt-in data model, explicit deletion/export controls, encryption decisions, and evaluation against speaker-identification and privacy risks.

## Refinement modes

Prompt construction lives in `src/lib/prompts.ts`; browser transport lives behind `src/lib/refinementApi.ts`, while the Ollama Cloud contract lives in `server/lib/ollama.ts` behind the Express routes. Keeping those responsibilities separate makes prompt behavior testable without a live model and leaves room for a future fully local provider.

### Faithful edit (default)

The default is embedded in application state rather than presented as a special preset: academic register, sentence scale, low temperature, high fidelity, and auto-refine enabled. The system guidance permits obvious copy repair and minimal connective tissue while explicitly forbidding invented facts, citations, examples, arguments, conclusions, and gratuitous theoretical vocabulary.

Learned vocabulary is labeled as spelling/casing guidance only. Prosody and voice-preservation settings shape treatment of pauses, false starts, repetition, and oral transitions.

### Focused refinement

The small composer applies an instruction to the active selection when one exists. A bounded amount of surrounding context is sent for coherence, but only the replacement selection is returned and inserted. Without a selection, the same field addresses the whole working document.

### Full overhaul

Full overhaul is intentionally a separate action. It may find an idea recurring intermittently across rambling dictation, reorder passages, consolidate repetitions, and build a paragraph sequence around that thread. It remains constrained to the speaker's claims, examples, qualifications, characteristic vocabulary, and degree of certainty.

## Privacy boundaries

“Local-first” describes storage and the default transcription path; it does not mean every optional operation is offline.

| Operation | Leaves the machine? | Payload |
| --- | --- | --- |
| Note editing/search | No | Browser-local data only |
| Voice-profile derivation | No | Browser-local text and aggregate metrics |
| Local faster-whisper | No external service | Audio and hints reach the locally running API/worker |
| ElevenLabs transcription | Yes | Audio and selected vocabulary hints |
| Ollama Cloud refinement | Yes | Source/edited text, instruction, vocabulary hints already present in that request, active-entry prosody guidance |

Service keys remain server-side. The API binds to loopback by default and requires shared-secret authentication before it will bind to a non-loopback host. The current profile is not suitable for authentication, medical inference, or forensic identification. Users handling sensitive notes should understand both the selected transcription provider and whether they invoke cloud refinement.

## Why these open-source components

The current stack reuses established projects at the points where correctness is expensive:

- **Tiptap/ProseMirror** supplies a structured editor, history, selection semantics, and an extension model.
- **Dexie** makes IndexedDB transactions, table replacement, and future versioned migrations manageable.
- **Radix UI** supplies accessible interaction primitives without imposing a visual system.
- **cmdk + MiniSearch** provide keyboard navigation and local fuzzy/prefix search without a hosted index.
- **faster-whisper/CTranslate2** provide an efficient local speech engine with word timing, VAD, and hotword support.
- **Express** keeps credentials and provider-specific network calls out of the browser.

The visual layer remains owned by Cadence so the restrained, Typora-like reading experience is not coupled to a component-library theme.

## Staged roadmap

### Next: harden the current loop

- Benchmark local Whisper model sizes and ElevenLabs against a consented corpus containing the user's recurring names, terms, and humanities vocabulary.
- Add export/import and explicit “delete local profile” controls before expanding learned data.
- Add end-to-end recording tests and provider contract tests with representative media formats.
- Introduce a refinement-provider interface and a fully local language-model option.
- Recompute or label prosody after manual transcript edits and calibrate the current heuristic metrics.
- Consider WhisperKit for a native Apple Silicon runtime only after the web/local worker path is benchmarked.

Potential mature additions should be adopted only when their corresponding workflow exists: Headless Tree for advanced tree behavior, WaveSurfer for audio review, librosa for consented offline acoustic analysis, and a bounded queue such as `p-queue` for background jobs.

### Later: scholarship search (deliberately sidelined)

Scholarship search should be a separate module, not an implicit stage of faithful editing. Its proposed contract is:

1. Accept the current selection, paragraph, or note as a query seed.
2. Let the user configure sources, databases/domains, date/language constraints, search strategy, and whether local library results are preferred.
3. Retrieve candidate scholarship through source-specific adapters.
4. Rank for relevance while preserving bibliographic provenance.
5. Return exactly three targeted excerpts by default, each within quotation limits and paired with a resolvable parenthetical citation and source link.
6. Keep retrieved material in a side panel until the user explicitly inserts or cites it; never blend it silently into high-fidelity refinement.

Before implementation, this module needs decisions about licensed/full-text access, Zotero or other local-library integration, citation style, excerpt limits, source allowlists, caching, and defenses against untrusted retrieved text. The current search rail therefore communicates “later” and performs no retrieval.
