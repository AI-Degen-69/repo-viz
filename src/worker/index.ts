import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { counted } from '../lib/repo'
import type { RepoBranch, RepoCommit, RepoContributor, RepoLanguage, RepoModel, RepoPullRequest } from '../lib/repo'

// The Worker in front of the static site. It reads public GitHub data and
// returns the one repo shape the map renders. It never writes to GitHub.

type Env = {
  ASSETS: Fetcher
  GITHUB_TOKEN?: string
}

const GITHUB_API = 'https://api.github.com'
const CACHE_MS = 5 * 60 * 1000
const SITE_NAME = 'Topology'

type Cached = { at: number; repo: RepoModel; notice: string | null }
const cache = new Map<string, Cached>()

type RepoPayload = {
  repo: RepoModel
  source: 'github'
  notice: string | null
  fetchedAt: string
  cached: boolean
}

type RepoFailure = { status: 400 | 404 | 429 | 502; error: string; code: string }
type RepoLoad = { ok: true; payload: RepoPayload } | { ok: false; failure: RepoFailure }

type GhRepo = {
  name: string
  full_name: string
  owner: { login: string; avatar_url: string }
  description: string | null
  html_url: string
  homepage: string | null
  stargazers_count: number
  forks_count: number
  subscribers_count?: number
  open_issues_count: number
  language: string | null
  license: { spdx_id: string | null; name: string } | null
  topics?: string[]
  default_branch: string
  created_at: string
  pushed_at: string | null
  size: number
  archived: boolean
  fork: boolean
  private: boolean
  clone_url: string
}

type GhBranch = { name: string; commit: { sha: string }; protected: boolean }
type GhPull = {
  number: number
  title: string
  user: { login: string; avatar_url: string } | null
  head: { ref: string; label?: string; repo?: { full_name?: string } | null }
  base: { ref: string }
  draft: boolean
  created_at: string
  updated_at: string
  html_url: string
  comments: number
  labels: { name: string; color: string }[]
}
type GhContributor = { login: string; avatar_url: string; contributions: number; html_url: string }
type GhCommit = {
  sha: string
  html_url: string
  commit: { message: string; author: { date: string } | null }
  author: { login: string; avatar_url: string } | null
}
type GhActivity = { week: number; total: number }

type GhResult<T> = { ok: true; data: T } | { ok: false; status: number }

async function gh<T>(path: string, token?: string): Promise<GhResult<T>> {
  try {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'topology-saas',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { ok: false, status: response.status }
    if (response.status === 202) return { ok: true, data: null as T }
    return { ok: true, data: (await response.json()) as T }
  } catch {
    return { ok: false, status: 0 }
  }
}

const PAGE_SIZE = 100
// GitHub caps one page at 100 entries, so a complete list takes more than one
// request. The page cap keeps a single map from walking a very large
// repository; when it is reached the caller reports a truncated list instead of
// presenting the collected length as a total.
const MAX_PAGES = 5

type PagedResult<T> = { ok: boolean; items: T[]; truncated: boolean }

async function ghPaged<T>(path: string, token?: string): Promise<PagedResult<T>> {
  const items: T[] = []
  const separator = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await gh<T[]>(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`, token)
    if (!result.ok) return { ok: false, items, truncated: false }
    if (!Array.isArray(result.data)) return { ok: true, items, truncated: false }
    items.push(...result.data)
    if (result.data.length < PAGE_SIZE) return { ok: true, items, truncated: false }
  }
  return { ok: true, items, truncated: true }
}

export function parseRepoInput(input: string): { owner: string; name: string } | null {
  let value = input.trim()
  if (!value) return null
  value = value.replace(/^git@github\.com:/i, '')
  value = value.replace(/^ssh:\/\/git@github\.com\//i, '')
  value = value.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  value = value.replace(/^github\.com\//i, '')
  value = value.split(/[?#]/)[0] ?? ''
  value = value.replace(/\.git$/i, '').replace(/\/+$/g, '')
  const [owner, name] = value.split('/')
  if (!owner || !name) return null
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return null
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === '.' || name === '..') return null
  return { owner, name }
}

function languagesOf(map: Record<string, number> | null): RepoLanguage[] {
  if (!map) return []
  const entries = Object.entries(map).filter(([, bytes]) => bytes > 0)
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0)
  if (!total) return []
  entries.sort((a, b) => b[1] - a[1])
  const head = entries.slice(0, 5)
  const rest = entries.slice(5).reduce((sum, [, bytes]) => sum + bytes, 0)
  const percent = (bytes: number) => Math.round((bytes / total) * 1000) / 10
  const list = head.map(([name, bytes]) => ({ name, bytes, percent: percent(bytes) }))
  if (rest > 0) list.push({ name: 'Other', bytes: rest, percent: percent(rest) })
  return list
}

// One read path for both the JSON API and a map permalink, so they share the
// same five-minute cache and the same error vocabulary.
async function loadRepo(target: { owner: string; name: string }, token?: string): Promise<RepoLoad> {
  const key = `${target.owner}/${target.name}`.toLowerCase()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return {
      ok: true,
      payload: {
        repo: cached.repo,
        source: 'github',
        notice: cached.notice,
        fetchedAt: new Date(cached.at).toISOString(),
        cached: true,
      },
    }
  }

  const owner = encodeURIComponent(target.owner)
  const name = encodeURIComponent(target.name)
  const base = `/repos/${owner}/${name}`
  const repoResult = await gh<GhRepo>(base, token)

  if (!repoResult.ok) {
    if (repoResult.status === 404) {
      return {
        ok: false,
        failure: { status: 404, error: 'Repository not found. Check the link, or it may be private.', code: 'not_found' },
      }
    }
    if (repoResult.status === 403 || repoResult.status === 429) {
      return {
        ok: false,
        failure: {
          status: 429,
          error: 'GitHub rate limit reached. Wait a few minutes, or set GITHUB_TOKEN for this deployment.',
          code: 'rate_limit',
        },
      }
    }
    return { ok: false, failure: { status: 502, error: 'GitHub did not answer. Try again in a moment.', code: 'upstream' } }
  }

  const ghRepo = repoResult.data
  // A token with private access must not turn this public map into a window
  // into private repositories. SPEC.md promises `not_found` for them, and this
  // runs before any detail read or cache write.
  if (ghRepo.private) {
    return {
      ok: false,
      failure: { status: 404, error: 'Repository not found. Check the link, or it may be private.', code: 'not_found' },
    }
  }

  const [branchesPage, pullsPage, languagesResult, contributorsResult, commitsResult, activityResult] =
    await Promise.all([
      ghPaged<GhBranch>(`${base}/branches`, token),
      ghPaged<GhPull>(`${base}/pulls?state=open&sort=updated&direction=desc`, token),
      gh<Record<string, number>>(`${base}/languages`, token),
      gh<GhContributor[]>(`${base}/contributors?per_page=12`, token),
      gh<GhCommit[]>(`${base}/commits?per_page=8`, token),
      gh<GhActivity[]>(`${base}/stats/commit_activity`, token),
    ])

  const rawPulls = pullsPage.items
  const pullRequests: RepoPullRequest[] = rawPulls
    .map((pull) => ({
      number: pull.number,
      title: pull.title,
      author: pull.user?.login ?? 'ghost',
      avatarUrl: pull.user?.avatar_url ?? '',
      head: pull.head?.label ?? pull.head?.ref ?? '',
      base: pull.base?.ref ?? '',
      draft: Boolean(pull.draft),
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      url: pull.html_url,
      comments: pull.comments ?? 0,
      labels: (pull.labels ?? []).slice(0, 3).map((label) => ({ name: label.name, color: label.color })),
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  // `head.label` is "owner:branch", not a branch name, so it cannot be matched
  // against this repository's branches. Only a head that lives in this
  // repository may attach; a fork branch with the same name must not.
  const repoFullName = ghRepo.full_name.toLowerCase()
  const ownerLogin = (ghRepo.owner?.login ?? target.owner).toLowerCase()
  const headRefOf = (pull: GhPull): string | null => {
    const headRepo = pull.head?.repo
    if (headRepo === null) return null
    const sameRepo = headRepo?.full_name
      ? headRepo.full_name.toLowerCase() === repoFullName
      : (pull.head?.label ?? '').split(':')[0]?.toLowerCase() === ownerLogin
    return sameRepo ? pull.head?.ref || null : null
  }

  const pullRequestsByHead = new Map<string, number[]>()
  for (const pull of rawPulls) {
    const ref = headRefOf(pull)
    if (!ref) continue
    const list = pullRequestsByHead.get(ref) ?? []
    list.push(pull.number)
    pullRequestsByHead.set(ref, list)
  }

  const rawBranches = branchesPage.items
  const branches: RepoBranch[] = rawBranches
    .map((branch) => ({
      name: branch.name,
      sha: branch.commit?.sha ?? '',
      isDefault: branch.name === ghRepo.default_branch,
      protected: Boolean(branch.protected),
      pullRequests: pullRequestsByHead.get(branch.name) ?? [],
    }))
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        Number(b.pullRequests.length > 0) - Number(a.pullRequests.length > 0) ||
        a.name.localeCompare(b.name),
    )

  const rawCommits = commitsResult.ok && commitsResult.data ? commitsResult.data : []
  const commits: RepoCommit[] = rawCommits.map((commit) => ({
    sha: commit.sha,
    message: (commit.commit?.message ?? '').split('\n')[0]?.slice(0, 100) ?? '',
    author: commit.author?.login ?? 'ghost',
    avatarUrl: commit.author?.avatar_url ?? '',
    date: commit.commit?.author?.date ?? '',
    url: commit.html_url,
  }))

  const contributors: RepoContributor[] =
    contributorsResult.ok && Array.isArray(contributorsResult.data)
      ? contributorsResult.data.map((person) => ({
          login: person.login,
          avatarUrl: person.avatar_url,
          contributions: person.contributions,
          url: person.html_url,
        }))
      : []

  const commitActivity =
    activityResult.ok && Array.isArray(activityResult.data)
      ? activityResult.data.slice(-12).map((week) => week.total)
      : []

  // A capped list is a floor and not a total, so the model carries the fact and
  // the counts built from it can say `500+` instead of `500`.
  const truncated = { branches: branchesPage.truncated, pullRequests: pullsPage.truncated }

  const repo: RepoModel = {
    owner: ghRepo.owner?.login ?? target.owner,
    name: ghRepo.name,
    fullName: ghRepo.full_name,
    description: ghRepo.description?.trim() || null,
    htmlUrl: ghRepo.html_url,
    homepage: ghRepo.homepage?.trim() || null,
    avatarUrl: ghRepo.owner?.avatar_url ?? '',
    stars: ghRepo.stargazers_count ?? 0,
    forks: ghRepo.forks_count ?? 0,
    watchers: ghRepo.subscribers_count ?? 0,
    openIssues: ghRepo.open_issues_count ?? 0,
    language: ghRepo.language,
    license: ghRepo.license?.spdx_id ?? ghRepo.license?.name ?? null,
    topics: (ghRepo.topics ?? []).slice(0, 6),
    defaultBranch: ghRepo.default_branch,
    createdAt: ghRepo.created_at,
    pushedAt: ghRepo.pushed_at,
    sizeKb: ghRepo.size ?? 0,
    archived: Boolean(ghRepo.archived),
    fork: Boolean(ghRepo.fork),
    isPrivate: Boolean(ghRepo.private),
    cloneUrl: ghRepo.clone_url,
    branches,
    pullRequests,
    languages: languagesOf(languagesResult.ok ? languagesResult.data : null),
    contributors,
    commits,
    commitActivity,
    ...(truncated.branches || truncated.pullRequests ? { truncated } : {}),
  }

  const partial = [branchesPage, pullsPage, contributorsResult, commitsResult].some((result) => !result.ok)
  // A capped list and a failed read can both be true, so each keeps its own
  // sentence instead of one notice hiding the other.
  const capped = [...(branchesPage.truncated ? ['branches'] : []), ...(pullsPage.truncated ? ['open pull requests'] : [])]
  const notices: string[] = []
  if (capped.length) {
    notices.push(
      `Only the first ${MAX_PAGES * PAGE_SIZE} ${capped.join(' and ')} are read, so these counts are a floor rather than a total.`,
    )
  }
  if (partial) notices.push('Some GitHub data did not answer. The map shows what did.')
  const notice = notices.length ? notices.join(' ') : null
  const at = Date.now()
  cache.set(key, { at, repo, notice })

  return {
    ok: true,
    payload: { repo, source: 'github', notice, fetchedAt: new Date(at).toISOString(), cached: false },
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

// JSON inside a <script> tag must not be able to close that tag.
function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function permalinkPath(repo: RepoModel): string {
  return `/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
}

function mapTitle(repo: RepoModel): string {
  return `${repo.fullName} — repository map`
}

function mapDescription(repo: RepoModel): string {
  const facts = [
    counted(repo.branches.length, repo.truncated?.branches, 'branch', 'branches'),
    counted(repo.pullRequests.length, repo.truncated?.pullRequests, 'open pull request', 'open pull requests'),
    ...(repo.language ? [repo.language] : []),
  ].join(', ')
  return clip(repo.description ? `${repo.description} — ${facts}.` : `${repo.fullName}: ${facts}.`, 200)
}

function headTags(options: {
  title: string
  description: string
  canonical: string
  image: string | null
  noindex?: boolean
}): string {
  const tags = [
    `<meta name="description" content="${escapeHtml(options.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(options.canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${escapeHtml(options.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(options.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(options.canonical)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(options.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(options.description)}" />`,
  ]
  if (options.image) {
    tags.push(`<meta property="og:image" content="${escapeHtml(options.image)}" />`)
    tags.push(`<meta property="og:image:alt" content="${escapeHtml(options.title)}" />`)
    tags.push(`<meta name="twitter:image" content="${escapeHtml(options.image)}" />`)
  }
  if (options.noindex) tags.push('<meta name="robots" content="noindex" />')
  return tags.join('\n    ')
}

// The built index.html stays the single source of the asset graph, so this
// injects into it rather than rebuilding the document.
function renderDocument(
  shell: string,
  options: {
    title: string
    description: string
    canonical: string
    image: string | null
    data: unknown
  },
): string {
  const head = headTags(options)
  return shell
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(`${options.title} · ${SITE_NAME}`)}</title>`)
    .replace(/\s*<meta\s+name="description"[\s\S]*?\/?>/i, '')
    .replace(/<\/head>/i, `    ${head}\n  </head>`)
    .replace(
      /<\/body>/i,
      `    <script type="application/json" id="initial-data">${escapeJson(options.data)}</script>\n  </body>`,
    )
}

async function loadShell(assets: Fetcher | undefined, requestUrl: string): Promise<string | null> {
  if (!assets) return null
  try {
    const response = await assets.fetch(new URL('/index.html', requestUrl))
    if (!response.ok) return null
    const shell = await response.text()
    return shell.includes('</head>') && shell.includes('</body>') ? shell : null
  } catch {
    return null
  }
}

function errorDocument(status: number, title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#0b0908" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)} · ${SITE_NAME}</title>
    <meta name="description" content="${escapeHtml(message)}" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #0b0908;
        color: #f3ede8;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      main { max-width: 520px; }
      h1 { margin: 0 0 12px; font-size: 26px; letter-spacing: -0.03em; }
      p { margin: 0; color: #a89e97; font-size: 15px; line-height: 1.6; }
      .code { margin-bottom: 10px; color: #746a64; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      a { display: inline-flex; margin-top: 18px; color: #ff7a45; font-size: 14px; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <main>
      <p class="code">${SITE_NAME} · ${status}</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a href="/">Map a repository →</a>
    </main>
  </body>
</html>`
}

function failureTitle(code: string): string {
  if (code === 'not_found') return 'Repository not found'
  if (code === 'rate_limit') return 'GitHub is busy'
  if (code === 'upstream') return 'GitHub did not answer'
  return 'Map unavailable'
}

function failureMessage(code: string, target: { owner: string; name: string }): string {
  if (code === 'not_found') {
    return `GitHub did not return ${target.owner}/${target.name}. Check the link, or the repository may be private.`
  }
  if (code === 'rate_limit') return 'GitHub is limiting requests right now. Try again in a few minutes.'
  if (code === 'upstream') return 'GitHub did not answer. Try again in a moment.'
  return 'The map could not be read. Try again in a moment.'
}

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Request is too large.' }, 413) }))

app.get('/api/health', (c) => c.json({ ok: true }))

// Read one public repository and answer with the map model. Public data only,
// five cached minutes, and an optional token for a higher rate limit.
app.get('/api/repo', async (c) => {
  const target = parseRepoInput(c.req.query('url') ?? '')
  if (!target) {
    return c.json({ error: 'Paste a GitHub link like github.com/owner/repo.', code: 'invalid_url' }, 400)
  }

  const loaded = await loadRepo(target, c.env?.GITHUB_TOKEN)
  if (!loaded.ok) {
    return c.json({ error: loaded.failure.error, code: loaded.failure.code }, loaded.failure.status)
  }
  return c.json(loaded.payload, 200, { 'Cache-Control': 'public, max-age=60' })
})

// A map permalink: the same model and cache as the API, wrapped in a document
// whose title and description unfurl correctly, with the map data embedded so
// the client paints it without a second request.
async function renderPermalink(c: Context<{ Bindings: Env }>) {
  const owner = c.req.param('owner')
  const name = c.req.param('repo')
  const target = parseRepoInput(`${owner}/${name}`)
  if (!target) {
    return c.html(
      errorDocument(404, 'Repository not found', 'A map link looks like /r/owner/repo.'),
      404,
      { 'Cache-Control': 'no-store' },
    )
  }

  const loaded = await loadRepo(target, c.env?.GITHUB_TOKEN)
  if (!loaded.ok) {
    return c.html(
      errorDocument(loaded.failure.status, failureTitle(loaded.failure.code), failureMessage(loaded.failure.code, target)),
      loaded.failure.status,
      { 'Cache-Control': 'no-store' },
    )
  }

  const { repo } = loaded.payload
  const canonical = new URL(permalinkPath(repo), c.req.url).toString()
  const shell = await loadShell(c.env?.ASSETS, c.req.url)
  if (!shell) {
    return c.html(
      errorDocument(500, 'Map unavailable', 'The map page could not load. Try again in a moment.'),
      500,
      { 'Cache-Control': 'no-store' },
    )
  }

  const html = renderDocument(shell, {
    title: mapTitle(repo),
    description: mapDescription(repo),
    canonical,
    image: repo.avatarUrl.startsWith('https://') ? repo.avatarUrl : null,
    data: { kind: 'repo', data: loaded.payload },
  })
  return c.html(html, 200, { 'Cache-Control': 'public, max-age=60' })
}

app.get('/r/:owner/:repo', renderPermalink)
app.get('/r/:owner/:repo/', renderPermalink)
app.get('/r/*', (c) =>
  c.html(errorDocument(404, 'Map not found', 'A map link looks like /r/owner/repo.'), 404, {
    'Cache-Control': 'no-store',
  }),
)

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404))

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
