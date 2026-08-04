#!/usr/bin/env node
// PostToolUse Bash hook — stamps .claude/state/last-npm-touch whenever
// claude runs `npm install|i|ci|update`. The guard-protected-files hook
// consults this marker to conditionally allow package-lock.json edits.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

const input = readInput()
const command = input?.tool_input?.command
if (typeof command !== 'string') process.exit(0)

// Match `npm install`, `npm i`, `npm ci`, `npm update` as whole words.
// Avoid matching substrings like `npm ignore-scripts` or `npm init`.
const NPM_TOUCH_RE = /(?:^|\s|&&|;|\|\|)npm\s+(install|i|ci|update)(?:\s|$)/
if (!NPM_TOUCH_RE.test(command)) process.exit(0)

const projectDir = input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const marker = resolve(projectDir, '.claude/state/last-npm-touch')

try {
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, String(Date.now()))
} catch {
  // Best-effort — failure here just means the guard stays strict.
}

process.exit(0)
