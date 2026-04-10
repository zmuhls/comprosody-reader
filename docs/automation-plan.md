# Claude Code automation plan

This document records the Claude Code automations wired into this repo, why they exist, and how to verify them. It is checked in so every teammate (and every future Claude session) inherits the same guardrails without setup.

## Context

The stack — React 19, Vite 6, Tailwind v4 with `@theme`, Express 5, Vitest 4, strict composite TypeScript — has enough sharp edges that targeted automations pay off immediately. The domain-specific prosody math layer in `src/lib/comprosody.ts` and the four-dimension prompt composition in `src/lib/prompts.ts` are load-bearing and easy to regress silently. These automations exist to catch the cases that unit tests miss and to put live documentation for bleeding-edge libraries within reach.

## What was added

### MCP servers — `.mcp.json`

Two servers are registered at repo root so they auto-configure for anyone who opens the project in Claude Code:

- **context7** (`@upstash/context7-mcp`) — live documentation lookup. Essential because training data for React 19, Tailwind v4 `@theme`, Vite 6, and Vitest 4 is thin.
- **playwright** (`@playwright/mcp`) — browser automation for end-to-end coverage of the recording pipeline in `src/components/layout/MainPanel.tsx`, where four hooks share one `MediaStream`. This is the class of bug that hides from unit tests.

### Hooks — `.claude/settings.json` + `.claude/hooks/*.mjs`

Three hook scripts, kept in `.mjs` files rather than inlined in JSON so they can parse Claude's stdin payload and branch cleanly:

- **`guard-protected-files.mjs`** (PreToolUse) — hard-blocks edits to `.env*` (which hold `OPENROUTER_API_KEY`). Blocks `package-lock.json` edits *unless* an `npm install/i/ci/update` ran in the last 60 seconds. The marker is written to `.claude/state/last-npm-touch` (gitignored).
- **`stamp-npm-touch.mjs`** (PostToolUse Bash) — watches for `npm install`-family commands and stamps the marker file the guard consults.
- **`typecheck-lint.mjs`** (PostToolUse Edit/Write/MultiEdit) — for each `.ts`/`.tsx` file touched, runs `eslint`. Once per invocation, runs `tsc -b --noEmit` across all three composite tsconfigs (`tsconfig.app.json`, `tsconfig.node.json`, `server/tsconfig.json`). Skips non-TS files because `eslint.config.js` only matches `**/*.{ts,tsx}`.

### Skill — `.claude/skills/prosody-diagnostic/SKILL.md`

User-invocable (`disable-model-invocation: true`). Runs `npm run diagnostic` and parses its output as a regression report. The underlying `scripts/prosody-pipeline-diagnostic.ts` exits 0 even on regressions, so the skill parses `FINDING:` lines, label flips, and density drift rather than trusting the exit code. Use after changes to `src/lib/comprosody.ts`, `src/lib/prompts.ts`, or the diagnostic script itself.

### Subagents — `.claude/agents/`

Two domain-specific reviewers, both using `sonnet`:

- **`prosody-math-reviewer`** — triggered on edits to `src/lib/comprosody.ts`. Guards the magic constants (×3 energy scaling, function-word set, interpretation thresholds) and cross-references changes against the archetype baselines in the diagnostic script.
- **`prompt-composition-reviewer`** — triggered on edits to `src/lib/prompts.ts`. Traces every branch of `buildSystemPrompt` and `buildSelectionPrompt` across the genre × scale × prosody × voice-config composition, checking for rule collisions, missing implication-table entries, and silent token-budget growth.

## Verification

After checkout:

```bash
# Baseline — the hook invokes the same commands, so these must be green.
npm run lint
npm run build
npm run diagnostic

# MCP discovery — in a fresh claude session:
claude mcp list   # expect context7 and playwright
```

To smoke-test the hooks:

- Make a trivial edit to any `.ts` file — the PostToolUse hook should run eslint + tsc automatically.
- Ask Claude to edit `.env` — expect a hard block with a clear stderr message.
- Ask Claude to edit `package-lock.json` directly — expect a block. Then run `npm install` and retry within 60 seconds — expect the edit to succeed.

## Files

```
.mcp.json
.claude/
├── settings.json
├── settings.local.json          # gitignored, per-user
├── hooks/
│   ├── guard-protected-files.mjs
│   ├── stamp-npm-touch.mjs
│   └── typecheck-lint.mjs
├── skills/
│   └── prosody-diagnostic/
│       └── SKILL.md
├── agents/
│   ├── prosody-math-reviewer.md
│   └── prompt-composition-reviewer.md
└── state/                       # gitignored, runtime markers
docs/
└── automation-plan.md           # this file
```
