import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Eye,
  FolderGit2,
  GitBranch,
  GitFork,
  GitPullRequest,
  MessageSquare,
  Shield,
  ShieldCheck,
  Star,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { compact, describeRepo, initials, plural, shortSha, timeAgo, type RepoModel } from '../lib/repo'
import { branchUrl } from '../lib/topology'
import { Container } from './Container'
import { TopologyCanvas } from './topology-canvas'

const LANGUAGE_COLORS = ['#ff7a45', '#ffb547', '#ff4d6d', '#7bd0b5', '#8aa4ff', '#a78bfa']

const mapUrl = (repo: RepoModel) =>
  typeof window === 'undefined'
    ? ''
    : `${window.location.origin}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`

type RepoMapProps = {
  repo: RepoModel
  live: boolean
  fetchedAt: string | null
  notice: string | null
}

export function RepoMap({ repo, live, fetchedAt, notice }: RepoMapProps) {
  const local = repo.local
  // A snapshot can stand alone, or be merged into a live GitHub map. Only the
  // standalone case has no pull requests to show.
  const localOnly = Boolean(local) && !live
  return (
    <section id="map" className="relative scroll-mt-20 pb-24">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-8">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-faint">The map</p>
            <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] sm:text-[32px]">
              {localOnly ? 'Local repository map' : live ? 'Repository map' : 'Sample repository map'}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-faint">
            <Badge variant={local ? 'warning' : live ? 'success' : 'muted'}>
              {localOnly ? 'Local snapshot' : live ? 'Live from GitHub' : 'Sample data'}
            </Badge>
            {local && !localOnly ? <Badge variant="warning">Local snapshot attached</Badge> : null}
            <span>
              {localOnly
                ? `Scanned ${timeAgo(local?.scannedAt ?? null)} · no pull requests`
                : live
                  ? `Read ${timeAgo(fetchedAt)} · cached 5 minutes${local ? ' · local checkout merged in' : ''}`
                  : 'Paste a link above to map a real repository'}
            </span>
          </div>
        </div>

        {notice && (
          <p className="mt-4 flex items-center gap-2 rounded-[12px] border border-brand-2/20 bg-brand-2/[0.05] px-3 py-2 text-[12px] text-dim">
            <AlertTriangle className="size-3.5 shrink-0 text-brand-2" />
            {notice}
          </p>
        )}

        <TopologyCanvas repo={repo} live={live} fetchedAt={fetchedAt} />

        <RepoHeader repo={repo} live={live} />

        {repo.local && <LocalWorktrees repo={repo} />}

        <div className="mt-4">
          <NarrativeCard repo={repo} />
        </div>

        <Tabs defaultValue="branches" className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="branches">
                <GitBranch />
                Branches
              </TabsTrigger>
              <TabsTrigger value="pulls">
                <GitPullRequest />
                Pull requests
                <span className="text-[10px] text-faint">{repo.pullRequests.length}</span>
              </TabsTrigger>
              <TabsTrigger value="activity">
                <Clock />
                Activity
              </TabsTrigger>
            </TabsList>
            <p className="text-[11px] text-faint">
              {local ? 'GitHub links open only when the clone has a remote.' : 'Every link opens on GitHub in a new tab.'}
            </p>
          </div>
          <TabsContent value="branches">
            <BranchTable repo={repo} />
          </TabsContent>
          <TabsContent value="pulls">
            <PullList repo={repo} />
          </TabsContent>
          <TabsContent value="activity">
            <Activity repo={repo} />
          </TabsContent>
        </Tabs>
      </Container>
    </section>
  )
}

function RepoHeader({ repo, live }: { repo: RepoModel; live: boolean }) {
  const local = repo.local
  const localOnly = Boolean(local) && !live
  const uncommitted = local ? local.worktrees.reduce((total, worktree) => total + worktree.dirty, 0) : 0
  return (
    <Card className="depth relative mt-4 overflow-hidden bg-surface/60">
      <CardContent className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <Avatar src={repo.avatarUrl} login={repo.owner} className="size-12 rounded-[14px] text-[13px]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={repo.htmlUrl || undefined}
                target={repo.htmlUrl ? '_blank' : undefined}
                rel={repo.htmlUrl ? 'noreferrer' : undefined}
                className="text-[20px] font-semibold tracking-[-0.02em] transition-colors hover:text-brand"
              >
                <span className="text-dim">{repo.owner}/</span>
                {repo.name}
              </a>
              {localOnly && <Badge variant="warning">Local snapshot</Badge>}
              {local && live && <Badge variant="warning">Local snapshot attached</Badge>}
              {localOnly && <Badge variant="muted">No pull requests</Badge>}
              {repo.isPrivate && <Badge variant="outline">Private</Badge>}
              {repo.archived && <Badge variant="outline">Archived</Badge>}
              {repo.fork && <Badge variant="outline">Fork</Badge>}
              {repo.license && <Badge variant="muted">{repo.license}</Badge>}
            </div>
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-dim">
              {repo.description ??
                (local ? `Read from the local clone at ${local.root}` : 'This repository has no description.')}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-faint">
              {local ? (
                <>
                  <Stat icon={<FolderGit2 className="size-3.5" />}>
                    {plural(local.worktrees.length, 'worktree', 'worktrees')}
                  </Stat>
                  <Stat icon={<GitBranch className="size-3.5" />}>
                    {plural(repo.branches.length, 'branch', 'branches')}
                  </Stat>
                  <Stat icon={<AlertTriangle className="size-3.5" />}>
                    {plural(uncommitted, 'uncommitted file', 'uncommitted files')}
                  </Stat>
                  <Stat icon={<Clock className="size-3.5" />}>scanned {timeAgo(local.scannedAt)}</Stat>
                </>
              ) : (
                <>
                  <Stat icon={<Star className="size-3.5" />}>{compact(repo.stars)} stars</Stat>
                  <Stat icon={<GitFork className="size-3.5" />}>{compact(repo.forks)} forks</Stat>
                  <Stat icon={<Eye className="size-3.5" />}>{compact(repo.watchers)} watching</Stat>
                  <Stat icon={<GitPullRequest className="size-3.5" />}>{compact(repo.openIssues)} open issues</Stat>
                  <Stat icon={<Clock className="size-3.5" />}>pushed {timeAgo(repo.pushedAt)}</Stat>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {live && <CopyButton value={mapUrl(repo)} label="Copy map link" />}
          {repo.htmlUrl && (
            <Button asChild variant="secondary" size="sm">
              <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                Open on GitHub
                <ArrowUpRight />
              </a>
            </Button>
          )}
          <CopyButton value={repo.cloneUrl} label={local ? 'Copy local path' : 'Copy clone URL'} />
        </div>
      </CardContent>
    </Card>
  )
}

function NarrativeCard({ repo }: { repo: RepoModel }) {
  const { sentences, attention } = describeRepo(repo)

  return (
    <Card className="flex flex-col">
      <CardHeader className="border-b border-line pb-4">
        <CardTitle className="text-[15px]">What this map says</CardTitle>
        <CardDescription className="mt-1">Plain words, read from the data.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col p-5">
        <ol className="space-y-3">
          {sentences.map((sentence, index) => (
            <li key={sentence} className="flex gap-2.5 text-[12.5px] leading-relaxed text-dim">
              <span className="round mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[10px] font-semibold text-faint">
                {index + 1}
              </span>
              <span>{sentence}</span>
            </li>
          ))}
        </ol>
        <div className="mt-auto pt-5">
          {attention.length > 0 ? (
            <div className="rounded-[14px] border border-brand-2/20 bg-brand-2/[0.05] p-3">
              <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-2">
                <AlertTriangle className="size-3.5" />
                Worth a look
              </p>
              <ul className="mt-2 space-y-1.5 text-[12px] text-dim">
                {attention.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-brand-2">·</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-[14px] bg-white/[0.03] p-3 text-[12px] text-dim">
              <ShieldCheck className="size-4 shrink-0 text-[#8ee0c4]" />
              Nothing needs attention on this map.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function BranchTable({ repo }: { repo: RepoModel }) {
  if (repo.branches.length === 0) {
    return <Empty>No branches yet. GitHub reports an empty history for this repository.</Empty>
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-faint">
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium">{repo.local ? 'Upstream' : 'Open PR'}</th>
              <th className="px-4 py-3 font-medium">Head</th>
              <th className="px-4 py-3 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {repo.branches.map((branch) => (
              <tr key={branch.name} className="border-b border-line last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={branchUrl(repo, branch.name) || undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono underline-offset-4 hover:text-brand hover:underline"
                    >
                      {branch.name}
                    </a>
                    {branch.isDefault && <Badge className="bg-brand/15 text-brand">Default</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {repo.local ? (
                      branch.upstream ? (
                        <>
                          <span className="font-mono text-[11.5px] text-dim">{branch.upstream}</span>
                          <span className="text-[11px] text-faint">
                            {branch.ahead ?? 0} ahead · {branch.behind ?? 0} behind
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-faint">local only</span>
                      )
                    ) : null}
                    {branch.pullRequests.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {branch.pullRequests.map((number) => (
                          <a
                            key={number}
                            href={`${repo.htmlUrl}/pull/${number}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-brand-2 hover:underline"
                          >
                            #{number}
                          </a>
                        ))}
                      </div>
                    ) : !repo.local ? (
                      <span className="text-faint">—</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-faint">{branch.sha ? shortSha(branch.sha) : '—'}</td>
                <td className="px-4 py-3">
                  {repo.local ? (
                    <Badge variant="muted">Local</Badge>
                  ) : branch.protected ? (
                    <Badge variant="outline">
                      <Shield />
                      Protected
                    </Badge>
                  ) : (
                    <Badge variant="muted">Open</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function PullList({ repo }: { repo: RepoModel }) {
  if (repo.pullRequests.length === 0) {
    return (
      <Empty>
        {repo.local
          ? 'A local snapshot carries no pull requests. They live on GitHub, not in a clone.'
          : 'No open pull requests. Every branch is shipped, parked, or still local.'}
      </Empty>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-line">
        {repo.pullRequests.map((pull) => (
          <a
            key={pull.number}
            href={pull.url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-2 p-4 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center"
          >
            <Avatar src={pull.avatarUrl} login={pull.author} className="size-7" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{pull.title}</span>
                {pull.draft && <Badge variant="muted">Draft</Badge>}
                {pull.labels.map((label) => (
                  <span
                    key={label.name}
                    className="rounded-full border px-2 py-0.5 text-[10px]"
                    style={{ borderColor: `#${label.color}66`, color: `#${label.color}` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                <span className="font-mono text-brand-2">#{pull.number}</span>
                <span>{pull.author}</span>
                <span>·</span>
                <span className="font-mono">
                  {pull.head} → {pull.base}
                </span>
                <span>·</span>
                <span>updated {timeAgo(pull.updatedAt)}</span>
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-faint">
              <MessageSquare className="size-3" />
              {pull.comments}
            </span>
            <ArrowUpRight className="size-3.5 shrink-0 text-faint" />
          </a>
        ))}
      </div>
    </Card>
  )
}

function Activity({ repo }: { repo: RepoModel }) {
  const total = repo.commitActivity.reduce((sum, week) => sum + week, 0)
  const peak = Math.max(...repo.commitActivity, 1)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Commits per week</CardTitle>
          <CardDescription>
            Last 12 weeks · {plural(total, 'commit', 'commits')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {repo.commitActivity.length > 0 ? (
            <div className="flex h-28 items-end gap-1.5">
              {repo.commitActivity.map((week, index) => (
                <div
                  key={index}
                  title={`${week} commits`}
                  className="flex-1 rounded-t-[4px] bg-gradient-to-t from-brand/25 to-brand transition-opacity hover:opacity-80"
                  style={{ height: `${Math.max(6, Math.round((week / peak) * 100))}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="py-6 text-[12px] text-faint">
              {repo.local
                ? 'No commits landed in the last 12 weeks.'
                : 'GitHub has not returned weekly activity for this repository yet.'}
            </p>
          )}
          <div className="mt-2 flex justify-between text-[10px] text-faint">
            <span>12 weeks ago</span>
            <span>This week</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Code and people</CardTitle>
          <CardDescription>
            {repo.languages.length > 0
              ? `${plural(repo.languages.length, 'language', 'languages')} · ${plural(repo.contributors.length, 'contributor', 'contributors')}`
              : repo.local
                ? 'A local scan does not read languages'
                : 'Language data unavailable'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {repo.languages.length > 0 && (
            <>
              <div className="flex h-2 overflow-hidden rounded-full">
                {repo.languages.map((language, index) => (
                  <span
                    key={language.name}
                    title={`${language.name} ${language.percent}%`}
                    style={{
                      width: `${language.percent}%`,
                      backgroundColor: LANGUAGE_COLORS[index % LANGUAGE_COLORS.length],
                    }}
                  />
                ))}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {repo.languages.map((language, index) => (
                  <li key={language.name} className="flex items-center gap-1.5 text-[11.5px] text-dim">
                    <span
                      className="round size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: LANGUAGE_COLORS[index % LANGUAGE_COLORS.length] }}
                    />
                    <span className="truncate">{language.name}</span>
                    <span className="ml-auto text-faint">{language.percent}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {repo.contributors.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-faint">
                <Users className="size-3" />
                Top contributors
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {repo.contributors.slice(0, 6).map((person) => (
                  <a
                    key={person.login}
                    href={person.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`${person.login} · ${person.contributions} contributions`}
                    className="flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2 text-[11px] text-dim transition-colors hover:border-line-strong hover:text-fg"
                  >
                    <Avatar src={person.avatarUrl} login={person.login} className="size-5 text-[9px]" />
                    {person.login}
                  </a>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Recent commits</CardTitle>
          <CardDescription>The newest commits on the default branch.</CardDescription>
        </CardHeader>
        <CardContent>
          {repo.commits.length > 0 ? (
            <ol className="divide-y divide-line">
              {repo.commits.map((commit) => (
                <li key={commit.sha}>
                  <a
                    href={commit.url || undefined}
                    target={commit.url ? '_blank' : undefined}
                    rel={commit.url ? 'noreferrer' : undefined}
                    className="flex items-center gap-3 py-2.5 transition-colors hover:text-fg"
                  >
                    <Avatar src={commit.avatarUrl} login={commit.author} className="size-6" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-dim">{commit.message || 'No commit message'}</p>
                      <p className="text-[10.5px] text-faint">
                        {commit.author} · {timeAgo(commit.date)}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">{shortSha(commit.sha)}</span>
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-4 text-[12px] text-faint">This repository has no commits yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function RepoMapSkeleton() {
  return (
    <section id="map" className="scroll-mt-20 pb-24">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line pt-8">
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-8 w-56" />
          </div>
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="mt-4 h-28 w-full rounded-lg" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Skeleton className="h-[430px] rounded-lg" />
          <Skeleton className="h-[430px] rounded-lg" />
        </div>
        <Skeleton className="mt-4 h-64 w-full rounded-lg" />
      </Container>
    </section>
  )
}

// Only a local snapshot carries worktrees, so this card never appears for a
// GitHub map. Every fact here comes from git on the machine that ran the scan.
function LocalWorktrees({ repo }: { repo: RepoModel }) {
  const local = repo.local
  if (!local) return null

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <CardTitle className="text-[15px]">Worktrees</CardTitle>
          <CardDescription className="mt-1">
            Every checkout of this clone, with its branch and working tree.
          </CardDescription>
        </div>
        <Badge variant="muted" className="font-mono">
          {plural(local.worktrees.length, 'worktree', 'worktrees')}
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-line">
          {local.worktrees.map((worktree) => (
            <li key={worktree.path} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-3">
              <FolderGit2 className="mt-0.5 hidden size-4 shrink-0 text-faint sm:block" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12.5px] font-medium">{shortPath(worktree.path)}</span>
                  {worktree.branch ? (
                    <Badge variant="muted">{worktree.branch}</Badge>
                  ) : (
                    <Badge variant="outline">detached</Badge>
                  )}
                  {worktree.bare && <Badge variant="outline">bare</Badge>}
                  {worktree.locked && <Badge variant="outline">locked</Badge>}
                  {worktree.prunable && <Badge variant="destructive">prunable</Badge>}
                </div>
                <p className="mt-1 break-all font-mono text-[10.5px] text-faint">{worktree.path}</p>
                {worktree.files?.length > 0 && (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {worktree.files.slice(0, 6).map((file, index) => (
                      <li
                        key={`${file.status}-${file.path}-${index}`}
                        className="flex min-w-0 gap-2 text-[11px] text-dim"
                      >
                        <span className="shrink-0 font-mono text-brand-2">{file.status}</span>
                        <span className="truncate font-mono">{file.path}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {(worktree.files?.length ?? 0) > 6 && (
                  <p className="mt-1 text-[10.5px] text-faint">+{(worktree.files?.length ?? 0) - 6} more files</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                <span className={worktree.dirty > 0 ? 'text-brand-2' : undefined}>
                  {plural(worktree.dirty, 'dirty file', 'dirty files')}
                </span>
                {worktree.branch && (
                  <span>
                    {worktree.ahead} ahead · {worktree.behind} behind
                  </span>
                )}
                <span>{worktree.lastCommit ? timeAgo(worktree.lastCommit) : 'no commits'}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-[10.5px] text-faint">
          <span>{plural(local.stashes, 'stash', 'stashes')}</span>
          <span>{local.upstream ? `upstream ${local.upstream}` : 'no upstream on the current branch'}</span>
          <span className="ml-auto">Scanned {timeAgo(local.scannedAt)} · nothing uploaded</span>
        </div>
      </CardContent>
    </Card>
  )
}

function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {children}
    </span>
  )
}

function Avatar({ src, login, className }: { src: string; login: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={cn(
        'round grid shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-[10px] font-semibold uppercase text-dim',
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        initials(login)
      )}
    </span>
  )
}

function CopyButton({ value, label = 'Copy clone URL' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => setCopied(false))
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-line bg-card p-6 text-[13px] text-faint">{children}</p>
}
