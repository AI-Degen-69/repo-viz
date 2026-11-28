// The local scanner writes this envelope and the page reads it back. The kind
// and version travel in the file so a stray JSON document fails with a sentence
// instead of painting a broken map.

import type { RepoModel } from './repo'

export const SNAPSHOT_KIND = 'topology-local-snapshot'
export const SNAPSHOT_VERSION = 1

export type SnapshotFile = {
  kind: typeof SNAPSHOT_KIND
  version: number
  repo: RepoModel
}

export type ParsedWorktree = {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  bare: boolean
  locked: string | null
  prunable: boolean
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}

export function snapshotFile(repo: RepoModel): SnapshotFile {
  return { kind: SNAPSHOT_KIND, version: SNAPSHOT_VERSION, repo }
}

const sameName = (a: RepoModel, b: RepoModel) => a.fullName.trim().toLowerCase() === b.fullName.trim().toLowerCase()

// A snapshot describes a clone, while the map may already describe the GitHub
// repository of the same name. Combining them keeps one identity and one set
// of counts: remote branches keep their GitHub facts, local facts are attached
// where the branch names actually line up, and branches that exist only in the
// clone are added explicitly.
export function mergeLocalSnapshot(remote: RepoModel, snapshot: RepoModel): RepoModel {
  if (!sameName(remote, snapshot)) {
    throw new SnapshotError(
      `That snapshot belongs to ${snapshot.fullName}, but this map shows ${remote.fullName}. Load it on its own map instead.`,
    )
  }

  const localBranches = new Map(snapshot.branches.map((branch) => [branch.name, branch]))
  const branches = remote.branches.map((branch) => {
    const local = localBranches.get(branch.name)
    if (!local) return branch
    return {
      ...branch,
      upstream: local.upstream ?? null,
      ahead: local.ahead ?? 0,
      behind: local.behind ?? 0,
    }
  })
  const remoteNames = new Set(branches.map((branch) => branch.name))
  for (const branch of snapshot.branches) {
    if (!remoteNames.has(branch.name)) branches.push({ ...branch, isDefault: false, pullRequests: [] })
  }

  return {
    ...remote,
    branches,
    local: snapshot.local,
  }
}

export type SnapshotSummary = {
  fullName: string
  root: string
  scannedAt: string
  branches: number
  worktrees: number
  checkout: string | null
  detached: boolean
  modifiedFiles: number
  unpushedCommits: number
  remote: string | null
}

// The five facts the upload panel shows back to the user. Everything comes from
// the parsed snapshot, so a mismatched file cannot borrow another repo's names.
export function summarizeSnapshot(repo: RepoModel): SnapshotSummary {
  const local = repo.local
  const primary = local?.worktrees.find((worktree) => !worktree.bare) ?? local?.worktrees[0] ?? null
  return {
    fullName: repo.fullName,
    root: local?.root ?? '',
    scannedAt: local?.scannedAt ?? '',
    branches: repo.branches.length,
    worktrees: local?.worktrees.length ?? 0,
    checkout: primary?.branch ?? null,
    detached: Boolean(primary?.detached),
    modifiedFiles: local?.worktrees.reduce((total, worktree) => total + worktree.dirty, 0) ?? 0,
    unpushedCommits: repo.branches.reduce((total, branch) => total + (branch.ahead ?? 0), 0),
    remote: local?.upstream ?? null,
  }
}

// git worktree list --porcelain prints blank-line separated blocks:
//   worktree <path> / HEAD <sha> / branch refs/heads/<name> / bare / detached
//   / locked [reason] / prunable
export function parseWorktreeList(text: string): ParsedWorktree[] {
  const worktrees: ParsedWorktree[] = []
  let current: ParsedWorktree | null = null

  const flush = () => {
    if (current) worktrees.push(current)
    current = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      current = {
        path: line.slice('worktree '.length).trim(),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: null,
        prunable: false,
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length).trim() || null
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    else if (line === 'detached') current.detached = true
    else if (line === 'bare') current.bare = true
    else if (line === 'prunable') current.prunable = true
    else if (line.startsWith('locked')) current.locked = line.slice('locked'.length).trim() || 'locked'
  }
  flush()

  return worktrees
}

// %(upstream:track) prints "", "[ahead 2]", "[behind 3]", "[ahead 2, behind 1]"
// or "[gone]".
export function parseUpstreamTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const value = track.trim()
  if (!value) return { ahead: 0, behind: 0, gone: false }
  if (value.includes('gone')) return { ahead: 0, behind: 0, gone: true }

  const ahead = Number(value.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(value.match(/behind (\d+)/)?.[1] ?? 0)
  return { ahead, behind, gone: false }
}

// git status --porcelain lines start with a two-character status code.
export function parseStatusLines(text: string): { path: string; status: string }[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim()
      const path = line.slice(3).trim()
      return { path, status: status || '??' }
    })
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseSnapshotFile(text: string): RepoModel {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SnapshotError('That file is not valid JSON.')
  }

  if (!isObject(parsed)) throw new SnapshotError('That JSON does not contain a Topology snapshot.')
  if (parsed.kind !== SNAPSHOT_KIND) {
    throw new SnapshotError('That JSON is not a Topology snapshot. Run "bun run snapshot <path>" to make one.')
  }
  if (typeof parsed.version !== 'number' || parsed.version > SNAPSHOT_VERSION) {
    throw new SnapshotError('That snapshot was written by a newer scanner. Update this page and try again.')
  }

  const repo = parsed.repo
  if (!isObject(repo)) throw new SnapshotError('That snapshot has no repository data.')

  for (const key of ['owner', 'name', 'fullName', 'defaultBranch'] as const) {
    if (typeof repo[key] !== 'string' || !repo[key]) {
      throw new SnapshotError(`That snapshot is missing "${key}".`)
    }
  }
  for (const key of ['branches', 'pullRequests', 'languages', 'contributors', 'commits', 'commitActivity'] as const) {
    if (!Array.isArray(repo[key])) throw new SnapshotError(`That snapshot is missing the "${key}" list.`)
  }
  if (!isObject(repo.local) || !Array.isArray(repo.local.worktrees) || !Array.isArray(repo.local.dirtyFiles)) {
    throw new SnapshotError('That snapshot has no local worktree data. Is it a GitHub map instead?')
  }

  // Every worktree is read by the canvas; a malformed entry would paint a
  // broken marker instead of an honest error.
  const worktrees = repo.local.worktrees
  if (!worktrees.every((worktree) => isObject(worktree) && typeof worktree.path === 'string')) {
    throw new SnapshotError('That snapshot has a malformed worktree entry. Re-run the generator to make a new one.')
  }

  // Every branch is read too: the canvas takes the name and the pull-request
  // numbers straight off each entry, so a malformed one throws mid-draw instead
  // of failing here with a sentence.
  const branches = repo.branches
  if (
    !Array.isArray(branches) ||
    !branches.every(
      (branch) => isObject(branch) && typeof branch.name === 'string' && Array.isArray(branch.pullRequests),
    )
  ) {
    throw new SnapshotError('That snapshot has a malformed branch entry. Re-run the generator to make a new one.')
  }

  return repo as unknown as RepoModel
}
