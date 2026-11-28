import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SNAPSHOT_KIND,
  SNAPSHOT_VERSION,
  parseStatusLines,
  parseUpstreamTrack,
  parseWorktreeList,
} from '../src/lib/local-snapshot'
import {
  KIND,
  VERSION,
  isEntryPoint,
  parseGitHubRemote,
  parseStatus,
  parseUpstreamTrack as standaloneUpstreamTrack,
  parseWorktreeList as standaloneWorktreeList,
  stripCredentials,
} from '../public/topology-snapshot.mjs'

// public/topology-snapshot.mjs is the generator users download and run, while
// src/lib/local-snapshot.ts holds the rules the page validates with. The two
// only stay in step if something compares them, so every shared parser is
// pinned here against the canonical module.

const WORKTREES = `worktree C:/work/polymarket-as-rust
HEAD 929a2f4ed0df2b95612db80a94d88a0045691845
branch refs/heads/main

worktree C:/work/bare
HEAD 1234567890abcdef
bare

worktree C:/work/detached
HEAD abcdef1234567890
detached
locked in use

worktree C:/work/my project
HEAD 1111222233334444
branch refs/heads/feat/spaced name
prunable
`

const STATUS = ' M src/strategy.rs\n?? notes/new.md\nA  src/lib.rs\nR  old/name.ts -> new/name.ts\nMM src/both.ts\n'

test('the standalone generator writes the snapshot kind and version the page accepts', () => {
  expect(KIND).toBe(SNAPSHOT_KIND)
  expect(VERSION).toBe(SNAPSHOT_VERSION)
})

test('the standalone generator parses worktree porcelain exactly like the page does', () => {
  expect(standaloneWorktreeList(WORKTREES)).toEqual(parseWorktreeList(WORKTREES))
  expect(standaloneWorktreeList('')).toEqual(parseWorktreeList(''))
})

test('the standalone generator parses ahead/behind exactly like the page does', () => {
  for (const track of ['', '[ahead 2]', '[behind 3]', '[ahead 2, behind 1]', '[gone]', 'not a track']) {
    expect(standaloneUpstreamTrack(track)).toEqual(parseUpstreamTrack(track))
  }
})

test('the standalone generator parses status lines exactly like the page does', () => {
  expect(parseStatus(STATUS)).toEqual(parseStatusLines(STATUS))
  expect(parseStatus('')).toEqual(parseStatusLines(''))
})

test('the standalone generator reads the same repositories out of the same remotes', () => {
  expect(parseGitHubRemote('https://github.com/owner/name.git')).toEqual({ owner: 'owner', name: 'name' })
  expect(parseGitHubRemote('git@github.com:owner/name.git')).toEqual({ owner: 'owner', name: 'name' })
  expect(parseGitHubRemote('https://github.com/owner/name')).toEqual({ owner: 'owner', name: 'name' })
  expect(parseGitHubRemote('https://gitlab.com/owner/name.git')).toBeNull()
  expect(parseGitHubRemote('')).toBeNull()
})

test('the entry-point guard runs the generator only for the generator itself', () => {
  const self = fileURLToPath(new URL('../public/topology-snapshot.mjs', import.meta.url))
  const other = fileURLToPath(new URL('../tests/standalone-snapshot.test.ts', import.meta.url))

  expect(isEntryPoint(self)).toBe(true)
  expect(isEntryPoint(other)).toBe(false)
  expect(isEntryPoint(undefined)).toBe(false)
})

// A shell can name a symbolic link while `import.meta.url` names the real file.
// If that difference counted as "not the entry point", the generator would exit
// silently and write nothing.
test('the entry-point guard still runs the generator through a symbolic link', () => {
  const self = fileURLToPath(new URL('../public/topology-snapshot.mjs', import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), 'topology-entry-'))
  const link = join(dir, 'linked-snapshot.mjs')
  try {
    symlinkSync(self, link, 'file')
  } catch {
    // Creating links needs a privilege this machine may not grant.
    rmSync(dir, { recursive: true, force: true })
    return
  }
  try {
    expect(isEntryPoint(link)).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the standalone generator never writes a credential into a snapshot', () => {
  expect(stripCredentials('https://user:ghp_secret@github.com/o/n.git')).toBe('https://github.com/o/n.git')
  expect(stripCredentials('git@github.com:o/n.git')).toBe('git@github.com:o/n.git')
  expect(stripCredentials(null)).toBeNull()
})
