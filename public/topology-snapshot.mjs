#!/usr/bin/env node
// Topology local snapshot generator.
//
// Reads a Git repository with read-only git commands and writes
// topology-snapshot.json. It never reads file contents, never touches the
// working tree, never contacts a server, and never needs a GitHub token.
//
//   node topology-snapshot.mjs [repository] [--out <file>] [--redact]
//
// Works the same on Windows, macOS and Linux. Node.js 18+ required.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KIND = 'topology-local-snapshot'
export const VERSION = 1
const RECENT_COMMITS = 12
const MAX_DIRTY_FILES = 200
const MAX_FILES_PER_WORKTREE = 50

const HELP = `
Topology local snapshot generator

Usage:
  node topology-snapshot.mjs [repository] [options]

  repository            A clone, or a folder of clones. Default: the current folder.
  -o, --out <file>      Output file. Default: topology-snapshot.json
      --redact          Replace absolute paths and remote URLs before writing.
  -h, --help            Show this message.

What it reads (read-only):
  repository identity, local branches and their heads, upstream tracking and
  ahead/behind counts, worktrees, changed file paths and their status, recent
  commits, stash count.

What it never reads:
  file contents, .env values, environment variables, credentials or tokens.

Nothing is uploaded. The file only leaves this machine if you choose to open it
in the Topology page.
`.trim()

// ---------------------------------------------------------------------------
// arguments

function parseArgs(argv) {
  const options = { target: '.', out: 'topology-snapshot.json', redact: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') {
      console.log(`\n${HELP}\n`)
      process.exit(0)
    }
    if (arg === '--redact') {
      options.redact = true
      continue
    }
    if (arg === '-o' || arg === '--out') {
      const value = argv[index + 1]
      if (!value) fail('--out needs a file path.')
      options.out = value
      index += 1
      continue
    }
    if (arg.startsWith('-')) fail(`Unknown option ${arg}.`)
    options.target = arg
  }
  return options
}

function fail(message) {
  console.error(`\n${message}\n`)
  console.error('Run with --help for usage.\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// git helpers

function git(cwd, args) {
  try {
    // Strip only the trailing newline. `.trim()` would eat the leading space
    // of `git status --porcelain` lines and corrupt the first file path.
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

function isClone(dir) {
  return existsSync(join(dir, '.git'))
}

function resolveRepository(target) {
  const absolute = resolve(target)
  if (!existsSync(absolute)) fail(`No folder at ${absolute}`)
  if (!statSync(absolute).isDirectory()) fail(`${absolute} is a file. Point at a repository folder.`)
  if (isClone(absolute)) return absolute
  // A folder that itself is not a clone but whose parent is: accept `repo/src`.
  if (isClone(dirname(absolute))) return dirname(absolute)

  const clones = readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isClone(join(absolute, entry.name)))
    .map((entry) => entry.name)
    .sort()

  if (clones.length === 0) fail(`No Git repository at ${absolute} and no clones inside it.`)
  if (clones.length === 1) return join(absolute, clones[0])
  fail(
    `${absolute} holds ${clones.length} clones. Run the generator inside the one you want, for example:\n` +
      clones.map((name) => `  node topology-snapshot.mjs "${join(absolute, name)}"`).join('\n'),
  )
}

export function parseGitHubRemote(url) {
  if (!url) return null
  const clean = url.trim().replace(/\.git$/i, '')
  const match = clean.match(/github\.com[:/]([^/]+)\/([^/]+)$/i)
  if (!match) return null
  return { owner: match[1], name: match[2] }
}

function normalizePath(path, redact) {
  if (!redact) return path
  // Redaction keeps only the final folder name: no drive letter, no home
  // directory, and no absolute path fragments from any platform.
  return `<redacted>/${basename(String(path).replace(/[\\/]+$/, '')) || 'repository'}`
}

// ---------------------------------------------------------------------------
// porcelain parsers (the same rules the page validates against)
//
// These are copies, not imports: this file has to run from a bare download.
// tests/standalone-snapshot.test.ts pins each one to src/lib/local-snapshot.ts,
// which is where a parser fix has to land first.

export function parseWorktreeList(text) {
  const worktrees = []
  let current = null
  const flush = () => {
    if (current) worktrees.push(current)
    current = null
  }
  for (const raw of String(text || '').split(/\r?\n/)) {
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

export function parseUpstreamTrack(value) {
  const track = String(value || '').trim()
  if (!track) return { ahead: 0, behind: 0, gone: false }
  if (track.includes('gone')) return { ahead: 0, behind: 0, gone: true }
  return {
    ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
    gone: false,
  }
}

export function parseStatus(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim() || '??', path: line.slice(3).trim() }))
}

// ---------------------------------------------------------------------------
// snapshot

function snapshot(repoPath, options) {
  const redact = options.redact
  const origin = git(repoPath, ['config', '--get', 'remote.origin.url'])
  const github = parseGitHubRemote(origin)
  const owner = github?.owner ?? 'local'
  const name = github?.name ?? basename(repoPath)
  const htmlUrl = github ? `https://github.com/${github.owner}/${github.name}` : ''

  const worktreeList = parseWorktreeList(git(repoPath, ['worktree', 'list', '--porcelain']) ?? '')

  const branchRecords = (git(repoPath, [
    'for-each-ref',
    'refs/heads',
    '--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)',
  ]) ?? '')
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

  const branches = branchRecords.map((record) => {
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
  const statusByPath = new Map()

  const worktrees = worktreeList.map((worktree) => {
    let files = []
    if (!worktree.bare) {
      files = parseStatus(git(worktree.path, ['status', '--porcelain']) ?? '')
      statusByPath.set(worktree.path, files)
    }
    const record = worktree.branch ? recordsByName.get(worktree.branch) : undefined
    const track = parseUpstreamTrack(record?.track ?? '')
    const lastCommit = worktree.bare ? null : git(worktree.path, ['log', '-1', '--format=%aI'])

    return {
      path: normalizePath(worktree.path, redact),
      branch: worktree.branch,
      head: worktree.head,
      detached: worktree.detached,
      bare: worktree.bare,
      locked: worktree.locked,
      prunable: worktree.prunable,
      dirty: files.length,
      files: files.slice(0, MAX_FILES_PER_WORKTREE).map((file) => ({
        path: file.path,
        status: file.status,
      })),
      ahead: track.ahead,
      behind: track.behind,
      lastCommit: lastCommit || null,
    }
  })

  const primary = worktreeList.find((worktree) => !worktree.bare)
  const primaryStatus = primary ? (statusByPath.get(primary.path) ?? []) : []
  const dirtyFiles = primaryStatus.slice(0, MAX_DIRTY_FILES).map((file) => ({
    path: file.path,
    status: file.status,
  }))

  const stashes = (git(repoPath, ['stash', 'list']) ?? '').split('\n').filter(Boolean).length

  const log =
    git(repoPath, ['log', '-n', String(RECENT_COMMITS), '--format=%H%x1f%s%x1f%an%x1f%aI', `refs/heads/${defaultBranch}`]) ??
    git(repoPath, ['log', '-n', String(RECENT_COMMITS), '--format=%H%x1f%s%x1f%an%x1f%aI']) ??
    ''

  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', message = '', author = '', date = ''] = line.split('\u001f')
      return { sha, message, author, avatarUrl: '', date, url: htmlUrl ? `${htmlUrl}/commit/${sha}` : '' }
    })

  const now = Date.now()
  const week = 7 * 86_400_000
  const commitActivity = new Array(12).fill(0)
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

  const remotes = (git(repoPath, ['remote']) ?? '').split('\n').map((remote) => remote.trim()).filter(Boolean)
  const upstream = git(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])

  const repo = {
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
    createdAt: rootDate ?? newestBranchDate ?? new Date().toISOString(),
    pushedAt: newestBranchDate || rootDate || null,
    sizeKb: 0,
    archived: false,
    fork: remotes.includes('upstream'),
    isPrivate: false,
    cloneUrl: redact ? (htmlUrl || '<redacted>') : (stripCredentials(origin) ?? repoPath),
    branches,
    pullRequests: [],
    languages: [],
    contributors: [],
    commits,
    commitActivity,
    local: {
      scannedAt: new Date().toISOString(),
      root: normalizePath(repoPath, redact),
      upstream: upstream || null,
      stashes,
      dirtyFiles,
      worktrees,
    },
  }

  return repo
}

// A remote can carry credentials (`https://user:token@host/owner/name.git`).
// A token never belongs in a snapshot, so it is stripped whether or not
// `--redact` was passed; the repository address stays readable.
export function stripCredentials(url) {
  if (!url) return null
  return url.replace(/\/\/[^/@]*@/, '//')
}

// ---------------------------------------------------------------------------

function main() {
  const options = parseArgs(process.argv.slice(2))
  const repoPath = resolveRepository(options.target)
  if (!git(repoPath, ['rev-parse', '--is-inside-work-tree']) && !isClone(repoPath)) {
    fail(`${repoPath} is not a Git working tree. Git must be installed and the folder must be a clone.`)
  }

  const repo = snapshot(repoPath, options)
  const out = resolve(process.cwd(), options.out)
  writeFileSync(out, `${JSON.stringify({ kind: KIND, version: VERSION, repo }, null, 2)}\n`, 'utf8')

  const dirty = repo.local.worktrees.reduce((total, worktree) => total + worktree.dirty, 0)
  const unpushed = repo.branches.reduce((total, branch) => total + branch.ahead, 0)

  console.log(`\nTopology local snapshot`)
  console.log(`  repository  ${repo.fullName}`)
  console.log(`  root        ${repo.local.root}`)
  console.log(`  branches    ${repo.branches.length}`)
  console.log(`  worktrees   ${repo.local.worktrees.length}`)
  console.log(`  modified    ${dirty} file${dirty === 1 ? '' : 's'} (paths only)`)
  console.log(`  unpushed    ${unpushed} commit${unpushed === 1 ? '' : 's'}`)
  console.log(`  commits     ${repo.commits.length} recent`)
  console.log(`\nWrote ${out}`)
  console.log('Nothing was uploaded. Open that file in Topology with "Upload an existing file".\n')
}

// Importing this file must not read a repository or write a snapshot; it only
// does that when node was pointed straight at it. `import.meta.url` names the
// real file while the shell may name a symbolic link to it, so both sides are
// compared after resolving links. Windows also varies drive-letter and
// separator casing, so the fallback comparison folds case there.
export function isEntryPoint(script = process.argv[1]) {
  if (!script) return false
  const invoked = resolve(script)
  const here = fileURLToPath(import.meta.url)
  try {
    return realpathSync(invoked) === realpathSync(here)
  } catch {
    return process.platform === 'win32' ? invoked.toLowerCase() === here.toLowerCase() : invoked === here
  }
}

if (isEntryPoint()) main()
