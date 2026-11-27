import { expect, test } from 'bun:test'

import { mergeLocalSnapshot, summarizeSnapshot, SnapshotError } from '../src/lib/local-snapshot'
import { layoutTopology } from '../src/lib/topology'
import type { RepoBranch, RepoModel } from '../src/lib/repo'

const NOW = '2026-11-27T12:00:00.000Z'
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString()

function repo(branches: RepoBranch[], extra: Partial<RepoModel> = {}): RepoModel {
  return {
    owner: 'acme',
    name: 'atlas',
    fullName: 'acme/atlas',
    description: null,
    htmlUrl: 'https://github.com/acme/atlas',
    homepage: null,
    avatarUrl: '',
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    language: 'TypeScript',
    license: 'MIT',
    topics: [],
    defaultBranch: 'main',
    createdAt: daysAgo(400),
    pushedAt: daysAgo(1),
    sizeKb: 100,
    archived: false,
    fork: false,
    isPrivate: false,
    cloneUrl: 'https://github.com/acme/atlas.git',
    branches,
    pullRequests: [],
    languages: [],
    contributors: [],
    commits: [
      {
        sha: 'a'.repeat(40),
        message: 'Third commit',
        author: 'ada',
        avatarUrl: '',
        date: daysAgo(1),
        url: '',
      },
      {
        sha: 'b'.repeat(40),
        message: 'Second commit',
        author: 'ada',
        avatarUrl: '',
        date: daysAgo(2),
        url: '',
      },
      {
        sha: 'c'.repeat(40),
        message: 'First commit',
        author: 'ada',
        avatarUrl: '',
        date: daysAgo(3),
        url: '',
      },
    ],
    commitActivity: new Array(12).fill(0),
    ...extra,
  }
}

const branch = (name: string, sha: string, extra: Partial<RepoBranch> = {}): RepoBranch => ({
  name,
  sha,
  isDefault: name === 'main',
  protected: false,
  pullRequests: [],
  ...extra,
})

test('every count and name in the layout comes from the one repository passed in', () => {
  const first = repo([branch('main', 'a'.repeat(40)), branch('feature/a', 'x'.repeat(40))])
  const second = repo([branch('main', 'a'.repeat(40)), branch('fix/b', 'y'.repeat(40)), branch('chore/c', 'z'.repeat(40))], {
    owner: 'other',
    name: 'project',
    fullName: 'other/project',
  })

  const a = layoutTopology(first)
  const b = layoutTopology(second)

  expect(a.defaultBranch).toBe('main')
  expect(a.counts.branches).toBe(2)
  expect(a.branches.map((node) => node.name)).toEqual(['feature/a'])
  expect(a.head.name).toBe('main')

  expect(b.counts.branches).toBe(3)
  expect(b.branches.map((node) => node.name).sort()).toEqual(['chore/c', 'fix/b'])
  // Names never leak between the two layouts.
  expect(b.branches.some((node) => node.name === 'feature/a')).toBe(false)
  expect(a.branches.some((node) => node.name === 'fix/b')).toBe(false)
})

test('a large repository starts with a readable subset and expands to all branches', () => {
  const branches = [branch('main', 'a'.repeat(40))]
  for (let index = 0; index < 100; index += 1) {
    branches.push(branch(`feature/branch-${String(index).padStart(3, '0')}`, `${index}`.padStart(40, '0')))
  }
  const big = repo(branches)

  const collapsed = layoutTopology(big)
  expect(collapsed.counts.branches).toBe(101)
  expect(collapsed.collapsible).toBe(true)
  expect(collapsed.branches.length).toBeLessThan(101)
  // One default branch plus the drawn subset plus the hidden remainder.
  expect(collapsed.branches.length + collapsed.hiddenBranches + 1).toBe(101)

  const expanded = layoutTopology(big, { expanded: true })
  expect(expanded.hiddenBranches).toBe(0)
  expect(expanded.branches).toHaveLength(100)

  // A small repository has nothing to collapse.
  expect(layoutTopology(repo([branch('main', 'a'.repeat(40)), branch('feature/a', 'b'.repeat(40))])).collapsible).toBe(
    false,
  )
})

test('a branch head that is a fetched commit is exact; one that is not is explicitly approximate', () => {
  const layout = layoutTopology(
    repo([
      branch('main', 'a'.repeat(40)),
      branch('release/2.4', 'b'.repeat(40)),
      branch('feature/unknown', 'f'.repeat(40)),
    ]),
  )

  const exact = layout.branches.find((node) => node.name === 'release/2.4')
  const approximate = layout.branches.find((node) => node.name === 'feature/unknown')

  expect(exact?.exact).toBe(true)
  expect(approximate?.exact).toBe(false)
  expect(layout.counts.approximate).toBe(1)
  expect(layout.branchEdges.find((edge) => edge.branch === 'feature/unknown')?.dashed).toBe(true)
  expect(layout.branchEdges.find((edge) => edge.branch === 'release/2.4')?.dashed).toBe(false)
})

test('at most two pull-request markers per branch, with no edge to a hidden marker', () => {
  const pulls = Array.from({ length: 4 }, (_, index) => ({
    number: index + 1,
    title: `Pull ${index + 1}`,
    author: 'ada',
    avatarUrl: '',
    head: 'acme:feature/a',
    base: 'main',
    draft: false,
    createdAt: daysAgo(4),
    updatedAt: daysAgo(index + 1),
    url: `https://github.com/acme/atlas/pull/${index + 1}`,
    comments: 0,
    labels: [],
  }))
  const featured = repo([branch('main', 'a'.repeat(40)), branch('feature/a', 'b'.repeat(40), { pullRequests: [1, 2, 3, 4] })], {
    pullRequests: pulls,
  })

  const layout = layoutTopology(featured)
  expect(layout.pulls).toHaveLength(2)
  expect(layout.pullEdges).toHaveLength(2)
  expect(layout.branches[0]?.prNumbers).toHaveLength(4)
})

test('labels reserve room to the right of the longest branch name', () => {
  const longName = 'feature/a-very-long-branch-name-that-would-otherwise-clip'
  const layout = layoutTopology(repo([branch('main', 'a'.repeat(40)), branch(longName, 'b'.repeat(40))]))
  const node = layout.branches.find((item) => item.name === longName)

  expect(node).toBeDefined()
  expect(layout.width).toBeGreaterThan((node?.headX ?? 0) + 150)
})

test('a snapshot for the same repository merges local facts and keeps GitHub pull requests', () => {
  const remote = repo(
    [branch('main', 'a'.repeat(40)), branch('feature/a', 'b'.repeat(40))],
    {
      pullRequests: [
        {
          number: 7,
          title: 'Feature A',
          author: 'ada',
          avatarUrl: '',
          head: 'acme:feature/a',
          base: 'main',
          draft: false,
          createdAt: daysAgo(4),
          updatedAt: daysAgo(2),
          url: 'https://github.com/acme/atlas/pull/7',
          comments: 1,
          labels: [],
        },
      ],
    },
  )
  remote.branches[1]!.pullRequests = [7]

  const localSnapshot = repo(
    [
      branch('main', 'a'.repeat(40), { upstream: 'origin/main', ahead: 0, behind: 0 }),
      branch('feature/a', 'e'.repeat(40), { upstream: 'origin/feature/a', ahead: 3, behind: 1 }),
      branch('spike/local', 'f'.repeat(40), { upstream: null }),
    ],
    {
      pullRequests: [],
      local: {
        scannedAt: NOW,
        root: 'C:\\work\\atlas',
        upstream: 'origin/main',
        stashes: 2,
        dirtyFiles: [{ path: 'src/a.ts', status: 'M' }],
        worktrees: [
          {
            path: 'C:\\work\\atlas',
            branch: 'main',
            head: 'a'.repeat(40),
            detached: false,
            bare: false,
            locked: null,
            prunable: false,
            dirty: 1,
            files: [{ path: 'src/a.ts', status: 'M' }],
            ahead: 0,
            behind: 0,
            lastCommit: daysAgo(1),
          },
          {
            path: 'C:\\work\\atlas-feature',
            branch: 'feature/a',
            head: 'e'.repeat(40),
            detached: false,
            bare: false,
            locked: null,
            prunable: false,
            dirty: 0,
            files: [],
            ahead: 3,
            behind: 1,
            lastCommit: daysAgo(1),
          },
        ],
      },
    },
  )

  const merged = mergeLocalSnapshot(remote, localSnapshot)

  expect(merged.fullName).toBe('acme/atlas')
  expect(merged.pullRequests).toHaveLength(1)
  expect(merged.branches.map((item) => item.name).sort()).toEqual(['feature/a', 'main', 'spike/local'])
  expect(merged.branches.find((item) => item.name === 'feature/a')?.ahead).toBe(3)
  expect(merged.branches.find((item) => item.name === 'spike/local')?.upstream).toBeNull()
  expect(merged.local?.worktrees).toHaveLength(2)

  const summary = summarizeSnapshot(merged)
  expect(summary.branches).toBe(3)
  expect(summary.worktrees).toBe(2)
  expect(summary.checkout).toBe('main')
  expect(summary.modifiedFiles).toBe(1)
  expect(summary.unpushedCommits).toBe(3)

  const layout = layoutTopology(merged)
  expect(layout.checkouts.length).toBeGreaterThan(0)
  expect(layout.checkouts.some((checkout) => checkout.branch === 'main')).toBe(true)
  expect(layout.branches.find((item) => item.name === 'feature/a')?.local).toBe(true)
})

test('a snapshot for a different repository is refused instead of merged', () => {
  const remote = repo([branch('main', 'a'.repeat(40))])
  const other = repo([branch('main', 'a'.repeat(40))], { owner: 'other', name: 'project', fullName: 'other/project' })

  expect(() => mergeLocalSnapshot(remote, other)).toThrow(SnapshotError)
  expect(() => mergeLocalSnapshot(remote, other)).toThrow('other/project')
})

test('local checkout markers appear only when a snapshot is attached', () => {
  const plain = repo([branch('main', 'a'.repeat(40)), branch('feature/a', 'b'.repeat(40))])
  expect(layoutTopology(plain).checkouts).toHaveLength(0)

  const local = repo([branch('main', 'a'.repeat(40)), branch('feature/a', 'b'.repeat(40))], {
    local: {
      scannedAt: NOW,
      root: '/work/atlas',
      upstream: 'origin/main',
      stashes: 0,
      dirtyFiles: [],
      worktrees: [
        {
          path: '/work/atlas',
          branch: 'main',
          head: 'a'.repeat(40),
          detached: false,
          bare: false,
          locked: null,
          prunable: false,
          dirty: 0,
          files: [],
          ahead: 0,
          behind: 0,
          lastCommit: daysAgo(1),
        },
      ],
    },
  })

  const layout = layoutTopology(local)
  expect(layout.checkouts).toHaveLength(1)
  expect(layout.checkouts[0]?.branch).toBe('main')
})
