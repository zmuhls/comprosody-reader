#!/usr/bin/env node
// PreToolUse hook — guards .env* and package-lock.json from Claude edits.
//
// .env*           → hard block always (holds OPENROUTER_API_KEY)
// package-lock.json → block unless an npm install/i/ci/update ran in the last 60s
//                     (the stamp-npm-touch hook writes .claude/state/last-npm-touch)
// everything else → pass through silently.

import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const NPM_TOUCH_MAX_AGE_MS = 60_000

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

function extractPaths(input) {
  const toolInput = input?.tool_input ?? {}
  const paths = []
  if (typeof toolInput.file_path === 'string') paths.push(toolInput.file_path)
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (typeof edit?.file_path === 'string') paths.push(edit.file_path)
    }
  }
  return paths
}

function isEnvFile(name) {
  return name === '.env' || name.startsWith('.env.')
}

function isLockFile(name) {
  return name === 'package-lock.json'
}

function npmTouchFresh(projectDir) {
  const marker = resolve(projectDir, '.claude/state/last-npm-touch')
  try {
    const age = Date.now() - statSync(marker).mtimeMs
    return age >= 0 && age <= NPM_TOUCH_MAX_AGE_MS
  } catch {
    return false
  }
}

const input = readInput()
const projectDir = input?.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const paths = extractPaths(input)

for (const p of paths) {
  const name = basename(p)
  if (isEnvFile(name)) {
    process.stderr.write(
      `blocked: ${p} is a protected environment file. edit it manually outside claude.\n`,
    )
    process.exit(2)
  }
  if (isLockFile(name)) {
    if (!npmTouchFresh(projectDir)) {
      process.stderr.write(
        `blocked: ${p} cannot be edited directly. run 'npm install' (or npm i/ci/update) first; the edit will be allowed for 60s after.\n`,
      )
      process.exit(2)
    }
  }
}

process.exit(0)
