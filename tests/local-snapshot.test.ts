import { expect, test } from 'bun:test'

import {
  mergeLocalSnapshot,
  parseSnapshotFile,
  parseStatusLines,
  parseUpstreamTrack,
  parseWorktreeList,
  snapshotFile,
  SnapshotError,
} from '../src/lib/local-snapshot'
import { describeRepo, SAMPLE_REPO, type RepoModel } from '../src/lib/repo'

const WORKTREES = `worktree C:/work/polymarket-as-rust
HEAD 929a2f4ed0df2b95612db80a94d88a0045691845
branch refs/heads/main

worktree C:/work/worktrees/polymarket-as-rust/entry_selection_adverse_trend
HEAD 929a2f4ed0df2b95612db80a94d88a0045691845
branch refs/heads/entry_selection_adverse_trend

worktree C:/work/bare
HEAD 1234567890abcdef
bare

worktree C:/work/detached
HEAD abcdef1234567890
detached
locked in use
`

const localRepo = (): RepoModel => ({
  ...SAMPLE_REPO,
  pullRequests: [],
  branches: [
    {
      name: 'main',
      sha: '929a2f4ed0df2b95612db80a94d88a0045691845',
      isDefault: true,
      protected: false,
      pullRequests: [],
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
    },
    {
      name: 'entry_selection_adverse_trend',
      sha: '929a2f4ed0df2b95612db80a94d88a0045691845',
      isDefault: false,
      protected: false,
      pullRequests: [],
      upstream: null,
      ahead: 0,
      behind: 0,
    },
  ],
  commits: [
    {
      sha: '929a2f4ed0df2b95612db80a94d88a0045691845',
      message: 'Tighten entry selection',
      author: 'Ada',
      avatarUrl: '',
      date: '2026-11-25T10:00:00Z',
      url: 'https://github.com/octo-labs/polymarket-as-rust/commit/929a2f4',
    },
  ],
  commitActivity: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5],
  local: {
    scannedAt: '2026-11-26T09:00:00.000Z',
    root: 'C:\\work\\polymarket-as-rust',
    upstream: 'origin/main',
    stashes: 1,
    dirtyFiles: [{ path: 'src/strategy.rs', status: 'M' }],
    worktrees: [
      {
        path: 'C:\\work\\polymarket-as-rust',
        branch: 'main',
        head: '929a2f4ed0df2b95612db80a94d88a0045691845',
        detached: false,
        bare: false,
        locked: null,
        prunable: false,
        dirty: 1,
        files: [{ path: 'src/strategy.rs', status: 'M' }],
        ahead: 0,
        behind: 0,
        lastCommit: '2026-11-25T10:00:00Z',
      },
      {
        path: 'C:\\work\\worktrees\\polymarket-as-rust\\entry_selection_adverse_trend',
        branch: 'entry_selection_adverse_trend',
        head: '929a2f4ed0df2b95612db80a94d88a0045691845',
        detached: false,
        bare: false,
        locked: null,
        prunable: false,
        dirty: 0,
        files: [],
        ahead: 0,
        behind: 0,
        lastCommit: '2026-11-25T10:00:00Z',
      },
    ],
  },
})

test('parseWorktreeList reads paths, branches, bare, detached and locked', () => {
  const worktrees = parseWorktreeList(WORKTREES)

  expect(worktrees).toHaveLength(4)
  expect(worktrees[0]).toMatchObject({
    path: 'C:/work/polymarket-as-rust',
    branch: 'main',
    detached: false,
    bare: false,
    locked: null,
  })
  expect(worktrees[1]?.branch).toBe('entry_selection_adverse_trend')
  expect(worktrees[2]?.bare).toBe(true)
  expect(worktrees[3]).toMatchObject({ detached: true, locked: 'in use', branch: null })
})

test('parseUpstreamTrack reads ahead, behind, both and gone', () => {
  expect(parseUpstreamTrack('')).toEqual({ ahead: 0, behind: 0, gone: false })
  expect(parseUpstreamTrack('[ahead 2]')).toEqual({ ahead: 2, behind: 0, gone: false })
  expect(parseUpstreamTrack('[behind 3]')).toEqual({ ahead: 0, behind: 3, gone: false })
  expect(parseUpstreamTrack('[ahead 2, behind 1]')).toEqual({ ahead: 2, behind: 1, gone: false })
  expect(parseUpstreamTrack('[gone]')).toEqual({ ahead: 0, behind: 0, gone: true })
})

test('parseStatusLines keeps the status code and the path', () => {
  const files = parseStatusLines(' M src/strategy.rs\n?? notes/new.md\nA  src/lib.rs\n')

  expect(files).toEqual([
    { path: 'src/strategy.rs', status: 'M' },
    { path: 'notes/new.md', status: '??' },
    { path: 'src/lib.rs', status: 'A' },
  ])
})

test('a snapshot round-trips and keeps the local block', () => {
  const repo = localRepo()
  const parsed = parseSnapshotFile(JSON.stringify(snapshotFile(repo)))

  expect(parsed.fullName).toBe('acme-labs/atlas')
  expect(parsed.pullRequests).toEqual([])
  expect(parsed.local?.worktrees).toHaveLength(2)
  expect(parsed.local?.dirtyFiles[0]?.path).toBe('src/strategy.rs')
  expect(parsed.local?.worktrees[0]?.files[0]?.path).toBe('src/strategy.rs')
  expect(parsed.branches[1]?.upstream).toBeNull()
})

test('a local snapshot describes worktrees and never claims pull requests', () => {
  const { sentences, attention } = describeRepo(localRepo())
  const text = sentences.join(' ')

  expect(text).toContain('2 local worktrees')
  expect(text).toContain('1 branch tracks an upstream')
  expect(text).toContain('1 uncommitted file')
  expect(text.toLowerCase()).not.toContain('pull request')
  expect(attention).toContain('1 worktree has uncommitted changes.')
  expect(attention).toContain('1 stash waiting to be applied.')
})

test('parseSnapshotFile rejects files that are not local snapshots', () => {
  expect(() => parseSnapshotFile('not json')).toThrow(SnapshotError)
  expect(() => parseSnapshotFile('{}')).toThrow('not a Topology snapshot')
  expect(() => parseSnapshotFile(JSON.stringify({ kind: 'topology-local-snapshot', version: 99, repo: {} }))).toThrow(
    'newer scanner',
  )
  expect(() =>
    parseSnapshotFile(JSON.stringify({ kind: 'topology-local-snapshot', version: 1, repo: { ...SAMPLE_REPO } })),
  ).toThrow('no local worktree data')
})

test('parseSnapshotFile rejects a snapshot missing required lists', () => {
  const broken = { ...localRepo(), branches: undefined }
  expect(() =>
    parseSnapshotFile(JSON.stringify({ kind: 'topology-local-snapshot', version: 1, repo: broken })),
  ).toThrow('branches')
})

// The canvas reads a branch's name and its pull-request numbers directly. A
// branch entry that lacks them would throw while painting, so the gate has to
// refuse it here and say so.
test('parseSnapshotFile rejects a branch entry the canvas cannot draw', () => {
  const wrap = (branches: unknown) =>
    JSON.stringify({ kind: 'topology-local-snapshot', version: 1, repo: { ...localRepo(), branches } })
  const branch = { name: 'main', sha: 'abc', isDefault: true, protected: false, pullRequests: [] }

  expect(() => parseSnapshotFile(wrap([{ ...branch, pullRequests: undefined }]))).toThrow('malformed branch entry')
  expect(() => parseSnapshotFile(wrap([{ ...branch, name: undefined }]))).toThrow('malformed branch entry')
  expect(() => parseSnapshotFile(wrap([null]))).toThrow('malformed branch entry')

  expect(parseSnapshotFile(wrap([branch])).branches).toEqual([branch])
})

// A merge keeps the GitHub facts, so a list that stopped at the page cap has to
// stay marked as a floor once the local checkout is layered on top.
test('a capped list keeps its floor marks after a snapshot merge', () => {
  const merged = mergeLocalSnapshot({ ...SAMPLE_REPO, truncated: { branches: true, pullRequests: true } }, localRepo())

  expect(merged.truncated).toEqual({ branches: true, pullRequests: true })

  const text = describeRepo(merged).sentences.join(' ')
  expect(text).toContain('+ branches across')
  expect(text).toContain('+ open pull requests are still on GitHub')
})
