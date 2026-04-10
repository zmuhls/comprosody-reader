#!/usr/bin/env node
// PostToolUse hook — on Edit/Write/MultiEdit:
//   1. For each .ts/.tsx path touched, run eslint.
//   2. Once per invocation, run `tsc -b --noEmit` across all composite tsconfigs.
//
// ESLint's flat config (eslint.config.js) only matches **/*.{ts,tsx}, so
// running eslint on .js/.json/.md files would error. We filter first.
//
// The hook exits non-zero only when eslint or tsc actually fail, so Claude
// sees the error and can fix it before moving on.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

function extractPaths(input) {
  const toolInput = input?.tool_input ?? {}
  const paths = new Set()
  if (typeof toolInput.file_path === 'string') paths.add(toolInput.file_path)
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (typeof edit?.file_path === 'string') paths.add(edit.file_path)
    }
  }
  return [...paths]
}

const input = readInput()
const projectDir = input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const allPaths = extractPaths(input)
const tsPaths = allPaths.filter((p) => /\.(ts|tsx)$/.test(p))

// Skip entirely if the edit didn't touch any TS files.
if (tsPaths.length === 0) process.exit(0)

let failed = false

// 1. Lint each touched TS file individually. Fast feedback, scoped errors.
for (const p of tsPaths) {
  const res = spawnSync('npx', ['eslint', '--no-warn-ignored', p], {
    cwd: projectDir,
    stdio: 'inherit',
  })
  if (res.status !== 0) failed = true
}

// 2. Run the full composite typecheck once. Catches cross-file breaks in
//    tsconfig.app.json / tsconfig.node.json / server/tsconfig.json.
const tsc = spawnSync('npx', ['tsc', '-b', '--noEmit'], {
  cwd: projectDir,
  stdio: 'inherit',
})
if (tsc.status !== 0) failed = true

process.exit(failed ? 2 : 0)
