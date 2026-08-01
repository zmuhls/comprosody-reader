# Library & studio workup — design

Date: 2026-08-01
Branch: `optimization-pass`
Status: approved by user (all sections), pending spec review

## Brief

Fill the gaps in the interface genres: a full user workflow with clickable, editable,
draggable books and directory structures shared across writing, notes, and books;
compact settings with discreet delimiters and a more intuitive presentation order;
a full UI workup of the record button and sound waves; improved variants; and
agentic cross-interface awareness.

Decisions fixed during brainstorming:

- **Binder model** for books: a book is a promoted directory with ordered children.
  One shared tree — no tabs, no separate libraries.
- **Agentic scope**: context-fed refinement, notes attachable to writing, and
  cross-entry routing actions from variants. No command palette.
- **Variants**: no preview cards. Chips + in-pane green/red diff of the current
  draft against the highlighted variant. Plain-language info popover explaining
  temperature. Temperature-only axis (no genre/scale axis picker — YAGNI).
- **Approach A — integrated workup** within the existing sidebar/editor/footer
  anatomy. Native HTML5 drag-and-drop, no new dependencies.

## 1 · Data model and migration (schema v3)

```ts
interface Directory {
  id: string;
  name: string;
  parentId: string | null;
  kind: 'folder' | 'book';      // new
}

interface Entry {
  // …existing fields…
  kind: 'writing' | 'note';     // new
  order: number;                 // new — position within a book; ignored in folders
  attachedToId?: string;         // new — notes only: the writing entry this note is pinned to
  includeInRefinement?: boolean; // new — notes only: fold this note into refinement context (default true)
}
```

- `loadEntries`/`loadDirectories` migrate to `schemaVersion: '3'`: backfill
  `kind: 'writing'` / `kind: 'folder'`, assign `order` from the current
  alphabetical position within each parent. An existing library renders
  identically after upgrade.
- Folders sort alphabetically (unchanged). Books order children by `order`.
  Promoting a folder to a book freezes the current alphabetical order as the
  initial chapter order; demoting back to folder keeps `order` values (inert).
- Deleting an entry **detaches** (does not delete) its margin notes.
  Directory delete cascades exactly as today (`collectDirectoryCascade`),
  including IndexedDB recordings.

New reducer actions:

- `MOVE_NODE { nodeType, id, newParentId }` — cycle-guarded: a directory can
  never move into itself or its own descendant. Moving an entry into a book
  appends it at the end (max order + 1).
- `REORDER_ENTRY { id, beforeId | null }` — reposition within a book.
- `SET_DIRECTORY_KIND { id, kind }` — promote/demote folder↔book.
- `ATTACH_NOTE { noteId, entryId }` / `DETACH_NOTE { noteId }`. Attaching also
  sets the note's `parentId` to the target entry's `parentId`, so display
  position (nested under the entry) and tree location never disagree.
  Detaching leaves the note in place as a sibling.

Creation: a new entry or note created inside a book appends at the end
(`max(order) + 1`); `newEntry()` gains a `kind` parameter.

## 2 · Library (sidebar)

One shared tree; genres distinguished by glyph, not color:

```
LIBRARY                       + entry · + note · +▾ (folder/book)
├─ 𝄃 Field Book               book: spine glyph, small-caps title
│   1  Morning walk      412w chapters numbered — order is real information
│   2  On hedgerows      883w
│   │   ✎ tone note           margin note, nested under its entry
│   3  Riverbank draft   201w
├─ ▸ Loose drafts             folder: chevron, A→Z as today
│     Quick capture      120w
└─ ✎ stray idea               free-floating note at root
```

- Chapter numbers render only inside books (order is user-controlled data).
- Notes attached to an entry render nested beneath it with a margin tick;
  unattached notes render like entries with the ✎ glyph.

**Drag and drop** — native HTML5 DnD:

- Drag ghost shows the row label.
- Container row under cursor highlights → drop *into* (move).
- Between rows inside a book: 1px accent insertion line → drop *at position*
  (reorder).
- Empty area below the tree → move to root. `Escape` cancels.
- `useDirectoryTree` orders book children by `order`; the filter behavior
  (query subtree pruning) is unchanged.

**Keyboard path** — every row gets a hover/focus-revealed `⋯` menu:
*move to…* (submenu of valid containers, own descendants excluded),
*make book / make folder* (directories), *attach to entry…* (notes),
*delete*. DnD is enhancement, not requirement.

**Creation**: `+ entry` and `+ note` create in the currently selected container
(the active entry's parent, else root). Folder/book creation lives in a `+▾`
menu. Buttons drop boxed borders and become delimited text actions.

## 3 · Editor: settings rail, passes (variants), margin notes

**Settings rail** — replaces the boxed selects in `Toolbar.tsx`; one quiet
line, coarse → fine, hairline-dot delimiters, no boxes:

```
register academic ▾ · scale sentence ▾ · reach ●──○── 0.50 ⓘ    seed · undo · [refine] · selection · passes · copy · export
```

- Selects are underline-on-hover text, styled natively (no custom dropdown).
- Temperature is relabeled **reach** in the UI (the API field stays
  `temperature`); the number remains visible.
- `ⓘ` opens a popover (shared `InfoPopover` component) explaining reach in
  plain language for nontechnical users; the passes chips reference the same
  popover.
- Order rationale: what voice → how much may change → how far it may stray.

**Passes (variants)** — chips in the draft-pane header, diff previewed in the
draft pane itself:

```
draft · passes:  ◦cool  ●warm  ◦hot   ⓘ     accept · →note · +chapter · dismiss
```

- Highlighting a chip (click / arrow keys) renders the pane as a word diff of
  *current draft → variant*: green insertions, red strikethrough removals.
  Reuses `diffWords` via a `VariantDiffView` (DiffView with ins/del coloring).
  The text is the preview — no cards.
- **accept** splices the highlighted variant in (draft history backs undo).
- **→ note** saves the variant as a new note entry attached to this entry
  (parent = same container).
- **+ chapter** appends the variant as a new chapter at the end of the entry's
  book; disabled (with reason on hover) when the entry is not in a book.
- **dismiss** clears the run. A failed pass renders a dimmed chip with a retry
  glyph; partial results stay usable (existing `{ variants, errors }` shape).
- Chip hover titles: "cool = closest to your wording · hot = boldest rewrite".

**Margin notes panel** — narrow toggleable column on the right edge of the
draft pane (overlay below `xl`): lists attached notes, each with *open*,
*detach*, and *include in refinement* (default on; stored per note as
`includeInRefinement?: boolean` on the note entry).

**Entry header** gains a breadcrumb: `Field Book / ch 2 of 5` — the visible
face of cross-interface awareness. Stat chips slim to a delimited line.

## 4 · Recording footer: the breath line (signature element)

The footer slims from a stacked panel to a single console strip (~72px).

- **Breath line**: one continuous horizontal filament across the footer's full
  width, threaded through the record button like a bead on a wire. Idle: faint
  ember line with a slow drifting pulse. Recording: live waveform drawn as a
  calligraphic stroke along the line (mirrored fill, amber glow). Stop: brief
  afterglow fade. One canvas; extends the existing `drawWaveform` pipeline.
- **Seal record button**: circular, fine double ring, amber core. While
  recording the core morphs to the stop square and the outer ring's glow tracks
  live `prosody.energy` — the button breathes with the voice.
- Everything around the signature gets quieter: prosody stats collapse to one
  delimited line (`pace 142 wpm · energy 62% · fluency 87% · density 54%`),
  status prose drops to one short line, voice-config popover unchanged.
- Retry/use-live-transcript affordances keep their current prominence (error
  states must not get quieter).
- Reduced motion: `prefers-reduced-motion` disables the idle pulse, ping, and
  afterglow; live waveform still draws (it is signal, not decoration).

## 5 · Context-fed refinement

New `src/lib/refineContext.ts`:

```ts
buildRefineContext(entry, entries, directories): string
```

- Assembles: book title + entry position ("chapter 2 of 5"), neighboring
  chapter titles with first sentences, attached margin notes marked *include*.
- Hard cap ~1,200 characters; truncates notes first, then neighbor summaries.
- Returns `''` for entries outside books with no notes.

`buildSystemPrompt`/`buildSelectionPrompt` accept the context block as an
optional final parameter, composed as guidance ("this passage is chapter 2
of…; the writer's notes request…"). With no context the output is
byte-identical to today — pinned by existing prompt tests. The
`prompt-composition-reviewer` agent reviews the `prompts.ts` change.

## 6 · Error handling

- Cycle guard in `MOVE_NODE` (reducer refuses; *move to…* never lists own
  descendants; DnD drop handler validates before dispatch).
- Migration is defensive: unknown `kind` values normalize to defaults; missing
  `order` backfilled deterministically.
- Variant diff/accept: variants are generated from a draft snapshot but accept
  splices against the **live** draft via the existing history push — if the
  user edited mid-generation, accept still applies cleanly as a full-text
  replace with undo available.
- `+ chapter` re-checks the entry's book membership at click time.
- Note routing failures (e.g., entry deleted mid-run) no-op with a visible
  message, never throw.

## 7 · Testing

- Migration v3 unit tests over legacy v2 fixtures (storage.test).
- Reducer tests: MOVE_NODE incl. cycle guard, REORDER_ENTRY, SET_DIRECTORY_KIND,
  ATTACH/DETACH_NOTE, delete-detaches-notes, cascade with books.
- `useDirectoryTree`: book ordering, note nesting, filter interaction.
- `refineContext`: cap, ordering, empty-context byte-identity of prompts.
- `VariantDiffView` component test: highlight → diff render → accept splices;
  routing actions dispatch correct creations.
- Keyboard-only walkthrough: move/reorder via ⋯ menu (testing-library).
- Existing 184 tests stay green; `npm run diagnostic` unaffected (no prosody
  math changes).

## Out of scope

- Command palette (declined during brainstorming).
- Genre/scale variant axes.
- Cross-book transclusion (an entry lives in exactly one place).
- Server/API changes — this pass is entirely frontend + prompt composition.
