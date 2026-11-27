// One shape for the whole product. The Worker fills it from the GitHub API,
// the map reads it, and the sample uses the same fields. The UI never derives
// Git facts from anything else.

export type RepoBranch = {
  name: string
  sha: string
  isDefault: boolean
  protected: boolean
  pullRequests: number[]
  // Filled only by the local scanner. GitHub has no equivalent here.
  upstream?: string | null
  ahead?: number
  behind?: number
}

export type RepoPullRequest = {
  number: number
  title: string
  author: string
  avatarUrl: string
  head: string
  base: string
  draft: boolean
  createdAt: string
  updatedAt: string
  url: string
  comments: number
  labels: { name: string; color: string }[]
}

export type RepoLanguage = { name: string; bytes: number; percent: number }
export type RepoContributor = { login: string; avatarUrl: string; contributions: number; url: string }
export type RepoCommit = { sha: string; message: string; author: string; avatarUrl: string; date: string; url: string }

export type RepoWorktree = {
  path: string
  branch: string | null
  head: string | null
  detached: boolean
  bare: boolean
  locked: string | null
  prunable: boolean
  dirty: number
  files: LocalDirtyFile[]
  ahead: number
  behind: number
  lastCommit: string | null
}

export type LocalDirtyFile = { path: string; status: string }

// Present only when the page was given a snapshot written by the local scanner.
// It carries the facts GitHub cannot see: checkouts, dirty files, upstream drift.
export type LocalSnapshot = {
  scannedAt: string
  root: string
  upstream: string | null
  stashes: number
  dirtyFiles: LocalDirtyFile[]
  worktrees: RepoWorktree[]
}

export type RepoModel = {
  owner: string
  name: string
  fullName: string
  description: string | null
  htmlUrl: string
  homepage: string | null
  avatarUrl: string
  stars: number
  forks: number
  watchers: number
  openIssues: number
  language: string | null
  license: string | null
  topics: string[]
  defaultBranch: string
  createdAt: string
  pushedAt: string | null
  sizeKb: number
  archived: boolean
  fork: boolean
  isPrivate: boolean
  cloneUrl: string
  branches: RepoBranch[]
  pullRequests: RepoPullRequest[]
  languages: RepoLanguage[]
  contributors: RepoContributor[]
  commits: RepoCommit[]
  commitActivity: number[]
  local?: LocalSnapshot
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function compact(value: number): string {
  return compactNumber.format(value)
}

export function timeAgo(value: string | null): string {
  if (!value) return 'never'
  const then = Date.parse(value)
  if (Number.isNaN(then)) return 'unknown'
  const seconds = Math.round((then - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (abs >= size) return relativeTime.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function initials(login: string): string {
  const clean = login.replace(/[^a-zA-Z0-9-]/g, '')
  return clean.slice(0, 2).toUpperCase() || '??'
}

export function plural(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}

// The page explains the map in sentences that come from the data, never from a
// template of imagined facts. Each sentence is true for any repository.
export function describeRepo(repo: RepoModel): { sentences: string[]; attention: string[] } {
  const sentences: string[] = []
  const defaultBranch = repo.branches.find((branch) => branch.isDefault)
  const local = repo.local

  // A local snapshot describes a clone, not a hosted repository, so the
  // sentences stay about checkouts and working trees. No pull requests exist
  // in a clone, and the copy never pretends otherwise.
  if (local) {
    sentences.push(
      `${repo.fullName} has ${plural(repo.branches.length, 'branch', 'branches')} across ${plural(local.worktrees.length, 'local worktree', 'local worktrees')}.`,
    )

    if (repo.pullRequests.length > 0) {
      sentences.push(
        `${plural(repo.pullRequests.length, 'open pull request is', 'open pull requests are')} still on GitHub; the snapshot adds the local checkout.`,
      )
    }

    const withUpstream = repo.branches.filter((branch) => branch.upstream).length
    sentences.push(
      withUpstream === repo.branches.length
        ? 'Every branch tracks an upstream.'
        : `${plural(withUpstream, 'branch tracks', 'branches track')} an upstream; the rest exist only in this clone.`,
    )

    sentences.push(
      repo.pushedAt ? `The newest commit is ${timeAgo(repo.pushedAt)}.` : 'This clone has no commits yet.',
    )

    const commits = repo.commitActivity.reduce((total, week) => total + week, 0)
    if (commits > 0) sentences.push(`${plural(commits, 'commit', 'commits')} landed in the last 12 weeks.`)

    const uncommitted = local.worktrees.reduce((total, worktree) => total + worktree.dirty, 0)
    sentences.push(
      uncommitted === 0
        ? 'Every worktree is clean.'
        : `${plural(uncommitted, 'uncommitted file', 'uncommitted files')} in the working trees.`,
    )

    const attention: string[] = []
    const behind = local.worktrees.filter((worktree) => worktree.behind > 0)
    if (behind.length > 0) {
      attention.push(`${plural(behind.length, 'worktree is', 'worktrees are')} behind upstream.`)
    }
    const dirty = local.worktrees.filter((worktree) => worktree.dirty > 0)
    if (dirty.length > 0) {
      attention.push(`${plural(dirty.length, 'worktree has', 'worktrees have')} uncommitted changes.`)
    }
    if (defaultBranch && !defaultBranch.upstream) {
      attention.push(`${defaultBranch.name} has no upstream, so its commits are local only.`)
    }
    if (local.stashes > 0) attention.push(`${plural(local.stashes, 'stash', 'stashes')} waiting to be applied.`)
    if (repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) > 120 * 86_400_000) {
      attention.push(`No commit since ${timeAgo(repo.pushedAt)}.`)
    }

    return { sentences, attention }
  }

  sentences.push(
    `${repo.fullName} has ${plural(repo.branches.length, 'branch', 'branches')} and ${plural(repo.pullRequests.length, 'open pull request', 'open pull requests')}.`,
  )

  if (repo.branches.length > 0) {
    sentences.push(
      defaultBranch?.protected
        ? `${repo.defaultBranch} is the default branch, and it is protected.`
        : `${repo.defaultBranch} is the default branch. It accepts direct pushes.`,
    )
  }

  sentences.push(
    repo.archived
      ? 'The repository is archived, so GitHub serves it read-only.'
      : repo.pushedAt
        ? `The last push was ${timeAgo(repo.pushedAt)}.`
        : 'GitHub has no push date for this repository.',
  )

  const topLanguage = repo.languages[0]
  if (topLanguage) sentences.push(`${topLanguage.name} makes up ${topLanguage.percent}% of the code.`)

  const commits = repo.commitActivity.reduce((total, week) => total + week, 0)
  if (commits > 0) sentences.push(`${plural(commits, 'commit', 'commits')} landed in the last 12 weeks.`)

  const attention: string[] = []
  if (repo.archived) attention.push('Archived: GitHub serves this repository read-only.')
  if (defaultBranch && !defaultBranch.protected && repo.branches.length > 0) {
    attention.push(`Anyone with write access can push straight to ${repo.defaultBranch}.`)
  }
  const idle = repo.branches.filter((branch) => !branch.isDefault && branch.pullRequests.length === 0).length
  if (idle > 0) attention.push(`${plural(idle, 'branch has', 'branches have')} no open pull request.`)
  if (repo.fork) attention.push('This is a fork. Its work may not exist upstream.')
  if (repo.pushedAt && Date.now() - Date.parse(repo.pushedAt) > 120 * 86_400_000) {
    attention.push(`No push since ${timeAgo(repo.pushedAt)}.`)
  }

  return { sentences, attention }
}

const sampleNow = Date.now()
const daysAgo = (days: number) => new Date(sampleNow - days * 86_400_000).toISOString()

// Invented data, shown only until a real link arrives, and always labelled
// "Sample map" in the page. It is not fetched from GitHub.
export const SAMPLE_REPO: RepoModel = {
  owner: 'acme-labs',
  name: 'atlas',
  fullName: 'acme-labs/atlas',
  description: 'Edge-native feature flags with a rollout map your whole team can read.',
  htmlUrl: 'https://github.com/acme-labs/atlas',
  homepage: 'https://atlas.example.dev',
  avatarUrl: '',
  stars: 2841,
  forks: 213,
  watchers: 96,
  openIssues: 37,
  language: 'TypeScript',
  license: 'MIT',
  topics: ['feature-flags', 'edge', 'typescript'],
  defaultBranch: 'main',
  createdAt: daysAgo(412),
  pushedAt: daysAgo(2),
  sizeKb: 18_420,
  archived: false,
  fork: false,
  isPrivate: false,
  cloneUrl: 'https://github.com/acme-labs/atlas.git',
  branches: [
    { name: 'main', sha: '9f2c1ab5d0e4b7a1c3f8', isDefault: true, protected: true, pullRequests: [] },
    { name: 'release/2.4', sha: '4a7de92b31c05f8a6d20', isDefault: false, protected: true, pullRequests: [126] },
    { name: 'feat/tree-view', sha: 'c81b0f4e9a2d73615cbb', isDefault: false, protected: false, pullRequests: [128] },
    { name: 'fix/rate-limit', sha: '1d9e6c07b48a25f3de91', isDefault: false, protected: false, pullRequests: [131] },
    { name: 'chore/docs', sha: '77ab3c9d15e40f28b6ae', isDefault: false, protected: false, pullRequests: [119] },
    { name: 'spike/wasm-flags', sha: 'e40c7a1b98d3562f0c84', isDefault: false, protected: false, pullRequests: [] },
    { name: 'dependabot/npm/vite-8', sha: 'b2f81d6c04a9e7351f5d', isDefault: false, protected: false, pullRequests: [] },
  ],
  pullRequests: [
    {
      number: 131,
      title: 'Return a clear 429 when the edge cache is cold',
      author: 'nadia-k',
      avatarUrl: '',
      head: 'fix/rate-limit',
      base: 'main',
      draft: false,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(0),
      url: 'https://github.com/acme-labs/atlas/pull/131',
      comments: 6,
      labels: [{ name: 'bug', color: 'd73a4a' }],
    },
    {
      number: 128,
      title: 'Tree view for rollout rules',
      author: 'sam-ortiz',
      avatarUrl: '',
      head: 'feat/tree-view',
      base: 'main',
      draft: false,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(1),
      url: 'https://github.com/acme-labs/atlas/pull/128',
      comments: 12,
      labels: [{ name: 'feature', color: '0e8a16' }],
    },
    {
      number: 126,
      title: 'Release 2.4',
      author: 'lea-m',
      avatarUrl: '',
      head: 'release/2.4',
      base: 'main',
      draft: false,
      createdAt: daysAgo(6),
      updatedAt: daysAgo(2),
      url: 'https://github.com/acme-labs/atlas/pull/126',
      comments: 3,
      labels: [{ name: 'release', color: '5319e7' }],
    },
    {
      number: 119,
      title: 'Rewrite the quickstart around one example',
      author: 'mira-p',
      avatarUrl: '',
      head: 'chore/docs',
      base: 'main',
      draft: true,
      createdAt: daysAgo(11),
      updatedAt: daysAgo(3),
      url: 'https://github.com/acme-labs/atlas/pull/119',
      comments: 4,
      labels: [],
    },
  ],
  languages: [
    { name: 'TypeScript', bytes: 742_000, percent: 61.4 },
    { name: 'CSS', bytes: 220_000, percent: 18.2 },
    { name: 'MDX', bytes: 116_000, percent: 9.6 },
    { name: 'Shell', bytes: 74_000, percent: 6.1 },
    { name: 'Other', bytes: 57_000, percent: 4.7 },
  ],
  contributors: [
    { login: 'nadia-k', avatarUrl: '', contributions: 184, url: 'https://github.com/nadia-k' },
    { login: 'sam-ortiz', avatarUrl: '', contributions: 127, url: 'https://github.com/sam-ortiz' },
    { login: 'lea-m', avatarUrl: '', contributions: 96, url: 'https://github.com/lea-m' },
    { login: 'bo-x', avatarUrl: '', contributions: 54, url: 'https://github.com/bo-x' },
    { login: 'mira-p', avatarUrl: '', contributions: 31, url: 'https://github.com/mira-p' },
  ],
  commits: [
    {
      sha: '9f2c1ab5d0e4b7a1c3f8e6d2',
      message: 'Merge pull request #130 from acme-labs/chore/release-2.4',
      author: 'nadia-k',
      avatarUrl: '',
      date: daysAgo(0),
      url: 'https://github.com/acme-labs/atlas/commit/9f2c1ab5d0e4b7a1c3f8e6d2',
    },
    {
      sha: 'c81b0f4e9a2d73615cbb84a1',
      message: 'Draw the rule tree without a canvas',
      author: 'sam-ortiz',
      avatarUrl: '',
      date: daysAgo(1),
      url: 'https://github.com/acme-labs/atlas/commit/c81b0f4e9a2d73615cbb84a1',
    },
    {
      sha: '1d9e6c07b48a25f3de91c0f5',
      message: 'Cache the flag payload per edge colo',
      author: 'nadia-k',
      avatarUrl: '',
      date: daysAgo(2),
      url: 'https://github.com/acme-labs/atlas/commit/1d9e6c07b48a25f3de91c0f5',
    },
    {
      sha: '77ab3c9d15e40f28b6ae05d3',
      message: 'Lead the quickstart with one working example',
      author: 'mira-p',
      avatarUrl: '',
      date: daysAgo(3),
      url: 'https://github.com/acme-labs/atlas/commit/77ab3c9d15e40f28b6ae05d3',
    },
    {
      sha: '4a7de92b31c05f8a6d20e7c1',
      message: 'Bump the runtime to the 2.4 line',
      author: 'lea-m',
      avatarUrl: '',
      date: daysAgo(5),
      url: 'https://github.com/acme-labs/atlas/commit/4a7de92b31c05f8a6d20e7c1',
    },
  ],
  commitActivity: [18, 24, 11, 31, 27, 19, 8, 22, 35, 29, 17, 26],
}
