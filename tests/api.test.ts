import { afterEach, expect, test } from 'bun:test'

import app from '../src/worker/index'

const call = (url: string) => app.request(`https://example.test/api/repo?url=${encodeURIComponent(url)}`)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>Topology — see the shape of any repository</title>
    <meta name="description" content="Paste a public GitHub link." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`

const pageEnv = {
  ASSETS: {
    fetch: async () => new Response(SHELL, { status: 200, headers: { 'Content-Type': 'text/html' } }),
  },
}

const page = (path: string) => app.request(`https://example.test${path}`, undefined, pageEnv as never)

const permalinkRepo = (overrides: Record<string, unknown> = {}) => ({
  name: 'hello',
  full_name: 'octo/hello',
  owner: { login: 'octo', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
  description: 'A test repository',
  html_url: 'https://github.com/octo/hello',
  homepage: null,
  stargazers_count: 12,
  forks_count: 3,
  subscribers_count: 4,
  open_issues_count: 2,
  language: 'TypeScript',
  license: { spdx_id: 'MIT', name: 'MIT License' },
  topics: ['tree'],
  default_branch: 'main',
  created_at: '2025-01-01T00:00:00Z',
  pushed_at: '2026-11-25T10:00:00Z',
  size: 120,
  archived: false,
  fork: false,
  private: false,
  clone_url: 'https://github.com/octo/hello.git',
  ...overrides,
})

function installPermalinkMock(description = 'A test repository', name = 'hello-page') {
  const fullName = `octo/${name}`
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith(`/repos/${fullName}`)) {
      return json(
        permalinkRepo({
          name,
          full_name: fullName,
          description,
          html_url: `https://github.com/${fullName}`,
          clone_url: `https://github.com/${fullName}.git`,
        }),
      )
    }
    if (url.includes('/branches')) {
      return json([
        { name: 'main', commit: { sha: 'abc1234def' }, protected: true },
        { name: 'feat/x', commit: { sha: 'def5678abc' }, protected: false },
      ])
    }
    if (url.includes('/pulls')) {
      return json([
        {
          number: 7,
          title: 'Add a tree',
          user: { login: 'sam', avatar_url: '' },
          head: { ref: 'feat/x', label: `octo:feat/x`, repo: { full_name: fullName } },
          base: { ref: 'main' },
          draft: false,
          created_at: '2026-11-20T10:00:00Z',
          updated_at: '2026-11-25T10:00:00Z',
          html_url: `https://github.com/${fullName}/pull/7`,
          comments: 2,
          labels: [],
        },
      ])
    }
    if (url.includes('/languages')) return json({ TypeScript: 80, CSS: 20 })
    if (url.includes('/contributors')) return json([])
    if (url.includes('/commits')) return json([])
    if (url.includes('/stats/commit_activity')) return json([])
    return json({}, 404)
  }) as unknown as typeof fetch
}

test('a map permalink unfurls with its own title, description and data', async () => {
  installPermalinkMock()

  const response = await page('/r/octo/hello-page')
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/html')
  expect(response.headers.get('cache-control')).toContain('max-age=60')

  const html = await response.text()
  expect(html).toContain('<title>octo/hello-page — repository map · Topology</title>')
  expect(html).toContain('name="description" content="A test repository — 2 branches, 1 open pull request, TypeScript."')
  expect(html.match(/name="description"/g)?.length).toBe(1)
  expect(html).toContain('rel="canonical" href="https://example.test/r/octo/hello-page"')
  expect(html).toContain('property="og:title" content="octo/hello-page — repository map"')
  expect(html).toContain('property="og:description" content="A test repository')
  expect(html).toContain('name="twitter:card" content="summary"')
  expect(html).toContain('property="og:image" content="https://avatars.githubusercontent.com/u/1?v=4"')

  const embedded = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/)
  expect(embedded).not.toBeNull()
  const data = JSON.parse(embedded?.[1] ?? '{}') as {
    kind: string
    data: { repo: { fullName: string; branches: { name: string; pullRequests: number[] }[] } }
  }
  expect(data.kind).toBe('repo')
  expect(data.data.repo.fullName).toBe('octo/hello-page')
  expect(data.data.repo.branches.find((branch) => branch.name === 'feat/x')?.pullRequests).toEqual([7])
})

test('repository text is escaped out of the permalink document', async () => {
  installPermalinkMock('Kapow </script><script>alert(1)</script>', 'escaped')

  const html = await (await page('/r/octo/escaped')).text()
  expect(html).not.toContain('</script><script>alert(1)</script>')
  expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).toContain('\\u003c/script\\u003e')
})

test('a permalink for a missing repository is a 404 page, not a sample map', async () => {
  globalThis.fetch = (async () => json({ message: 'Not Found' }, 404)) as unknown as typeof fetch

  const response = await page('/r/nobody/nothing-here')
  expect(response.status).toBe(404)
  const html = await response.text()
  expect(html).toContain('<title>Repository not found · Topology</title>')
  expect(html).toContain('name="robots" content="noindex"')
  expect(html).not.toContain('Sample data')
  expect(html).toContain('GitHub did not return nobody/nothing-here')
})

test('an incomplete permalink is a 404 instead of falling through to the app', async () => {
  const response = await page('/r/octo')
  expect(response.status).toBe(404)
  expect(await response.text()).toContain('Map not found')
})

test('rejects anything that is not a GitHub repository link', async () => {
  const inputs = [
    '',
    'not a link',
    'https://gitlab.com/acme/atlas',
    'https://github.com',
    'https://github.com/acme',
    'https://github.com/acme/../secrets',
  ]
  for (const input of inputs) {
    const response = await call(input)
    expect(response.status).toBe(400)
    expect((await response.json()).code).toBe('invalid_url')
  }
})

test('turns a pasted link into the map model', async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/repos/octo/hello')) {
      return json({
        name: 'hello',
        full_name: 'octo/hello',
        owner: { login: 'octo', avatar_url: '' },
        description: 'A test repository',
        html_url: 'https://github.com/octo/hello',
        homepage: null,
        stargazers_count: 12,
        forks_count: 3,
        subscribers_count: 4,
        open_issues_count: 2,
        language: 'TypeScript',
        license: { spdx_id: 'MIT', name: 'MIT License' },
        topics: ['tree'],
        default_branch: 'main',
        created_at: '2025-01-01T00:00:00Z',
        pushed_at: '2026-11-25T10:00:00Z',
        size: 120,
        archived: false,
        fork: false,
        private: false,
        clone_url: 'https://github.com/octo/hello.git',
      })
    }
    if (url.includes('/branches')) {
      return json([
        { name: 'main', commit: { sha: 'abc1234def' }, protected: true },
        { name: 'feat/x', commit: { sha: 'def5678abc' }, protected: false },
      ])
    }
    if (url.includes('/pulls')) {
      return json([
        {
          number: 7,
          title: 'Add a tree',
          user: { login: 'sam', avatar_url: '' },
          head: { ref: 'feat/x', label: 'octo:feat/x', repo: { full_name: 'octo/hello' } },
          base: { ref: 'main' },
          draft: false,
          created_at: '2026-11-20T10:00:00Z',
          updated_at: '2026-11-25T10:00:00Z',
          html_url: 'https://github.com/octo/hello/pull/7',
          comments: 2,
          labels: [{ name: 'feature', color: '0e8a16' }],
        },
        {
          number: 9,
          title: 'Same branch name, from a fork',
          user: { login: 'rae', avatar_url: '' },
          head: { ref: 'feat/x', label: 'rae:feat/x', repo: { full_name: 'rae/hello' } },
          base: { ref: 'main' },
          draft: false,
          created_at: '2026-11-19T10:00:00Z',
          updated_at: '2026-11-24T10:00:00Z',
          html_url: 'https://github.com/octo/hello/pull/9',
          comments: 0,
          labels: [],
        },
      ])
    }
    if (url.includes('/languages')) return json({ TypeScript: 80, CSS: 20 })
    if (url.includes('/contributors')) {
      return json([{ login: 'sam', avatar_url: '', contributions: 12, html_url: 'https://github.com/sam' }])
    }
    if (url.includes('/commits')) {
      return json([
        {
          sha: 'abc1234def',
          html_url: 'https://github.com/octo/hello/commit/abc1234def',
          commit: { message: 'Add a tree\n\nA longer body', author: { date: '2026-11-25T10:00:00Z' } },
          author: { login: 'sam', avatar_url: '' },
        },
      ])
    }
    if (url.includes('/stats/commit_activity')) return json([{ week: 1, total: 3 }])
    return json({}, 404)
  }) as unknown as typeof fetch

  const response = await call('https://github.com/octo/hello/tree/main/packages')
  expect(response.status).toBe(200)

  const body = (await response.json()) as {
    repo: {
      fullName: string
      defaultBranch: string
      branches: { name: string; isDefault: boolean; pullRequests: number[] }[]
      pullRequests: { number: number; author: string; head: string }[]
      languages: { name: string; percent: number }[]
      commits: { message: string }[]
      commitActivity: number[]
    }
    source: string
  }

  expect(body.source).toBe('github')
  expect(body.repo.fullName).toBe('octo/hello')
  expect(body.repo.defaultBranch).toBe('main')
  expect(body.repo.branches[0]?.name).toBe('main')
  expect(body.repo.branches[0]?.isDefault).toBe(true)
  // A same-repository head attaches to its branch; a fork's branch of the same
  // name stays out of the tree even though it is an open pull request.
  expect(body.repo.branches.find((branch) => branch.name === 'feat/x')?.pullRequests).toEqual([7])
  expect(body.repo.branches.find((branch) => branch.name === 'feat/x')?.pullRequests).not.toContain(9)
  expect(body.repo.pullRequests.find((pull) => pull.number === 9)?.head).toBe('rae:feat/x')
  expect(body.repo.pullRequests.find((pull) => pull.number === 7)?.author).toBe('sam')
  expect(body.repo.languages[0]?.percent).toBe(80)
  expect(body.repo.commits[0]?.message).toBe('Add a tree')
  expect(body.repo.commitActivity).toEqual([3])
})

test('a list longer than the page cap is read to the cap and reported as a floor', async () => {
  const requested: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    requested.push(url)
    if (url.endsWith('/repos/octo/dense')) {
      return json(
        permalinkRepo({
          name: 'dense',
          full_name: 'octo/dense',
          html_url: 'https://github.com/octo/dense',
          clone_url: 'https://github.com/octo/dense.git',
        }),
      )
    }
    // Every page comes back full, so only the page cap can end the walk.
    const page = Number(new URL(url).searchParams.get('page') ?? '1')
    const offset = (page - 1) * 100
    if (url.includes('/branches')) {
      return json(
        Array.from({ length: 100 }, (_, index) => ({
          name: `b-${offset + index}`,
          commit: { sha: `sha${offset + index}` },
          protected: false,
        })),
      )
    }
    if (url.includes('/pulls')) {
      return json(
        Array.from({ length: 100 }, (_, index) => ({
          number: offset + index + 1,
          title: `Pull ${offset + index + 1}`,
          user: { login: 'sam', avatar_url: '' },
          head: { ref: `b-${offset + index}`, label: `octo:b-${offset + index}`, repo: { full_name: 'octo/dense' } },
          base: { ref: 'main' },
          draft: false,
          created_at: '2026-11-20T10:00:00Z',
          updated_at: '2026-11-25T10:00:00Z',
          html_url: `https://github.com/octo/dense/pull/${offset + index + 1}`,
          comments: 0,
          labels: [],
        })),
      )
    }
    if (url.includes('/languages')) return json({ TypeScript: 100 })
    if (url.includes('/contributors')) return json([])
    if (url.includes('/commits')) return json([])
    if (url.includes('/stats/commit_activity')) return json([])
    return json({}, 404)
  }) as unknown as typeof fetch

  const response = await call('https://github.com/octo/dense')
  expect(response.status).toBe(200)

  const body = (await response.json()) as {
    repo: { branches: unknown[]; pullRequests: unknown[]; truncated?: { branches: boolean; pullRequests: boolean } }
    notice: string | null
  }

  // Five full pages of 100 is the cap, and exactly the cap is a floor.
  expect(body.repo.branches.length).toBe(500)
  expect(body.repo.pullRequests.length).toBe(500)
  expect(body.repo.truncated).toEqual({ branches: true, pullRequests: true })
  expect(body.notice).toContain('Only the first 500 branches and open pull requests are read')
  expect(body.notice).toContain('floor rather than a total')

  const pageOf = (path: string) =>
    requested
      .filter((url) => url.includes(path))
      .map((url) => new URL(url).searchParams.get('page'))
  expect(pageOf('/branches')).toEqual(['1', '2', '3', '4', '5'])
  expect(pageOf('/pulls')).toEqual(['1', '2', '3', '4', '5'])
})

test('a list that ends before the page cap is not marked as a floor', async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/repos/octo/short')) {
      return json(
        permalinkRepo({
          name: 'short',
          full_name: 'octo/short',
          html_url: 'https://github.com/octo/short',
          clone_url: 'https://github.com/octo/short.git',
        }),
      )
    }
    const page = Number(new URL(url).searchParams.get('page') ?? '1')
    if (url.includes('/branches')) {
      return json(page === 1 ? [{ name: 'main', commit: { sha: 'abc1234def' }, protected: true }] : [])
    }
    if (url.includes('/pulls')) return json([])
    if (url.includes('/languages')) return json({ TypeScript: 100 })
    if (url.includes('/contributors')) return json([])
    if (url.includes('/commits')) return json([])
    if (url.includes('/stats/commit_activity')) return json([])
    return json({}, 404)
  }) as unknown as typeof fetch

  const body = (await (await call('https://github.com/octo/short')).json()) as {
    repo: { truncated?: unknown }
    notice: string | null
  }
  expect(body.repo.truncated).toBeUndefined()
  expect(body.notice).toBeNull()
})

// A capped list is a floor, and the share card and the map are two surfaces of
// the same fact. Both read the one formatter, so the plus sign cannot appear on
// one and go missing on the other.
test('a capped map permalink marks the branch count as a floor', async () => {
  const branches = Array.from({ length: 500 }, (_, index) => ({
    name: index === 0 ? 'main' : `b${index}`,
    commit: { sha: `sha${index}` },
    protected: false,
  }))
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/repos/octo/wide')) {
      return json(
        permalinkRepo({
          name: 'wide',
          full_name: 'octo/wide',
          html_url: 'https://github.com/octo/wide',
          clone_url: 'https://github.com/octo/wide.git',
        }),
      )
    }
    const pageNumber = Number(new URL(url).searchParams.get('page') ?? '1')
    if (url.includes('/branches')) return json(branches.slice((pageNumber - 1) * 100, pageNumber * 100))
    if (url.includes('/pulls')) return json([])
    if (url.includes('/languages')) return json({ TypeScript: 100 })
    if (url.includes('/contributors')) return json([])
    if (url.includes('/commits')) return json([])
    if (url.includes('/stats/commit_activity')) return json([])
    return json({}, 404)
  }) as unknown as typeof fetch

  const html = await (await page('/r/octo/wide')).text()
  expect(html).toContain('500+ branches, 0 open pull requests')
})

test('a missing repository is a clear 404, not a guessed map', async () => {
  globalThis.fetch = (async () => json({ message: 'Not Found' }, 404)) as unknown as typeof fetch
  const response = await call('https://github.com/nobody/nothing-here')
  expect(response.status).toBe(404)
  expect((await response.json()).code).toBe('not_found')
})
