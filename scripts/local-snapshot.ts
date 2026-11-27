// Reads a local clone (or a folder of clones) with real git commands and writes
// one JSON snapshot in the RepoModel shape. The file never leaves this machine
// unless its owner opens it in the page.
//
//   bun run snapshot <projects-folder-or-repo> [--repo <name>] [-o <file>]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { parseStatusLines, parseUpstreamTrack, parseWorktreeList, snapshotFile } from '../src/lib/local-snapshot'
import type { RepoBranch, RepoCommit, RepoModel, RepoWorktree } from '../src/lib/repo'

const MAX_DIRTY_FILES = 200
const RECENT_COMMITS = 12

type Options = {
  target: string
  repo: string | null
  out: string | null
}

function usage(message?: string): never {
  if (message) console.error(`\n${message}\n`)
  console.error('Usage: bun run snapshot <projects-folder-or-repo> [--repo <name>] [-o <file>]\n')
  process.exit(1)
}

function parseArgs(argv: string[]): Options {
  let target: string | null = null
  let repo: string | null = null
  let out: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') usage()
    if (arg === '--repo') {
      repo = argv[index + 1] ?? usage('--repo needs a clone name.')
      index += 1
      continue
    }
    if (arg === '-o' || arg === '--out') {
      out = argv[index + 1] ?? usage('-o needs a file path.')
      index += 1
      continue
    }
    if (arg.startsWith('-')) usage(`Unknown option ${arg}.`)
    if (target) usage('Point at one folder at a time.')
    target = arg
  }

  if (!target) usage('Point at a projects folder or a local clone.')
  return { target, repo, out }
}

function git(cwd: string, args: string[]): string | null {
  try {
    // Strip only the trailing newline: `.trim()` would remove the leading
    // space of the first `git status --porcelain` line and cut its path short.
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\r?\n$/, '')
  } catch {
    return null
  }
}

function isClone(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

function findRepo(target: string, wanted: string | null): string {
  const absolute = resolve(target)
  if (!existsSync(absolute)) usage(`No folder at ${absolute}`)
  if (!statSync(absolute).isDirectory()) usage(`${absolute} is a file. Point at a folder or a clone.`)
  if (isClone(absolute)) return absolute

  const clones = readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isClone(join(absolute, entry.name)))
    .map((entry) => entry.name)
    .sort()

  if (clones.length === 0) usage(`No git clones in ${absolute}.`)

  if (wanted) {
    const match = clones.find((name) => name.toLowerCase() === wanted.toLowerCase())
    if (!match) usage(`No clone named "${wanted}" in ${absolute}. Found:\n  ${clones.join('\n  ')}`)
    return join(absolute, match)
  }

  if (clones.length === 1) return join(absolute, clones[0])

  usage(`${absolute} holds ${clones.length} clones. Pick one with --repo:\n  ${clones.join('\n  ')}`)
}

function parseGitHubRemote(url: string | null): { owner: string; name: string } | null {
  if (!url) return null
  const clean = url.trim().replace(/\.git$/i, '')
  const match = clean.match(/github\.com[:/]([^/]+)\/([^/]+)$/i)
  if (!match) return null
  return { owner: match[1], name: match[2] }
}

function snapshot(repoPath: string): RepoModel {
  const origin = git(repoPath, ['config', '--get', 'remote.origin.url'])
  const github = parseGitHubRemote(origin)
  const owner = github?.owner ?? basename(dirname(repoPath))
  const name = github?.name ?? basename(repoPath)
  const htmlUrl = github ? `https://github.com/${github.owner}/${github.name}` : ''

  const worktreeList = parseWorktreeList(git(repoPath, ['worktree', 'list', '--porcelain']) ?? '')

  const branchRecords = (
    git(repoPath, [
      'for-each-ref',
      'refs/heads',
      '--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)',
    ]) ?? ''
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [branch = '', sha = '', upstream = '', track = '', date = ''] = line.split('\u0000')
      return { branch, sha, upstream, track, date }
    })

  const remoteHead = git(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const checkedOut = worktreeList.find((worktree) => !worktree.bare && worktree.branch)?.branch ?? null
  const branchNames = branchRecords.map((record) => record.branch)
  // Detached HEAD and clones without a remote still need a sensible default.
  const defaultBranch =
    (remoteHead ? remoteHead.replace(/^origin\//, '') : null) ??
    (branchNames.includes('main') ? 'main' : branchNames.includes('master') ? 'master' : null) ??
    checkedOut ??
    branchNames[0] ??
    'main'

  const branches: RepoBranch[] = branchRecords.map((record) => {
    const track = parseUpstreamTrack(record.track)
    return {
      name: record.branch,
      sha: record.sha,
      isDefault: record.branch === defaultBranch,
      protected: false,
      pullRequests: [],
      upstream: record.upstream || null,
      ahead: track.ahead,
      behind: track.behind,
    }
  })

  const recordsByName = new Map(branchRecords.map((record) => [record.branch, record]))
  const statusByPath = new Map<string, { path: string; status: string }[]>()

  const worktrees: RepoWorktree[] = worktreeList.map((worktree) => {
    let files: { path: string; status: string }[] = []
    if (!worktree.bare) {
      files = parseStatusLines(git(worktree.path, ['status', '--porcelain']) ?? '')
      statusByPath.set(worktree.path, files)
    }
    const record = worktree.branch ? recordsByName.get(worktree.branch) : undefined
    const track = parseUpstreamTrack(record?.track ?? '')
    const lastCommit = worktree.bare ? null : git(worktree.path, ['log', '-1', '--format=%aI'])

    return {
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head,
      detached: worktree.detached,
      bare: worktree.bare,
      locked: worktree.locked,
      prunable: worktree.prunable,
      dirty: files.length,
      files: files.slice(0, 50),
      ahead: track.ahead,
      behind: track.behind,
      lastCommit: lastCommit || null,
    }
  })

  const primary = worktrees.find((worktree) => !worktree.bare)
  const dirtyFiles = (primary ? (statusByPath.get(primary.path) ?? []) : []).slice(0, MAX_DIRTY_FILES)

  const stashes = (git(repoPath, ['stash', 'list']) ?? '').split('\n').filter(Boolean).length

  const log =
    git(repoPath, ['log', `-n`, String(RECENT_COMMITS), '--format=%H%x1f%s%x1f%an%x1f%aI', `refs/heads/${defaultBranch}`]) ??
    git(repoPath, ['log', `-n`, String(RECENT_COMMITS), '--format=%H%x1f%s%x1f%an%x1f%aI']) ??
    ''

  const commits: RepoCommit[] = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', message = '', author = '', date = ''] = line.split('\u001f')
      return { sha, message, author, avatarUrl: '', date, url: htmlUrl ? `${htmlUrl}/commit/${sha}` : '' }
    })

  const now = Date.now()
  const week = 7 * 86_400_000
  const commitActivity = new Array<number>(12).fill(0)
  const stamps = (git(repoPath, ['log', '--all', '--since=84.days', '--format=%at']) ?? '').split('\n').filter(Boolean)
  for (const stamp of stamps) {
    const time = Number(stamp) * 1000
    if (!Number.isFinite(time)) continue
    const weeksAgo = Math.floor((now - time) / week)
    if (weeksAgo >= 0 && weeksAgo < 12) commitActivity[11 - weeksAgo] += 1
  }

  const rootShas = (git(repoPath, ['rev-list', '--max-parents=0', 'HEAD']) ?? '').split('\n').filter(Boolean)
  const rootDate = rootShas.length
    ? git(repoPath, ['show', '-s', '--format=%aI', rootShas[rootShas.length - 1]])
    : null

  const newestBranchDate = git(repoPath, [
    'for-each-ref',
    '--sort=-committerdate',
    '--count=1',
    '--format=%(committerdate:iso-strict)',
    'refs/heads',
  ])
  const pushedAt = newestBranchDate || rootDate || null

  const objectCounts = git(repoPath, ['count-objects', '-v']) ?? ''
  const packSize = Number(objectCounts.match(/^size-pack:\s*(\d+)/m)?.[1] ?? 0)
  const looseSize = Number(objectCounts.match(/^size:\s*(\d+)/m)?.[1] ?? 0)

  const remotes = (git(repoPath, ['remote']) ?? '')
    .split('\n')
    .map((remote) => remote.trim())
    .filter(Boolean)

  const upstream = git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])

  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    description: null,
    htmlUrl,
    homepage: null,
    avatarUrl: '',
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    language: null,
    license: null,
    topics: [],
    defaultBranch,
    createdAt: rootDate ?? pushedAt ?? new Date().toISOString(),
    pushedAt,
    sizeKb: packSize + looseSize,
    archived: false,
    fork: remotes.includes('upstream'),
    isPrivate: false,
    cloneUrl: origin ?? repoPath,
    branches,
    pullRequests: [],
    languages: [],
    contributors: [],
    commits,
    commitActivity,
    local: {
      scannedAt: new Date().toISOString(),
      root: repoPath,
      upstream: upstream || null,
      stashes,
      dirtyFiles,
      worktrees,
    },
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const repoPath = findRepo(options.target, options.repo)
  const repo = snapshot(repoPath)
  const out = options.out
    ? resolve(options.out)
    : join(process.cwd(), `${repo.name}.snapshot.json`)

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(snapshotFile(repo), null, 2)}\n`, 'utf8')

  const local = repo.local
  const dirty = local?.worktrees.reduce((total, worktree) => total + worktree.dirty, 0) ?? 0
  console.log(`\n${repo.fullName} — local snapshot`)
  console.log(`  root       ${repoPath}`)
  console.log(`  worktrees  ${local?.worktrees.length ?? 0}`)
  console.log(`  branches   ${repo.branches.length}`)
  console.log(`  dirty      ${dirty} file${dirty === 1 ? '' : 's'}`)
  console.log(`  commits    ${repo.commits.length} recent`)
  console.log(`\nWrote ${out}`)
  console.log('Load it with "Connect a local snapshot" → "Upload an existing file" on the page.\n')
}

main()
