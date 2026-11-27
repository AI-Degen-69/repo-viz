// Turns the RepoModel into a deterministic map of the repository's Git shape.
//
// Everything drawn on the canvas comes from this file, and everything in this
// file comes from RepoModel. Two rules keep it honest:
//
// 1. A branch only gets an exact fork point when its head SHA is one of the
//    commits we actually fetched for the default branch. That is a real fact
//    from the data, not a guess.
// 2. Every other branch is attached at a deterministic *approximate* point and
//    is drawn with a dashed connector and an "approx" label. GitHub's branch
//    list does not include a merge-base, so inventing one would be a lie.

import type { RepoModel, RepoPullRequest } from './repo'

export type TopologySelection =
  | { kind: 'branch'; name: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'pull'; number: number }

export type TopologyCommitNode = {
  id: string
  sha: string
  short: string
  message: string
  author: string
  date: string
  url: string
  x: number
  y: number
  isHead: boolean
}

export type TopologyBranchNode = {
  id: string
  name: string
  sha: string
  short: string
  side: -1 | 1
  forkX: number
  headX: number
  y: number
  exact: boolean
  protected: boolean
  prNumbers: number[]
  lastUpdate: string | null
  stale: boolean
  state: 'pr' | 'draft' | 'idle'
  // From a merged local snapshot only. GitHub has no ahead/behind per branch.
  upstream: string | null
  ahead: number
  behind: number
  local: boolean
}

export type TopologyPullTarget = {
  x: number
  y: number
  name: string
  known: boolean
}

export type TopologyPullNode = {
  id: string
  number: number
  pr: RepoPullRequest
  x: number
  y: number
  branch: string | null
  external: boolean
  target: TopologyPullTarget
}

export type TopologyEdge = {
  id: string
  d: string
  dashed: boolean
  branch?: string
  number?: number
}

export type TopologyHead = {
  x: number
  y: number
  name: string
  short: string
  message: string
  date: string
  protected: boolean
}

// A local checkout comes only from a snapshot. It is never implied by a
// GitHub map, and it is never the same thing as the remote HEAD or the
// viewing position.
export type TopologyCheckout = {
  id: string
  branch: string | null
  x: number
  y: number
  side: -1 | 0 | 1
  worktrees: number
  dirty: number
  ahead: number
}

export type TopologyLayout = {
  width: number
  height: number
  spineY: number
  startX: number
  endX: number
  defaultBranch: string
  head: TopologyHead
  commits: TopologyCommitNode[]
  branches: TopologyBranchNode[]
  pulls: TopologyPullNode[]
  branchEdges: TopologyEdge[]
  pullEdges: TopologyEdge[]
  checkouts: TopologyCheckout[]
  historyKnown: boolean
  // True when the repository holds more branches than the readable subset.
  collapsible: boolean
  hiddenBranches: number
  hiddenPulls: number
  counts: {
    branches: number
    pulls: number
    approximate: number
  }
}

export type TopologyOptions = {
  // Progressive disclosure: large repositories start with a readable subset
  // and the canvas offers to draw the rest on request.
  expanded?: boolean
}

const LANE_ROOMY = 88
const LANE_DENSE = 64
const LANE_OFFSET = 120
const BRANCH_RUN = 236
const COMMIT_GAP = 138
const TIMELINE_START = 224
const RIGHT_ROOM = 120
const VISIBLE_BRANCHES = 18
const DENSE_AFTER = 12
const MAX_PULL_MARKERS = 2
const STALE_MS = 30 * 86_400_000

const shortSha = (sha: string) => (sha ? sha.slice(0, 7) : '—')

// The branch leaves the spine with a short curve, then runs to its head.
function branchPath(forkX: number, spineY: number, laneY: number, headX: number): string {
  const shoulder = forkX + 86
  return `M ${forkX} ${spineY} C ${forkX + 38} ${spineY}, ${forkX + 42} ${laneY}, ${shoulder} ${laneY} L ${headX} ${laneY}`
}

// A pull request points back at the branch it targets.
function pullPath(fromX: number, fromY: number, toX: number, toY: number): string {
  const span = Math.abs(fromX - toX)
  const bend = Math.max(36, Math.min(150, span * 0.4))
  return `M ${fromX} ${fromY} C ${fromX - bend} ${fromY}, ${toX + bend} ${toY}, ${toX} ${toY}`
}

// A branch's label sits to the right of its head. Reserving room for the
// longest visible name keeps labels inside the canvas instead of clipping.
function labelRoom(name: string): number {
  return Math.min(268, 78 + name.length * 6.3)
}

const normalizeHead = (head: string) => (head.includes(':') ? head.slice(head.indexOf(':') + 1) : head)

export function layoutTopology(repo: RepoModel, options: TopologyOptions = {}): TopologyLayout {
  const now = Date.now()
  const pullsByNumber = new Map<number, RepoPullRequest>(repo.pullRequests.map((pull) => [pull.number, pull]))

  // repo.commits arrives newest first; the timeline reads oldest to newest.
  const ordered = [...repo.commits].reverse()
  const defaultNode =
    repo.branches.find((branch) => branch.isDefault) ?? repo.branches.find((branch) => branch.name === repo.defaultBranch)
  const defaultBranch = defaultNode?.name ?? repo.defaultBranch ?? 'main'

  const span = Math.max((ordered.length - 1) * COMMIT_GAP, 640)
  const startX = TIMELINE_START
  const endX = startX + span

  const headSha = defaultNode?.sha || ordered[ordered.length - 1]?.sha || ''
  const headCommit = ordered.find((commit) => commit.sha === headSha) ?? ordered[ordered.length - 1]

  const commitX = (index: number) => (ordered.length <= 1 ? endX : startX + index * COMMIT_GAP)
  const commits: TopologyCommitNode[] = ordered.map((commit, index) => ({
    id: `commit:${commit.sha}`,
    sha: commit.sha,
    short: shortSha(commit.sha),
    message: commit.message || 'No commit message',
    author: commit.author,
    date: commit.date,
    url: commit.url,
    x: commitX(index),
    y: 0,
    isHead: index === ordered.length - 1,
  }))

  const commitBySha = new Map(commits.map((commit) => [commit.sha, commit]))

  // Order branches by activity first so the readable subset is the useful one.
  const activity = (branch: { pullRequests: number[] }): number => {
    const pulls = branch.pullRequests
      .map((number) => pullsByNumber.get(number))
      .filter((pull): pull is RepoPullRequest => Boolean(pull))
    return pulls.length === 0 ? 0 : Math.max(...pulls.map((pull) => Date.parse(pull.updatedAt) || 0))
  }

  const othersAll = repo.branches
    .filter((branch) => branch.name !== defaultBranch)
    .slice()
    .sort((a, b) => {
      const byPulls = b.pullRequests.length - a.pullRequests.length
      if (byPulls !== 0) return byPulls
      const byActivity = activity(b) - activity(a)
      if (byActivity !== 0) return byActivity
      return a.name.localeCompare(b.name)
    })

  const expanded = Boolean(options.expanded)
  const limit = expanded ? othersAll.length : VISIBLE_BRANCHES
  const visible = othersAll.slice(0, limit)
  const hidden = othersAll.slice(limit)
  const hiddenPulls = hidden.reduce((total, branch) => total + branch.pullRequests.length, 0)

  const rowsPerSide = Math.max(Math.ceil(visible.length / 2), 1)
  const laneGap = rowsPerSide > DENSE_AFTER ? LANE_DENSE : LANE_ROOMY
  const room = visible.length === 0 ? 0 : LANE_OFFSET + (rowsPerSide - 1) * laneGap
  const height = Math.max(660, room * 2 + 300)
  const spineY = Math.round(height / 2)

  for (const commit of commits) commit.y = spineY

  const branches: TopologyBranchNode[] = visible.map((branch, index) => {
    const match = branch.sha ? commitBySha.get(branch.sha) : undefined
    const exact = Boolean(match)
    // Deterministic stand-in for an unknown merge-base: newer branches (the
    // ones with pull requests, which the model orders first) sit further right.
    const fraction = visible.length <= 1 ? 0.8 : 0.86 - (0.56 * index) / (visible.length - 1)
    const forkX = match ? match.x : Math.round(startX + fraction * span)
    const headX = Math.max(forkX + BRANCH_RUN, startX + 150)
    const side: -1 | 1 = index % 2 === 0 ? -1 : 1
    const lane = Math.floor(index / 2) + 1
    const y = spineY + side * (LANE_OFFSET + (lane - 1) * laneGap)

    const prNumbers = branch.pullRequests.filter((number) => pullsByNumber.has(number))
    const pulls = prNumbers.map((number) => pullsByNumber.get(number)!).sort((a, b) => a.number - b.number)
    const lastUpdate = pulls
      .map((pull) => pull.updatedAt)
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    const draft = pulls.length > 0 && pulls.every((pull) => pull.draft)

    return {
      id: `branch:${branch.name}`,
      name: branch.name,
      sha: branch.sha,
      short: shortSha(branch.sha),
      side,
      forkX,
      headX,
      y,
      exact,
      protected: branch.protected,
      prNumbers,
      lastUpdate: lastUpdate ?? null,
      stale: Boolean(lastUpdate) && now - Date.parse(lastUpdate!) > STALE_MS,
      state: pulls.length === 0 ? 'idle' : draft ? 'draft' : 'pr',
      upstream: branch.upstream ?? null,
      ahead: branch.ahead ?? 0,
      behind: branch.behind ?? 0,
      local: Boolean(repo.local),
    }
  })

  const branchByName = new Map(branches.map((branch) => [branch.name, branch]))
  const knownBranchNames = new Set(repo.branches.map((branch) => branch.name))

  const pulls: TopologyPullNode[] = []
  const pullEdges: TopologyEdge[] = []

  const targetFor = (pr: RepoPullRequest): TopologyPullTarget => {
    if (pr.base === defaultBranch) {
      return { x: endX, y: spineY, name: defaultBranch, known: true }
    }
    const target = branchByName.get(pr.base)
    if (target) return { x: target.headX, y: target.y, name: target.name, known: true }
    // The PR names a base branch that is not drawn here. Keep the link on the
    // spine and say the target is not on this canvas.
    return { x: endX, y: spineY, name: pr.base || 'unknown branch', known: false }
  }

  for (const branch of branches) {
    const branchPulls = branch.prNumbers
      .map((number) => pullsByNumber.get(number)!)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      // Two markers per branch keep the canvas readable. The count of the rest
      // is shown as "+N"; no edge is drawn to a marker that does not exist.
      .slice(0, MAX_PULL_MARKERS)

    branchPulls.forEach((pr, slot) => {
      const x = branch.headX + 16
      const y = branch.y - branch.side * (32 + slot * 28)
      const target = targetFor(pr)
      pulls.push({
        id: `pull:${pr.number}`,
        number: pr.number,
        pr,
        x,
        y,
        branch: branch.name,
        external: false,
        target,
      })
      pullEdges.push({
        id: `pull-target:${pr.number}`,
        d: pullPath(x - 6, y, target.x, target.y),
        dashed: true,
        number: pr.number,
      })
    })
  }

  // A PR whose head branch is not in this repository at all (a fork) has no
  // branch to attach to. It hangs off its target on the spine, labelled as a
  // fork. PRs from branches hidden by progressive disclosure are not drawn;
  // they are counted in the hidden chip instead.
  const attached = new Set(branches.flatMap((branch) => branch.prNumbers))
  const externalPulls = repo.pullRequests
    .filter((pull) => !attached.has(pull.number) && !knownBranchNames.has(normalizeHead(pull.head)))
    .slice(0, 3)

  externalPulls.forEach((pr, slot) => {
    const x = endX + 30
    const y = spineY - 126 - slot * 34
    const target = targetFor(pr)
    pulls.push({
      id: `pull:${pr.number}`,
      number: pr.number,
      pr,
      x,
      y,
      branch: null,
      external: true,
      target,
    })
    pullEdges.push({
      id: `pull-target:${pr.number}`,
      d: `M ${endX} ${spineY} C ${endX + 24} ${spineY}, ${x + 18} ${y}, ${x - 6} ${y}`,
      dashed: true,
      number: pr.number,
    })
  })

  const branchEdges: TopologyEdge[] = branches.map((branch) => ({
    id: `branch-edge:${branch.name}`,
    d: branchPath(branch.forkX, spineY, branch.y, branch.headX),
    dashed: !branch.exact,
    branch: branch.name,
  }))

  // Local checkouts come from the snapshot, grouped per branch. A worktree is
  // never inferred from a GitHub map.
  const checkouts: TopologyCheckout[] = []
  if (repo.local) {
    const byBranch = new Map<string, TopologyCheckout>()
    for (const worktree of repo.local.worktrees) {
      if (worktree.bare) continue
      const branch = worktree.branch
      if (branch && branch !== defaultBranch) {
        const node = branchByName.get(branch)
        if (!node) continue
        const existing = byBranch.get(branch)
        if (existing) {
          existing.worktrees += 1
          existing.dirty += worktree.dirty
          existing.ahead = Math.max(existing.ahead, worktree.ahead)
        } else {
          byBranch.set(branch, {
            id: `checkout:${branch}`,
            branch,
            x: node.headX,
            y: node.y,
            side: node.side,
            worktrees: 1,
            dirty: worktree.dirty,
            ahead: worktree.ahead,
          })
        }
        continue
      }
      // The default branch, or a detached worktree, is marked on the spine.
      const x = branch === defaultBranch ? Math.min(endX - 24, startX + span * 0.62) : endX + 30
      const existing = checkouts.find((checkout) => checkout.x === x && checkout.branch === branch)
      if (existing) {
        existing.worktrees += 1
        existing.dirty += worktree.dirty
        existing.ahead = Math.max(existing.ahead, worktree.ahead ?? 0)
      } else {
        checkouts.push({
          id: `checkout:${branch ?? worktree.head ?? worktree.path}`,
          branch,
          x,
          y: spineY,
          side: 0,
          worktrees: 1,
          dirty: worktree.dirty,
          ahead: worktree.ahead ?? 0,
        })
      }
    }
    checkouts.push(...byBranch.values())
  }

  const labelWidest = Math.max(
    0,
    ...branches.map((branch) => labelRoom(branch.name)),
    checkouts.length > 0 ? 240 : 0,
  )
  const farthest = Math.max(endX, ...branches.map((branch) => branch.headX), ...pulls.map((pull) => pull.x))

  return {
    width: Math.round(farthest + Math.max(RIGHT_ROOM, labelWidest)),
    height,
    spineY,
    startX,
    endX,
    defaultBranch,
    head: {
      x: endX,
      y: spineY,
      name: defaultBranch,
      short: shortSha(headSha),
      message: headCommit?.message ?? 'No commit history available',
      date: headCommit?.date ?? repo.pushedAt ?? '',
      protected: Boolean(defaultNode?.protected),
    },
    commits,
    branches,
    pulls,
    branchEdges,
    pullEdges,
    checkouts,
    historyKnown: ordered.length > 0,
    collapsible: othersAll.length > VISIBLE_BRANCHES,
    hiddenBranches: hidden.length,
    hiddenPulls,
    counts: {
      branches: repo.branches.length,
      pulls: repo.pullRequests.length,
      approximate: branches.filter((branch) => !branch.exact).length,
    },
  }
}

export function branchUrl(repo: RepoModel, branch: string): string {
  if (!repo.htmlUrl) return ''
  return `${repo.htmlUrl}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`
}
