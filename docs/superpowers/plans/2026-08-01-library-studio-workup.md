# Library & Studio Workup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Books/notes/writing in one draggable library tree, delimited settings rail, in-pane variant diffs with routing, breath-line recording footer, context-fed refinement, mobile + swipe paging, and lazily hydrated audio takes — shipped to production in two gated phases.

**Architecture:** Frontend-only pass on the existing React 19 + Vite app. Schema v3 extends `Entry`/`Directory` in localStorage with kinds/order/attachment; all new behavior flows through `AppContext` reducer actions. No server changes; prompts gain one optional context parameter. Native HTML5 DnD; no new dependencies.

**Tech Stack:** React 19, Tailwind v4 tokens (in `src/index.css` `@theme`), vitest + jsdom + @testing-library/react, idb-keyval, `diff` (diffWords), Playwright MCP for e2e.

## Global Constraints

- No new runtime dependencies (native DnD, pointer events, IntersectionObserver).
- TypeScript strict; `npm run build` (tsc -b && vite build) must pass.
- Tests: vitest, globals enabled, jsdom; tests live alongside source.
- All existing tests stay green (`npm test`); no prosody-math changes (`npm run diagnostic` untouched).
- Commits: lowercase, short, author zmuhls.
- Design tokens only — colors via `--color-*` utilities (`bg-surface`, `text-accent`…); fonts `.font-brand`/`.font-writing`/`.font-ui`.
- `.env*` files are hook-blocked; never edit them.
- Temperature is relabeled **reach** in UI copy only; the API field stays `temperature`.
- `prefers-reduced-motion` disables idle pulse/ping/afterglow animations.
- Production = `origin` on GitHub; phase gates: unit + lint + build + e2e pass → push branch, merge to `main`, push `main`.

---

## Phase 1 — full workup

### Task 1: Schema v3 — types, defaults, migration

**Files:**
- Modify: `src/types/editor.ts`
- Modify: `src/context/AppContext.tsx` (newEntry/newDirectory signatures)
- Modify: `src/lib/storage.ts` (migration to `'3'`)
- Modify: `src/hooks/useStorage.ts`, `src/components/sidebar/EntryActions.tsx`, `src/components/layout/MainPanel.tsx` (call-site updates for new signatures)
- Test: `src/lib/storage.test.ts`, `src/context/AppContext.test.ts`

**Interfaces (produced, used by every later task):**

```ts
// types/editor.ts
export type DirectoryKind = 'folder' | 'book';
export type EntryKind = 'writing' | 'note';
export interface Directory { id: string; name: string; parentId: string | null; kind: DirectoryKind }
export interface Entry {
  // …existing fields unchanged…
  kind: EntryKind;
  order: number;                  // position within a book; inert in folders
  attachedToId?: string;          // notes only
  includeInRefinement?: boolean;  // notes only, default true
}
// AppContext.tsx
export function newEntry(parentId: string | null, kind?: EntryKind): Entry   // kind defaults 'writing', order 0 (reducer reassigns)
export function newDirectory(parentId: string | null, name: string, kind?: DirectoryKind): Directory
```

- [ ] **Step 1: Failing tests.** In `storage.test.ts` add: loading a v2 entries payload (no `kind`/`order`) yields `kind: 'writing'` and `order` assigned by ascending name within each parent (0,1,2…), and re-save writes `schemaVersion: '3'`. Loading v2 directories yields `kind: 'folder'`. Unknown `kind: 'zebra'` normalizes to defaults. In `AppContext.test.ts`: `newEntry(null)` has `kind: 'writing'`, `order: 0`; `newEntry(null, 'note')` has `kind: 'note'`.

```ts
it('migrates v2 entries to v3 with kind and name-ordered order', () => {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify({ schemaVersion: '2', entries: {
    b: { ...baseEntry, id: 'b', name: 'Beta', parentId: 'd1' },
    a: { ...baseEntry, id: 'a', name: 'Alpha', parentId: 'd1' },
  }}));
  const loaded = loadEntries();
  expect(loaded.a).toMatchObject({ kind: 'writing', order: 0 });
  expect(loaded.b).toMatchObject({ kind: 'writing', order: 1 });
});
```

- [ ] **Step 2: Run** `npm test -- storage` — expect FAIL (kind undefined).
- [ ] **Step 3: Implement.** Add fields to types; in `storage.ts` bump `SCHEMA_VERSION` to `'3'`; in the entry normalizer backfill `kind: e.kind === 'note' ? 'note' : 'writing'`, `includeInRefinement` untouched (undefined = true), and after per-entry normalization group by `parentId` and assign missing `order` by `name.localeCompare` rank; directory loader backfills `kind: d.kind === 'book' ? 'book' : 'folder'`. Update `newEntry`/`newDirectory` and their call sites (`createEntry(parentId, kind?)`, `createDirectory(parentId, name?, kind?)` in useStorage; EntryActions passes through; MainPanel `newEntry(null)` unchanged semantics).
- [ ] **Step 4: Run** `npm test` — all green.
- [ ] **Step 5: Commit** `git commit -m "schema v3: entry/directory kinds, book order, note attachment fields"`

### Task 2: Reducer actions — move, reorder, promote, attach

**Files:**
- Modify: `src/context/AppContext.tsx`
- Test: `src/context/AppContext.test.ts`

**Interfaces (produced):**

```ts
type AppAction = /* existing */
  | { type: 'MOVE_NODE'; nodeType: 'entry' | 'directory'; id: string; newParentId: string | null }
  | { type: 'REORDER_ENTRY'; id: string; beforeId: string | null }   // null → end of book
  | { type: 'SET_DIRECTORY_KIND'; id: string; kind: DirectoryKind }
  | { type: 'ATTACH_NOTE'; noteId: string; entryId: string }
  | { type: 'DETACH_NOTE'; noteId: string };
export function isDescendantDirectory(directories, candidateId, ancestorId): boolean
```

Semantics (each is a test):
- `MOVE_NODE` entry → sets `parentId`, `order = maxOrder(new siblings) + 1`; **also moves attached notes** (their `parentId` follows). Directory → cycle guard: no-op if `newParentId` is itself or a descendant (`isDescendantDirectory`).
- `CREATE_ENTRY` reducer assigns `order = maxOrder(siblings) + 1` (overrides whatever `newEntry` set).
- `REORDER_ENTRY` re-sequences all siblings 0..n with the moved entry before `beforeId` (or last when null).
- `SET_DIRECTORY_KIND` folder→book freezes current alphabetical order into `order` (0,1,2…); book→folder leaves `order` inert.
- `DELETE_ENTRY` detaches notes that pointed at it (`attachedToId` deleted, note survives).
- `ATTACH_NOTE` sets `attachedToId = entryId` **and** `parentId = entry.parentId`; `DETACH_NOTE` clears `attachedToId` only. Attach no-ops if note or target missing, or target is itself a note.

- [ ] **Step 1: Write the failing tests** — one `it` per bullet above, driving `appReducer` directly (pattern already used in `AppContext.test.ts`). Include: move directory into own grandchild (state unchanged), move entry into book (order = end), delete entry detaches its two notes.
- [ ] **Step 2: Run** `npm test -- AppContext` — FAIL (unknown action).
- [ ] **Step 3: Implement** the five cases plus `CREATE_ENTRY`/`DELETE_ENTRY` amendments and exported `isDescendantDirectory` (walk `parentId` chain upward from candidate).
- [ ] **Step 4: Run** `npm test` — green.
- [ ] **Step 5: Commit** `"reducer: move/reorder/promote/attach actions with cycle guard"`

### Task 3: Tree building — book order, note nesting

**Files:**
- Modify: `src/hooks/useDirectoryTree.ts`
- Test: Create `src/hooks/useDirectoryTree.test.ts` (tests `buildTree`, pure)

**Interfaces (produced):**

```ts
export interface TreeNode {
  type: 'directory' | 'entry';
  id: string; name: string; parentId: string | null;
  children: TreeNode[];           // for entries: attached notes
  entry?: Entry;
  directoryKind?: DirectoryKind;  // directories only
  chapterNumber?: number;         // writing entries directly inside a book, 1-based
}
```

Rules: book children sort by `order` (directories-first rule stays); folder children keep alphabetical. Notes with `attachedToId` nest under that entry as `children` (never as container siblings), sorted by name; a note whose target is missing renders as a plain sibling. `chapterNumber` counts unattached writing entries within a book only. Query filter unchanged, but a match on an attached note keeps its parent entry visible.

- [ ] **Step 1: Failing tests** for each rule (build small `directories`/`entries` records; assert order of `buildTree(null, …)` ids, `chapterNumber` sequence, note nesting under entry node, filter keeps parent).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in `buildTree`: partition entries at level into attached-notes (grouped by target) vs placed; attach note groups to entry nodes; sort by parent kind; stamp `chapterNumber` when parent directory kind is book.
- [ ] **Step 4: Run** `npm test` — green.
- [ ] **Step 5: Commit** `"tree: book ordering, chapter numbers, nested margin notes"`

### Task 4: Sidebar UI — glyphs, numbering, row menu, creation

**Files:**
- Modify: `src/components/sidebar/TreeNode.tsx`, `src/components/sidebar/DirectoryTree.tsx`, `src/components/sidebar/EntryActions.tsx`
- Create: `src/components/sidebar/RowMenu.tsx`

**Interfaces:** RowMenu props `{ node: TreeNodeType; onClose(): void }`; consumes `useStorage()` which gains `moveNode`, `setDirectoryKind`, `attachNote`, `detachNote`, `reorderEntry` wrappers (add in this task, thin `dispatch` passthroughs).

UI details:
- Glyphs: book `𝄃` (font-brand span), folder chevron (existing svg), writing dot (existing), note `✎` (text span). Chapter rows render `chapterNumber` in tabular-nums where the dot glyph was.
- `⋯` button (opacity-0 → group-hover/focus-visible like existing delete ×) opens RowMenu: absolute dropdown, same styling as VoiceConfigToggles panel (`border-border bg-surface shadow`). Items per node type: *move to…* (nested list of root + all folders/books except self/descendants — reuse `isDescendantDirectory`), *make book*/*make folder*, *attach to entry…* (notes only: writing entries in same container), *detach* (attached notes), *delete* (replaces the bare × button).
- Word count fallback: `entry.wordCount || countWords(entry.rawTranscript) || countWords(entry.refinedText)`.
- EntryActions: `+ entry · + note · +▾` — first two as delimited text buttons (no boxes, middle-dot separators), `+▾` opens a two-item menu (folder / book). Create into the active entry's parent (`entries[activeEntryId]?.parentId ?? null`).

- [ ] **Step 1: Implement** (UI task — no unit test; covered by e2e + Task 3 logic tests already pin data).
- [ ] **Step 2: Verify** `npm run build` and `npm run lint` pass; `npm test` still green.
- [ ] **Step 3: Visual check** dev server: create book via +▾, entries number themselves, ⋯ move works, attach nests note.
- [ ] **Step 4: Commit** `"sidebar: kind glyphs, chapter numbers, row menu, delimited creation actions"`

### Task 5: Drag and drop

**Files:**
- Create: `src/components/sidebar/dnd.ts` (pure helpers + shared drag payload type)
- Modify: `src/components/sidebar/TreeNode.tsx`, `src/components/sidebar/DirectoryTree.tsx`
- Test: `src/components/sidebar/dnd.test.ts`

**Interfaces (produced):**

```ts
export interface DragPayload { nodeType: 'entry' | 'directory'; id: string }
export type DropIntent =
  | { kind: 'into'; parentId: string | null }
  | { kind: 'before'; beforeId: string; parentId: string }
  | { kind: 'none' };
export function resolveDropIntent(payload, targetNode, zone: 'top' | 'middle' | 'bottom', directories): DropIntent
export function encodeDrag(p: DragPayload): string  // JSON into dataTransfer 'application/x-comprosody'
export function decodeDrag(dt: DataTransfer): DragPayload | null  // null on garbage
```

`resolveDropIntent` rules (each a test): container middle → `into` (unless cycle → `none`); entry row inside a book, top/bottom zone → `before` that entry / before its next sibling (`before` with next id, or `into` parent when last); anything onto a plain entry outside a book → `into` its parent; note rows accept nothing (`none`); self-drop → `none`.

Wiring: rows get `draggable`, `onDragStart` (encode + `effectAllowed='move'`), `onDragOver` (compute zone from `e.clientY` vs rect thirds; set state for insertion-line / row-highlight rendering; `preventDefault` when intent ≠ none), `onDrop` (decode → intent → dispatch `MOVE_NODE` or `REORDER_ENTRY` + `MOVE_NODE` when crossing parents), `onDragLeave`/`onDragEnd` clear. DirectoryTree root gets a trailing drop zone (`into root`). Insertion line: absolute 1px `bg-accent` bar; container highlight: `bg-accent/8`.

- [ ] **Step 1: Failing tests** for `resolveDropIntent` (7 cases above) + `decodeDrag` garbage → null.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** helpers, then wire components.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npm run build` — green.
- [ ] **Step 5: Commit** `"sidebar: native drag-and-drop with insertion lines and cycle-safe drops"`

### Task 6: Settings rail + InfoPopover

**Files:**
- Create: `src/components/editor/InfoPopover.tsx`, `src/components/editor/SettingsRail.tsx`
- Modify: `src/components/editor/Toolbar.tsx`

**Interfaces:** `InfoPopover({ label, children })` — `ⓘ` button (aria-label from `label`), click-outside close (same pattern as VoiceConfigToggles). `SettingsRail()` reads/dispatches `refinementSettings` itself.

Rail layout (one flex line, `flex-wrap`, hairline middle-dot delimiters as `<span className="text-text-muted/40">·</span>`): `register [select] · scale [select] · reach [range] 0.50 [ⓘ]`. Selects lose borders: `bg-transparent border-b border-transparent hover:border-border-strong focus:border-accent/50` — underline behavior, `font-ui text-[11px] uppercase tracking`. Reach keeps `accent-accent` range + tabular value. ⓘ copy (verbatim):

> **reach** — how far a pass may stray from your words. Also called temperature. Low reach (0.2) stays closest to your phrasing and punctuation; middle (0.5) balances fidelity with flow; high (0.9) rewrites boldly and varies more between runs. It never changes what you said — only how freely the pass may rephrase it.

Toolbar keeps the action cluster (seed/undo/refine/selection/passes/copy/export) right-aligned; "variants" button relabels to "passes".

- [ ] **Step 1: Implement.** **Step 2:** `npm test && npm run lint && npm run build`. **Step 3:** visual check. **Step 4: Commit** `"editor: delimited settings rail, reach info popover"`

### Task 7: Passes — chips, in-pane diff, routing

**Files:**
- Create: `src/components/editor/VariantDiffView.tsx`, `src/components/editor/PassesBar.tsx`
- Modify: `src/components/editor/Editor.tsx`, `src/hooks/useRefinement.ts`
- Delete: `src/components/editor/VariantCards.tsx`
- Test: `src/components/editor/VariantDiffView.test.tsx`

**Interfaces (produced):**

```ts
// useRefinement additions
retryVariant(label: Variant['label']): Promise<void>   // single-temperature rerun, merges into variants
// PassesBar props
{ variants: Variant[]; errors: VariantError[]; highlighted: Variant['label'] | null;
  onHighlight(label: Variant['label'] | null): void; onRetry(label): void;
  onAccept(): void; onToNote(): void; onToChapter(): void; canToChapter: boolean; onDismiss(): void;
  isGenerating: boolean }
// VariantDiffView props
{ oldText: string; newText: string }   // diffWords; ins: text-success bg-success/10, del: text-hot/70 line-through decoration-hot/50
```

- Editor holds `highlightedPass` state (reset on entry switch). When a chip is highlighted, the draft pane renders `VariantDiffView(activeEntry.refinedText, variant.text)` instead of the textarea (same slot as DiffView swap). Arrow-key navigation between chips (`role="radiogroup"`).
- Failed passes render dimmed chips `cool ↻` calling `onRetry`.
- **accept**: existing `acceptVariant(variant)` then clear highlight. **→note**: dispatch CREATE_ENTRY `{ ...newEntry(activeEntry.parentId, 'note'), name: `${label} pass — ${activeEntry.name}`.slice(0,60), refinedText: variant.text, attachedToId: activeEntry.id }`. **+chapter**: walk `parentId` chain to nearest `kind === 'book'`; CREATE_ENTRY writing entry there with `refinedText: variant.text`, `name: deriveEntryName(variant.text)`; disabled with `title="entry is not inside a book"` otherwise; membership re-checked at click time (no-op + refinementError message if the book vanished).
- ⓘ on the bar reuses InfoPopover with a passes-specific line: "cool stays closest to your wording · warm balances · hot rewrites boldest. Each chip previews as green additions and red removals in the draft below."

- [ ] **Step 1: Failing test** (`VariantDiffView.test.tsx`, @testing-library): renders `<ins>`-styled span for added word, struck span for removed word given `oldText="the cat sat"`, `newText="the dog sat"`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** VariantDiffView, PassesBar, retryVariant, Editor wiring; delete VariantCards.
- [ ] **Step 4:** `npm test && npm run lint && npm run build` green. **Step 5: Commit** `"passes: in-pane variant diff, chip navigation, note/chapter routing"`

### Task 8: Margin notes panel + breadcrumb

**Files:**
- Create: `src/components/editor/MarginNotes.tsx`
- Modify: `src/components/editor/Editor.tsx`

**Interfaces:** `MarginNotes({ entryId })` — pulls attached notes (`Object.values(entries).filter(e => e.attachedToId === entryId)`); rows: name, body preview (refinedText || rawTranscript, 2-line clamp), *open* (SET_ACTIVE_ENTRY), *detach* (DETACH_NOTE), *include* checkbox → `UPDATE_ENTRY { includeInRefinement }` (default true when undefined).

- Toggle button `notes (n)` in the draft-pane header (next to diff); panel is a 240px right column inside the draft pane on `xl:`, full-width bottom sheet (`fixed inset-x-0 bottom-0 max-h-[50vh] overflow-y-auto z-20 border-t`) below.
- Breadcrumb in the entry header, above the name input: ancestor chain (`Field Book / Loose drafts`) each clickable no-op label (plain text, `text-[10px] uppercase tracking text-text-muted`), plus `ch 2 of 5` when the entry is a numbered chapter (compute from tree helpers: unattached writing siblings sorted by order).

- [ ] **Step 1: Implement.** **Step 2:** verify suite/lint/build. **Step 3:** visual check (attach → shows in panel; include toggle persists). **Step 4: Commit** `"editor: margin notes panel, location breadcrumb"`

### Task 9: Context-fed refinement

**Files:**
- Create: `src/lib/refineContext.ts`
- Modify: `src/lib/prompts.ts`, `src/hooks/useRefinement.ts`
- Test: `src/lib/refineContext.test.ts`, extend `src/lib/prompts.test.ts`

**Interfaces (produced):**

```ts
export const REFINE_CONTEXT_CAP = 1200;
export function buildRefineContext(
  entryId: string,
  entries: Record<string, Entry>,
  directories: Record<string, Directory>,
): string   // '' when no book and no included notes
// prompts.ts — LAST optional param on both builders:
buildSystemPrompt(settings, prosody, voiceConfig, refineContext?: string)
buildSelectionPrompt(settings, prosody, voiceConfig, before, selection, after, refineContext?: string)
```

Context block format (deterministic, testable):

```
SURROUNDING WORK (guidance, not text to reproduce):
This passage is chapter 2 of 5 in "Field Book".
Neighboring chapters: 1. "Morning walk" — <first sentence>. 3. "Riverbank draft" — <first sentence>.
Writer's margin notes: "tone note": <note text>.
```

Assembly order: book line, neighbor lines (previous then next only — not all), then notes (`includeInRefinement !== false`). Enforce cap by truncating notes first (append `…`), then neighbor sentences, never the book line. First sentence = text up to first `.!?` or 140 chars. Prompt builders append the block as a final paragraph only when non-empty — **zero-context output byte-identical to today** (assert `buildSystemPrompt(s,p,v)` === `buildSystemPrompt(s,p,v,'')` === current snapshot in prompts.test.ts). `useRefinement` computes context once per refine/selection/variants call from `stateRef`.

- [ ] **Step 1: Failing tests**: empty for rootless entry; book block with position + both neighbors; skips `includeInRefinement: false` notes; cap respected on a 3000-char note (result.length ≤ 1200, book line intact); prompts byte-identity.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** suite green.
- [ ] **Step 5:** Dispatch the `prompt-composition-reviewer` agent on the `prompts.ts` diff; address findings.
- [ ] **Step 6: Commit** `"refinement: bounded book/notes context fed into prompts"`

### Task 10: Footer workup — seal, breath line, quiet stats

**Files:**
- Modify: `src/components/dictation/RecordButton.tsx`, `src/components/dictation/Waveform.tsx`, `src/hooks/useAudioAnalyser.ts` (draw restyle), `src/components/dictation/RecordingFooter.tsx`, `src/components/dictation/ProsodyPanel.tsx`, `src/index.css`

**Interfaces:** `RecordButton` gains `energy?: number` (0–1, live `prosody.energy`); `Waveform` unchanged signature.

- **Seal button:** `rounded-full h-14 w-14`, double ring = outer `border border-accent/60` + inner ring via `shadow-[inset_0_0_0_3px_var(--color-canvas),inset_0_0_0_4px_rgba(217,138,84,0.5)]`; idle core `h-5 w-5 rounded-full bg-accent`; recording core morphs to `h-4 w-4 rounded-[3px] bg-recording` (transition-all). Recording glow: `style={{ boxShadow: `0 0 ${10 + energy*26}px rgba(220,101,89,${0.25 + energy*0.4})` }}`. Keep aria/disabled behavior. Ping ring only without reduced-motion (`motion-safe:animate-ping`).
- **Breath line (idle):** replace `drawIdle` bars with a single horizontal 1px line `rgba(217,138,84,0.35)` plus a soft 60px-wide drifting glow pulse (rAF, ~18s period, skipped entirely under `matchMedia('(prefers-reduced-motion: reduce)')` → static line). Idle drawing returns a cancel fn like the live path.
- **Live stroke:** in `useAudioAnalyser.drawWaveform`, drop the frequency bars; draw the time-domain stroke twice (y and mirrored 2·midline−y) at `lineWidth 1.1`, plus `ctx.shadowBlur = 12, shadowColor = rgba(217,138,84,0.5)` on the primary stroke. Keep the CSS-pixel coordinate discipline (comment in file explains HiDPI).
- **Footer layout:** single row `h-[72px] flex items-center gap-4 px-4`: seal (canvas line runs behind it, full width, `absolute inset-0`), status block (one line: `recording live · Field notes` / errors), flexible spacer, prosody line, voice popover. ProsodyPanel becomes one delimited text line (no boxed Stat chips): `elapsed 0:42 · 128 wpm · energy 62% · fluency 87% · density 54%` (`tabular-nums`, energy value keeps `text-energy`). Retry/use-live-transcript block keeps current styling, rendered as a second row when armed (footer grows — error states don't get quieter).

- [ ] **Step 1: Implement.** **Step 2:** suite/lint/build green (`RecordingContext.test.ts` unaffected). **Step 3:** visual check idle + recording (mic) + reduced-motion (devtools emulation). **Step 4: Commit** `"footer: breath-line waveform, seal record button, delimited prosody line"`

### Task 11: Mobile + swipe paging

**Files:**
- Create: `src/hooks/useSwipePaging.ts`
- Modify: `src/App.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/MainPanel.tsx`, `src/components/editor/Editor.tsx`, `src/components/editor/Toolbar.tsx`
- Test: `src/hooks/useSwipePaging.test.ts`

**Interfaces (produced):**

```ts
export function getPagingSiblings(entryId, entries, directories): { prev: string | null; next: string | null }
// unattached writing entries sharing parentId; book parent → order sort, else name sort
export function useSwipePaging(ref: RefObject<HTMLElement | null>, opts: { onPrev(): void; onNext(): void; enabled: boolean })
// touch pointerdown/up: |dx| ≥ 60, |dx| > 2|dy|, no active text selection → onPrev (dx>0) / onNext (dx<0)
```

- Sidebar: `App` owns `sidebarOpen`; below `lg` the aside is `fixed inset-y-0 left-0 z-30 w-72 -translate-x-full transition-transform` + `translate-x-0` when open, with a `bg-black/50` backdrop button; `lg:` reverts to static (`lg:static lg:translate-x-0`). Hamburger (`≡`, 44px hit target) appears `lg:hidden` in the Editor header and empty state.
- Editor: header stat chips already wrap; ensure paddings scale (`px-4 sm:px-5`), settings rail wraps (already `flex-wrap`), grid stacks below `xl` (already does). Footer: prosody line truncates behind a `stats` toggle chip below `sm`.
- Swipe: hook attached to the editor scroll container; page indicator `‹ ch 2 / 5 ›` centered under the header on touch viewports (also live region announcing entry name). Keys `[` / `]` page globally (skip when target is input/textarea/select).
- `getPagingSiblings` unit-tested (book order, folder alpha, notes and attached items skipped, ends → null).

- [ ] **Step 1: Failing tests** for `getPagingSiblings` (4 cases). **Step 2:** FAIL. **Step 3: Implement** helper + hook + wiring. **Step 4:** suite/lint/build green. **Step 5: Commit** `"mobile: sidebar drawer, responsive footer, swipe/bracket paging"`

### Task 12: Phase 1 gate — e2e, push to production

- [ ] **Step 1:** `npm test && npm run lint && npm run build` all green.
- [ ] **Step 2:** Start `npm run server` + `npm run dev` (background). Playwright MCP e2e at 1440×900: create book via +▾ → create 3 entries in it → verify numbering; drag entry 3 above entry 1 → order persists after reload; create note, attach via ⋯ → nests; settings rail select register/scale, open ⓘ; seed draft → passes (mock: if no `OPENROUTER_API_KEY`, cover chips-with-error + retry affordance instead); breadcrumb correct; delete book → cascade confirm.
- [ ] **Step 3:** e2e at 390×844 (browser_resize): drawer opens/closes; swipe (dispatch pointer events via browser_run_code_unsafe) pages ch 1→2; `[`/`]` page; footer fits without horizontal scroll.
- [ ] **Step 4:** Fix anything found; re-run suite.
- [ ] **Step 5: Push:** `git push -u origin optimization-pass && git checkout main && git merge --no-ff optimization-pass -m "merge optimization-pass: library & studio workup" && git push origin main && git checkout optimization-pass`.

---

## Phase 2 — audio hydration

### Task 13: audioStore — metadata listing + measured hydration

**Files:**
- Modify: `src/lib/audioStore.ts`
- Test: `src/lib/audioStore.test.ts` (pure parts: `readBlobWithProgress` via constructed Blob, paging math)

**Interfaces (produced):**

```ts
export interface TakeMeta { entryId: string; recordedAt: number; durationMs: number; mimeType: string; byteSize: number; transcript?: string }
export async function listTakeMeta(entryId: string): Promise<TakeMeta[]>       // newest first; byteSize from stored field, falls back to blob.size for legacy records
export async function loadTakeBlob(entryId: string, recordedAt: number,
  onProgress?: (loaded: number, total: number) => void): Promise<Blob>          // streams via blob.stream() reader, reporting real bytes
export const TAKES_PAGE_SIZE = 10;
```

`saveRecording` stores `byteSize: blob.size`. `loadTakeBlob` reads the stored record, then pumps `blob.stream().getReader()`, accumulating chunks and calling `onProgress(loaded, blob.size)`; resolves a rebuilt `new Blob(chunks, { type: mimeType })`. jsdom test: 1 MB generated Blob → progress calls are monotonically increasing and final `loaded === total`; result blob size matches. (IndexedDB itself isn't exercised in jsdom — e2e covers it.)

- [ ] **Step 1: Failing test** for `readBlobWithProgress` (exported helper `loadTakeBlob` delegates to). **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** green. **Step 5: Commit** `"audio: take metadata listing, streamed blob hydration with progress"`

### Task 14: AudioTakes — infinite scroll, progress, log strip

**Files:**
- Rewrite: `src/components/editor/AudioTakes.tsx`

Behavior:
- On mount / `audioTakes` bump: `listTakeMeta(entryId)` → metadata rows render immediately (take n, duration, `formatBytes(byteSize)`, recordedAt) with **no** blobs loaded. First `TAKES_PAGE_SIZE` rows visible; an IntersectionObserver sentinel row reveals the next page (batch bar `page 2 · 4 takes` while its visible rows hydrate).
- A row hydrates (calls `loadTakeBlob` with progress → determinate `<div>` bar, `bg-accent`, width %) when it enters the viewport (per-row IntersectionObserver, `rootMargin: '200px'`) or on play tap. Hydrated → `<audio controls src={objectURL}>`; leaving viewport by > 600px revokes the URL and returns the row to its metadata state (progress bar reruns on return — cheap, local).
- Log strip: collapsible `<details>` under the list header, monospace, ring buffer of last 20 lines: `take 3/12 · 2.1 MB · hydrated 84ms`, `page 2 · revealed 10 takes`, `take 5 · released (offscreen)`. Timing via `performance.now()`.
- Errors per row: `hydration failed · retry` inline, never throws.

- [ ] **Step 1: Implement.** **Step 2:** suite/lint/build green. **Step 3:** visual check with ≥ 12 seeded takes. **Step 4: Commit** `"audio takes: infinite scroll with measured hydration and process log"`

### Task 15: Phase 2 gate — audio e2e, final push

- [ ] **Step 1:** e2e: seed ~15 synthetic takes into IndexedDB via `browser_run_code_unsafe` (small WAV blobs, varied sizes incl. one multi-MB), open entry: metadata rows render instantly; scroll → sentinel reveals pages; progress bars appear and complete; log strip lines accumulate; offscreen rows release (assert row returns to metadata state); playback works on a hydrated row; mobile 390px pass.
- [ ] **Step 2:** Full suite + lint + build.
- [ ] **Step 3: Push:** same sequence as Task 12 Step 5 (branch → merge `main` → push).
- [ ] **Step 4:** Update `TODO.md` (link refinement-provenance item to new draftHistory context if touched) and `CLAUDE.md` architecture notes (library model, passes, refineContext, audio hydration). Commit `"docs: workup notes"` and push.
