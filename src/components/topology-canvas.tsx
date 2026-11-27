import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronLeft,
  Clock,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Lock,
  MapPin,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { timeAgo, type RepoModel, type RepoPullRequest } from '../lib/repo'
import {
  branchUrl,
  layoutTopology,
  type TopologyBranchNode,
  type TopologyCommitNode,
  type TopologyLayout,
  type TopologyPullNode,
  type TopologyCheckout,
  type TopologySelection,
} from '../lib/topology'

// The Sacred Timeline: one horizontal spine for the default branch, branches
// curving away from it, pull requests pinned to the branch that opened them.
// Every node and edge comes from RepoModel through lib/topology.ts.

type View = { x: number; y: number; k: number }
type Tip = { id: string; x: number; y: number }
type HoverProps = {
  onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerLeave: () => void
}

const MIN_ZOOM = 0.06
const MAX_ZOOM = 2.6
const PANEL_WIDTH = 352
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

type TopologyCanvasProps = {
  repo: RepoModel
  live: boolean
  fetchedAt: string | null
}

export function TopologyCanvas({ repo, live, fetchedAt }: TopologyCanvasProps) {
  // Progressive disclosure: a 100-branch repository opens with the branches
  // that carry activity and offers the rest on request.
  const [expanded, setExpanded] = useState(false)
  const layout = useMemo(() => layoutTopology(repo, { expanded }), [repo, expanded])
  const pullsByNumber = useMemo(() => new Map(layout.pulls.map((pull) => [pull.number, pull])), [layout])

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ pointerId: number; x: number; y: number; origin: View } | null>(null)

  const [view, setView] = useState<View>(viewRef.current)
  const [animated, setAnimated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [selection, setSelection] = useState<TopologySelection | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)

  const applyView = useCallback((next: View, animate: boolean) => {
    viewRef.current = next
    setAnimated(animate)
    setView(next)
  }, [])

  // Every node, edge and the whole timeline inside the viewport — the true
  // birds-eye view, however far out that has to go.
  const fitAll = useCallback(
    (animate = true) => {
      if (!size.width || !size.height) return
      const pad = 56
      const zoom = clampZoom(Math.min((size.width - pad) / layout.width, (size.height - pad) / layout.height, 1.1))
      applyView(
        {
          k: zoom,
          x: (size.width - layout.width * zoom) / 2,
          y: (size.height - layout.height * zoom) / 2,
        },
        animate,
      )
    },
    [applyView, layout.height, layout.width, size.height, size.width],
  )

  // The opening position. When the topology is taller than the viewport (a
  // repository with dozens of branches), the whole thing would shrink to an
  // unreadable smudge, so the timeline is framed at a readable zoom instead and
  // the rest of the map is a pan away.
  const resetView = useCallback(
    (animate = true) => {
      if (!size.width || !size.height) return
      const pad = 56
      const fitWidth = (size.width - pad) / layout.width
      const fitHeight = (size.height - pad) / layout.height
      const whole = Math.min(fitWidth, fitHeight, 1.1)
      if (whole >= 0.42) {
        const k = clampZoom(whole)
        applyView(
          { k, x: (size.width - layout.width * k) / 2, y: (size.height - layout.height * k) / 2 },
          animate,
        )
        return
      }
      const k = Math.max(0.42, clampZoom(Math.min(fitWidth, 0.92)))
      applyView(
        {
          k,
          x: (size.width - layout.width * k) / 2,
          y: size.height / 2 - layout.spineY * k,
        },
        animate,
      )
    },
    [applyView, layout, size.height, size.width],
  )

  // Focus always centres in the part of the canvas the details panel leaves
  // visible; every caller of this opens the panel or keeps it open.
  const centerOn = useCallback(
    (x: number, y: number, zoom?: number) => {
      if (!size.width || !size.height) return
      const k = clampZoom(zoom ?? Math.max(viewRef.current.k, 0.85))
      const visible = Math.max(240, size.width - PANEL_WIDTH)
      applyView({ k, x: visible / 2 - x * k, y: size.height / 2 - y * k }, true)
    },
    [applyView, size.height, size.width],
  )

  const zoomBy = useCallback(
    (factor: number) => {
      if (!size.width || !size.height) return
      const current = viewRef.current
      const k = clampZoom(current.k * factor)
      const px = (size.width / 2 - current.x) / current.k
      const py = (size.height / 2 - current.y) / current.k
      applyView({ k, x: size.width / 2 - px * k, y: size.height / 2 - py * k }, true)
    },
    [applyView, size.height, size.width],
  )

  // Measure the viewport, then frame the topology inside it. The synchronous
  // read makes the first frame correct; the observer keeps it correct on
  // resize.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const measure = (width: number, height: number) => {
      setSize((current) =>
        Math.abs(current.width - width) < 0.5 && Math.abs(current.height - height) < 0.5
          ? current
          : { width, height },
      )
    }
    const rect = element.getBoundingClientRect()
    measure(rect.width, rect.height)
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) measure(box.width, box.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    resetView(false)
  }, [resetView])

  // Wheel zoom anchored under the cursor. React's onWheel is passive, so the
  // listener is attached directly so the page does not scroll instead.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const current = viewRef.current
      const k = clampZoom(current.k * Math.exp(-event.deltaY * 0.0016))
      const px = (sx - current.x) / current.k
      const py = (sy - current.y) / current.k
      applyView({ k, x: sx - px * k, y: sy - py * k }, false)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [applyView])

  useEffect(() => {
    if (!selection) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelection(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection])

  const select = useCallback(
    (next: TopologySelection | null) => {
      setSelection(next)
      setTip(null)
      if (!next) return
      if (next.kind === 'branch') {
        const node = layout.branches.find((branch) => branch.name === next.name)
        if (node) centerOn((node.forkX + node.headX) / 2, node.y, Math.max(viewRef.current.k, 0.9))
      } else if (next.kind === 'pull') {
        const node = pullsByNumber.get(next.number)
        if (node) centerOn(node.x - 40, node.y, Math.max(viewRef.current.k, 0.9))
      } else {
        const node = layout.commits.find((commit) => commit.sha === next.sha)
        if (node) centerOn(node.x, node.y, Math.max(viewRef.current.k, 1))
      }
    },
    [centerOn, layout.branches, layout.commits, pullsByNumber],
  )

  const toggleExpanded = useCallback(() => {
    setSelection(null)
    setTip(null)
    setExpanded((current) => !current)
  }, [])

  const selectedBranch =
    selection?.kind === 'branch' ? (layout.branches.find((branch) => branch.name === selection.name) ?? null) : null
  const selectedPullNode = selection?.kind === 'pull' ? (pullsByNumber.get(selection.number) ?? null) : null
  // A branch can carry more pull requests than the map has room to mark, so the
  // record comes from the model and the marker only supplies its map position.
  const selectedPull =
    selection?.kind === 'pull'
      ? (repo.pullRequests.find((pull) => pull.number === selection.number) ?? selectedPullNode?.pr ?? null)
      : null
  const selectedCommit =
    selection?.kind === 'commit' ? (layout.commits.find((commit) => commit.sha === selection.sha) ?? null) : null

  const highlightedBranch = selectedBranch?.name ?? selectedPullNode?.branch ?? null
  const highlightedPull = selectedPull?.number ?? null
  // Hovering a branch or pull request lights up its connectors without
  // requiring a click, so the relationships read while exploring.
  const hoveredBranch = tip?.id.startsWith('branch:') ? tip.id.slice('branch:'.length) : null
  const hoveredPull = tip?.id.startsWith('pull:') ? Number(tip.id.slice('pull:'.length)) : null
  const focusBranch = highlightedBranch ?? hoveredBranch
  const focusPull = highlightedPull ?? hoveredPull

  const backToTimeline = () => {
    setSelection(null)
    resetView(true)
  }

  // At an overview zoom, labels shrink into mush. The map keeps its nodes and
  // connectors and drops the text until the user zooms back in.
  const showLabels = view.k >= 0.48

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // Nodes, controls and the detail panel handle their own clicks. Without
    // this guard the canvas would capture the pointer and swallow them.
    if ((event.target as HTMLElement).closest('[data-node], [data-controls], aside')) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: viewRef.current }
    setDragging(true)
    setTip(null)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    setTip((current) => (current ? { ...current, x: localX, y: localY } : current))

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    applyView(
      {
        k: drag.origin.k,
        x: drag.origin.x + (event.clientX - drag.x),
        y: drag.origin.y + (event.clientY - drag.y),
      },
      false,
    )
  }

  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  const hovering = (id: string): HoverProps => ({
    onPointerEnter: (event) => {
      const rect = event.currentTarget.closest('[data-canvas]')?.getBoundingClientRect()
      if (!rect) return
      setTip({ id, x: event.clientX - rect.left, y: event.clientY - rect.top })
    },
    onPointerLeave: () => setTip(null),
  })

  const localOnly = Boolean(repo.local) && !live
  const sourceLabel = localOnly ? 'Local snapshot' : live ? 'Live from GitHub' : 'Sample data'
  const identity = repo.local?.root ?? `github.com/${repo.fullName}`
  const hereLabel = selectedBranch
    ? selectedBranch.name
    : selectedPullNode
      ? `PR #${selectedPullNode.number}`
      : selectedCommit
        ? `commit ${selectedCommit.short}`
        : `${layout.defaultBranch} HEAD`

  return (
    <section id="topology" className="relative mt-4 scroll-mt-20">
      <div className="depth relative overflow-hidden rounded-[20px] bg-surface/40">
        {/* Compact toolbar: identity, source, live status, current position. */}
        <div className="relative z-30 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface/70 px-4 py-2.5 backdrop-blur">
          <GitBranch className="size-3.5 shrink-0 text-faint" />
          {repo.htmlUrl ? (
            <a
              href={repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-body-sm text-dim transition-colors hover:text-fg"
            >
              {identity}
            </a>
          ) : (
            <span className="truncate font-mono text-body-sm text-dim">{identity}</span>
          )}
          <Badge variant={localOnly ? 'warning' : live ? 'success' : 'muted'}>{sourceLabel}</Badge>
          <span className="text-label text-faint">
            {layout.counts.branches}
            {repo.truncated?.branches ? '+' : ''}{' '}
            {layout.counts.branches === 1 && !repo.truncated?.branches ? 'branch' : 'branches'} · {layout.counts.pulls}
            {repo.truncated?.pullRequests ? '+' : ''} open{' '}
            {layout.counts.pulls === 1 && !repo.truncated?.pullRequests ? 'PR' : 'PRs'}
            {layout.hiddenBranches > 0 ? ` · ${layout.branches.length} drawn` : ''}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-label text-faint">
            <MapPin className="size-3 text-brand" />
            You are here: <span className="text-dim">{hereLabel}</span>
            {live && fetchedAt ? <span className="hidden text-faint sm:inline">· read {timeAgo(fetchedAt)}</span> : null}
          </span>
        </div>

        <div
          ref={viewportRef}
          data-canvas
          data-repo={repo.fullName}
          data-branches={layout.counts.branches}
          data-pulls={layout.counts.pulls}
          role="group"
          aria-label="Repository topology canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(
            'relative h-[calc(100dvh-270px)] max-h-[860px] min-h-[520px] w-full select-none overflow-hidden bg-[#0a0807]',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          style={{ touchAction: 'none' }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(ellipse 60% 55% at 50% 50%, rgb(255 122 69 / 0.08), transparent 72%)',
            }}
          />

          <div
            className="absolute left-0 top-0 origin-top-left"
            data-labels={showLabels ? 'on' : 'off'}
            style={{
              width: layout.width,
              height: layout.height,
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`,
              transformOrigin: '0 0',
              transition: animated ? 'transform 380ms cubic-bezier(.22,1,.36,1)' : 'none',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgb(255 236 224 / 0.035) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 236 224 / 0.035) 1px, transparent 1px)',
                backgroundSize: '56px 56px',
                maskImage: 'radial-gradient(ellipse 60% 55% at 50% 50%, #000 30%, transparent 85%)',
              }}
            />

            <svg width={layout.width} height={layout.height} className="absolute left-0 top-0" aria-hidden="true">
              <defs>
                <linearGradient id="topo-spine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="rgb(255 122 69 / 0.25)" />
                  <stop offset="0.8" stopColor="rgb(255 181 71 / 0.8)" />
                  <stop offset="1" stopColor="rgb(255 122 69 / 0.45)" />
                </linearGradient>
                <marker id="topo-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L7,4 L0,8 Z" fill="rgb(255 181 71 / 0.75)" />
                </marker>
              </defs>

              {/* The central spine: the default branch, flowing left to right. */}
              <line
                x1={layout.startX}
                y1={layout.spineY}
                x2={layout.endX}
                y2={layout.spineY}
                stroke="rgb(255 122 69 / 0.1)"
                strokeWidth={20}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={layout.startX}
                y1={layout.spineY}
                x2={layout.endX}
                y2={layout.spineY}
                stroke="rgb(255 122 69 / 0.22)"
                strokeWidth={5}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={layout.startX}
                y1={layout.spineY}
                x2={layout.endX}
                y2={layout.spineY}
                stroke="url(#topo-spine)"
                strokeWidth={2.6}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* Branch paths, then their pull-request links back to the target. */}
              {layout.branchEdges.map((edge) => {
                const active = edge.branch === focusBranch
                const muted = Boolean(focusBranch) && !active
                return (
                  <path
                    key={edge.id}
                    d={edge.d}
                    fill="none"
                    stroke={
                      active ? 'rgb(255 122 69 / 0.9)' : muted ? 'rgb(255 236 224 / 0.05)' : 'rgb(255 236 224 / 0.17)'
                    }
                    strokeWidth={active ? 2 : 1}
                    strokeDasharray={edge.dashed ? '3 7' : undefined}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}

              {layout.pullEdges.map((edge) => {
                const active = focusPull === edge.number
                const muted = Boolean(focusPull) && !active
                return (
                  <path
                    key={edge.id}
                    d={edge.d}
                    fill="none"
                    stroke={
                      active ? 'rgb(255 181 71 / 0.95)' : muted ? 'rgb(255 181 71 / 0.08)' : 'rgb(255 181 71 / 0.2)'
                    }
                    strokeWidth={active ? 1.6 : 1}
                    strokeDasharray="3 5"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    markerEnd={active ? 'url(#topo-arrow)' : undefined}
                  />
                )
              })}

              {/* Dashed connector between the remote HEAD card and the head node. */}
              <line
                x1={layout.head.x}
                y1={layout.spineY - 46}
                x2={layout.head.x}
                y2={layout.spineY - 12}
                stroke="rgb(255 122 69 / 0.35)"
                strokeDasharray="3 3"
              />
            </svg>

            {/* Repository origin: where the whole topology begins. */}
            {showLabels ? (
            <a
              href={repo.htmlUrl || undefined}
              target={repo.htmlUrl ? '_blank' : undefined}
              rel={repo.htmlUrl ? 'noreferrer' : undefined}
              className="absolute z-20 block w-[180px] -translate-y-1/2"
              style={{ left: 24, top: layout.spineY }}
            >
              <span className="flex items-center gap-1.5 font-mono text-label text-dim">
                {repo.local ? <GitBranch className="size-3" /> : <GitFork className="size-3" />}
                <span className="truncate">{repo.local ? 'local clone' : `github.com/${repo.fullName}`}</span>
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-micro uppercase tracking-[0.16em] text-faint">
                Repository origin
                {repo.archived ? <span>· archived</span> : null}
              </span>
            </a>
            ) : null}

            {/* Default branch marker, prominent against ordinary branches. */}
            {showLabels ? (
            <div
              className="absolute z-20 flex -translate-y-full items-center gap-2"
              style={{ left: layout.startX + 2, top: layout.spineY - 12 }}
            >
              <span className="flex items-center gap-1.5 rounded-full bg-brand/15 px-2 py-0.5 font-mono text-label text-brand">
                {layout.defaultBranch}
                <span className="text-micro uppercase tracking-[0.16em] text-brand/80">default</span>
                {layout.head.protected ? <Lock className="size-2.5" /> : null}
              </span>
            </div>
            ) : null}

            {/* Remote HEAD: the latest known commit on the default branch. */}
            {showLabels ? (
            <div
              className="absolute z-20 w-[248px] rounded-[14px] border border-brand/25 bg-surface/95 p-2.5 backdrop-blur-sm"
              style={{ left: layout.endX - 248, top: layout.spineY - 132 }}
            >
              <p className="flex items-center gap-1 text-micro uppercase tracking-[0.16em] text-brand">
                <MapPin className="size-2.5" />
                Remote HEAD
                {layout.head.protected ? <Lock className="ml-auto size-2.5 text-faint" /> : null}
              </p>
              <p className="mt-1 flex items-baseline gap-1.5 font-mono text-body-sm">
                <span className="truncate text-fg">{layout.head.name}</span>
                <span className="shrink-0 text-faint">@ {layout.head.short}</span>
              </p>
              <p className="mt-0.5 truncate text-label text-dim">{layout.head.message}</p>
              <p className="mt-1 text-micro leading-relaxed text-faint">
                {layout.head.date ? `updated ${timeAgo(layout.head.date)}` : 'date not fetched'} · the newest commit
                GitHub knows on this branch, not a local checkout
              </p>
            </div>
            ) : null}

            {layout.counts.approximate > 0 ? (
              <div
                className="pointer-events-none absolute z-10 max-w-[220px] text-micro leading-relaxed text-faint"
                style={{ left: layout.startX, top: layout.spineY + 30 }}
              >
                dashed forks = merge-base not fetched
              </div>
            ) : null}

            {layout.commits.map((commit) => (
              <CommitNode
                key={commit.id}
                commit={commit}
                showLabel={showLabels}
                selected={selection?.kind === 'commit' && selection.sha === commit.sha}
                onSelect={() => setSelection({ kind: 'commit', sha: commit.sha })}
                hoverProps={hovering(commit.id)}
              />
            ))}

            {layout.branches.map((branch) => (
              <BranchNode
                key={branch.id}
                branch={branch}
                showLabel={showLabels}
                selected={highlightedBranch === branch.name}
                muted={Boolean(highlightedBranch) && highlightedBranch !== branch.name}
                onSelect={() => select({ kind: 'branch', name: branch.name })}
                hoverProps={hovering(branch.id)}
              />
            ))}

            {layout.checkouts.map((checkout) => (
              <CheckoutMarker key={checkout.id} checkout={checkout} showLabel={showLabels} />
            ))}

            {layout.pulls.map((pull) => {
              const branchNode = pull.branch
                ? layout.branches.find((branch) => branch.name === pull.branch)
                : undefined
              const extra = branchNode ? Math.max(0, branchNode.prNumbers.length - 2) : 0
              return (
                <PullMarker
                  key={pull.id}
                  pull={pull}
                  extra={extra}
                  showLabel={showLabels}
                  selected={highlightedPull === pull.number}
                  muted={Boolean(highlightedPull) && highlightedPull !== pull.number}
                  onSelect={() => select({ kind: 'pull', number: pull.number })}
                  hoverProps={hovering(pull.id)}
                />
              )
            })}

            <HereMarker
              x={
                selectedBranch
                  ? selectedBranch.headX
                  : selectedPullNode
                    ? selectedPullNode.x
                    : selectedCommit
                      ? selectedCommit.x
                      : layout.head.x
              }
              y={
                selectedBranch
                  ? selectedBranch.y
                  : selectedPullNode
                    ? selectedPullNode.y
                    : selectedCommit
                      ? selectedCommit.y
                      : layout.head.y
              }
              side={selectedBranch ? selectedBranch.side : 0}
              label={hereLabel}
              showLabel={showLabels}
            />

            {!layout.historyKnown ? (
              <div
                className="absolute z-20 text-caption text-faint"
                style={{ left: layout.startX, top: layout.spineY + 22 }}
              >
                No default-branch commits fetched · the spine is shown from the branch list
              </div>
            ) : null}
          </div>

          {/* --- screen-space overlays ------------------------------------- */}

          <div className="pointer-events-none absolute left-3 top-3 z-20 hidden items-center gap-2 rounded-full border border-line bg-bg/70 px-2.5 py-1 text-caption text-faint backdrop-blur sm:flex">
            <span>Drag to pan</span>
            <span className="text-line-strong">·</span>
            <span>Scroll to zoom</span>
            <span className="text-line-strong">·</span>
            <span>Click a branch to focus</span>
          </div>

          {selection ? (
            <div data-controls className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
              <button
                type="button"
                onClick={backToTimeline}
                className="flex items-center gap-1.5 rounded-full border border-brand/30 bg-surface/90 px-3 py-1 text-label text-dim shadow-glow backdrop-blur transition-colors hover:border-brand/60 hover:text-fg"
              >
                <ChevronLeft className="size-3" />
                Back to the timeline
              </button>
            </div>
          ) : null}

          {layout.hiddenBranches > 0 || (expanded && layout.collapsible) ? (
            <div data-controls className="absolute right-3 top-3 z-30">
              <button
                type="button"
                onClick={toggleExpanded}
                className="flex items-center gap-1.5 rounded-full border border-line-strong bg-surface/90 px-3 py-1 text-label text-dim shadow-glow backdrop-blur transition-colors hover:border-brand/50 hover:text-fg"
              >
                <GitBranch className="size-3" />
                {layout.hiddenBranches > 0 ? (
                  <>
                    Show {layout.hiddenBranches} more {layout.hiddenBranches === 1 ? 'branch' : 'branches'}
                    {layout.hiddenPulls > 0 ? <span className="text-faint"> · {layout.hiddenPulls} PRs</span> : null}
                  </>
                ) : (
                  'Show the active branches only'
                )}
              </button>
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 left-3 z-20 hidden max-w-[calc(100%-150px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-line bg-bg/70 px-2.5 py-1.5 text-caption text-faint backdrop-blur sm:flex">
            <Legend tone="spine">Default timeline</Legend>
            <Legend tone="pr">Open PR</Legend>
            <Legend tone="draft">Draft PR</Legend>
            <Legend tone="protected">Protected</Legend>
            <Legend tone="approx">Approximate fork</Legend>
            <Legend tone="idle">No open PR</Legend>
            {localOnly ? <Legend tone="checkout">Local checkout</Legend> : null}
          </div>

          <div
            data-controls
            className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 rounded-[12px] border border-line bg-surface/85 p-1 backdrop-blur"
          >
            <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
              <Minus />
            </IconButton>
            <span className="w-9 text-center font-mono text-caption text-faint">{Math.round(view.k * 100)}%</span>
            <IconButton label="Zoom in" onClick={() => zoomBy(1.3)}>
              <Plus />
            </IconButton>
            <span className="mx-1 h-4 w-px bg-line" />
            <IconButton label="Fit the whole topology" onClick={() => fitAll(true)}>
              <Maximize2 />
            </IconButton>
            <IconButton
              label="Reset position"
              onClick={() => {
                setSelection(null)
                resetView(true)
              }}
            >
              <RotateCcw />
            </IconButton>
          </div>

          {tip ? <Tooltip tip={tip} layout={layout} width={size.width} height={size.height} /> : null}

          {selection ? (
            <DetailPanel
              repo={repo}
              layout={layout}
              branch={selectedBranch}
              commit={selectedCommit}
              pull={selectedPull}
              pullNode={selectedPullNode}
              onClose={() => setSelection(null)}
              onSelect={select}
              onFocus={centerOn}
              onBack={backToTimeline}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-caption text-faint">
          <span>
            {layout.counts.approximate > 0
              ? `${layout.counts.approximate} of ${layout.branches.length} drawn branches have an approximate fork point.`
              : 'Every drawn branch has a fork point taken from fetched commits.'}
            {layout.hiddenBranches > 0
              ? ` ${layout.hiddenBranches} more ${layout.hiddenBranches === 1 ? 'branch is' : 'branches are'} available with “Show more”.`
              : ''}
          </span>
          <span className="hidden sm:inline">
            {repo.local
              ? 'Remote HEAD, viewing position and LOCAL CHECKOUT are three different things.'
              : 'YOU ARE HERE marks what you are viewing, not your local checkout.'}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Lock className="size-2.5" /> Read-only
          </span>
        </div>
      </div>
    </section>
  )
}

function CommitNode({
  commit,
  showLabel,
  selected,
  onSelect,
  hoverProps,
}: {
  commit: TopologyCommitNode
  showLabel: boolean
  selected: boolean
  onSelect: () => void
  hoverProps: HoverProps
}) {
  return (
    <>
      <button
        type="button"
        data-node
        {...hoverProps}
        onClick={onSelect}
        aria-label={`Commit ${commit.short}: ${commit.message}`}
        className="absolute z-20 grid size-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full"
        style={{ left: commit.x, top: commit.y }}
      >
        <span
          className={cn(
            'round block rounded-full transition-transform',
            commit.isHead
              ? 'size-[11px] border-2 border-brand bg-brand/60 shadow-[0_0_0_5px_rgb(255_122_69/0.14)]'
              : selected
                ? 'size-[9px] border-2 border-brand-2 bg-brand-2/60'
                : 'size-[7px] border border-line-strong bg-[#0a0807] hover:border-brand-2 hover:bg-brand-2/40',
          )}
        />
      </button>
      {showLabel ? (
        <span
          className={cn(
            'pointer-events-none absolute z-10 w-[132px] -translate-x-1/2 truncate text-center text-micro leading-tight',
            commit.isHead ? 'text-brand/85' : 'text-faint/70',
          )}
          style={{ left: commit.x, top: commit.y + 14 }}
          title={commit.message}
        >
          {commit.message}
        </span>
      ) : null}
    </>
  )
}

function BranchNode({
  branch,
  showLabel,
  selected,
  muted,
  onSelect,
  hoverProps,
}: {
  branch: TopologyBranchNode
  showLabel: boolean
  selected: boolean
  muted: boolean
  onSelect: () => void
  hoverProps: HoverProps
}) {
  return (
    <button
      type="button"
      data-node
      {...hoverProps}
      onClick={onSelect}
      aria-label={`Branch ${branch.name}`}
      title={`${branch.name}\n${branch.exact ? 'Fork point: exact' : 'Fork point: approximate'}`}
      className={cn(
        'absolute z-20 flex -translate-y-1/2 items-center gap-2 text-left transition-opacity',
        muted ? 'opacity-40' : 'opacity-100',
      )}
      style={{ left: branch.headX, top: branch.y }}
    >
      <span
        className={cn(
          'round -ml-1.5 size-[13px] shrink-0 rounded-full border-2 transition-shadow',
          selected && 'shadow-[0_0_0_6px_rgb(255_122_69/0.16)]',
          branch.state === 'idle'
            ? 'border-line-strong bg-[#0a0807]'
            : branch.state === 'draft'
              ? 'border-dashed border-brand-2/80 bg-brand-2/20'
              : 'border-brand-2 bg-brand-2/35',
        )}
      />
      <span className={cn('min-w-0', !showLabel && 'hidden')}>
        <span
          className={cn(
            'block max-w-[252px] truncate font-mono text-label leading-tight',
            selected ? 'text-brand' : branch.stale ? 'text-faint' : 'text-fg/90',
          )}
        >
          {branch.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-micro leading-tight text-faint">
          <span className="font-mono">{branch.short}</span>
          {branch.protected ? <Lock className="size-2.5" aria-label="protected" /> : null}
          {branch.state === 'idle' ? <span>· no open PR</span> : null}
          {branch.state === 'draft' ? <span>· draft PR</span> : null}
          {branch.stale ? <span>· stale</span> : null}
          {branch.local && branch.ahead > 0 ? (
            <span className="text-[#8ee0c4]">· {branch.ahead} unpushed</span>
          ) : null}
          {branch.local && !branch.upstream ? <span className="text-faint/70">· local only</span> : null}
          {!branch.exact ? <span className="text-faint/70">· approx</span> : null}
        </span>
        <span className="sr-only">
          {branch.prNumbers.length > 0
            ? `${branch.prNumbers.length} open pull request${branch.prNumbers.length === 1 ? '' : 's'}`
            : 'no open pull request'}
          {branch.local ? ', local snapshot' : ''}
        </span>
      </span>
    </button>
  )
}

function PullMarker({
  pull,
  extra,
  showLabel,
  selected,
  muted,
  onSelect,
  hoverProps,
}: {
  pull: TopologyPullNode
  extra: number
  showLabel: boolean
  selected: boolean
  muted: boolean
  onSelect: () => void
  hoverProps: HoverProps
}) {
  return (
    <button
      type="button"
      data-node
      {...hoverProps}
      onClick={onSelect}
      aria-label={`Pull request ${pull.number}: ${pull.pr.title}`}
      className={cn(
        'absolute z-20 flex -translate-y-1/2 items-center gap-1 rounded-full border px-1.5 py-[2px] font-mono text-caption backdrop-blur-sm transition-all',
        muted ? 'opacity-40' : 'opacity-100',
        selected
          ? 'border-brand-2 bg-brand-2/25 text-brand-2 shadow-[0_0_0_4px_rgb(255_181_71/0.12)]'
          : pull.pr.draft
            ? 'border-dashed border-brand-2/60 bg-surface/85 text-dim hover:text-fg'
            : 'border-brand-2/45 bg-surface/85 text-dim hover:text-fg',
      )}
      style={{ left: pull.x, top: pull.y }}
    >
      {pull.external ? <GitFork className="size-2.5 shrink-0" /> : <GitPullRequest className="size-2.5 shrink-0" />}
      {showLabel ? (
        <>
          <span className="shrink-0">#{pull.number}</span>
          <span className="shrink-0 text-faint">→ {pull.target.name}</span>
          {pull.pr.draft ? <span className="shrink-0 uppercase tracking-[0.08em] text-brand-2/80">draft</span> : null}
          {pull.external ? <span className="shrink-0 text-faint">fork</span> : null}
          {extra > 0 ? <span className="shrink-0 text-faint">+{extra}</span> : null}
        </>
      ) : null}
    </button>
  )
}

// A marker that only exists when a snapshot was loaded. It is deliberately a
// different shape and colour from the remote HEAD card and YOU ARE HERE.
function CheckoutMarker({ checkout, showLabel }: { checkout: TopologyCheckout; showLabel: boolean }) {
  if (!showLabel) return null
  const offset = checkout.side === -1 ? -34 : checkout.side === 1 ? 34 : 34
  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: checkout.x,
        top: checkout.y + offset,
        transform: 'translate(-50%,0)',
      }}
    >
      <span className="flex flex-col items-center gap-0.5">
        <span className="flex items-center gap-1 rounded-[6px] border border-[#8ee0c4]/45 bg-[#8ee0c4]/10 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-[0.12em] text-[#8ee0c4]">
          <FolderGit2 className="size-2.5" /> Local checkout
        </span>
        <span className="max-w-[210px] truncate font-mono text-micro text-[#8ee0c4]/80">
          {checkout.branch ?? 'detached HEAD'}
          {checkout.ahead > 0 ? ` · ${checkout.ahead} unpushed` : ''}
          {checkout.dirty > 0 ? ` · ${checkout.dirty} file${checkout.dirty === 1 ? '' : 's'}` : ''}
          {checkout.worktrees > 1 ? ` · ${checkout.worktrees} worktrees` : ''}
        </span>
      </span>
    </div>
  )
}

function HereMarker({
  x,
  y,
  side,
  label,
  showLabel,
}: {
  x: number
  y: number
  side: -1 | 0 | 1
  label: string
  showLabel: boolean
}) {
  return (
    <div
      className="absolute z-30"
      style={{
        left: x,
        // Grow away from the spine on a branch, so the marker never covers the
        // pull-request chips that sit on the spine side of the branch.
        top: side === -1 ? y - 30 : side === 1 ? y + 30 : y + 46,
        transform: side === -1 ? 'translate(-50%,-100%)' : 'translate(-50%,0)',
      }}
      title="You are viewing this position. It is not your local checkout."
    >
      <span className="flex flex-col items-center">
        <span className="flex items-center gap-1 rounded-full border border-brand/40 bg-brand/15 px-2 py-0.5 text-micro font-semibold uppercase tracking-[0.14em] text-brand">
          <MapPin className="size-2.5" />
          You are here
        </span>
        {showLabel ? (
          <span className="mt-0.5 max-w-[170px] truncate font-mono text-micro text-faint">{label}</span>
        ) : null}
      </span>
    </div>
  )
}

function Legend({
  tone,
  children,
}: {
  tone: 'spine' | 'pr' | 'draft' | 'protected' | 'approx' | 'idle' | 'checkout'
  children: ReactNode
}) {
  return (
    <span className="flex items-center gap-1.5">
      {tone === 'spine' ? (
        <span className="block h-[2px] w-4 rounded-full bg-gradient-to-r from-brand/40 to-brand-2" />
      ) : tone === 'protected' ? (
        <Lock className="size-2.5" />
      ) : tone === 'checkout' ? (
        <span className="block size-2 rounded-[2px] border border-[#8ee0c4]/60 bg-[#8ee0c4]/25" />
      ) : tone === 'approx' ? (
        <span className="block w-4 border-t border-dashed border-line-strong" />
      ) : (
        <span
          className={cn(
            'round size-2 rounded-full border',
            tone === 'pr'
              ? 'border-brand-2 bg-brand-2/40'
              : tone === 'draft'
                ? 'border-dashed border-brand-2/70 bg-transparent'
                : 'border-line-strong bg-transparent',
          )}
        />
      )}
      {children}
    </span>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-[8px] text-dim transition-colors hover:bg-white/[0.06] hover:text-fg [&_svg]:size-3.5"
    >
      {children}
    </button>
  )
}

function Tooltip({ tip, layout, width, height }: { tip: Tip; layout: TopologyLayout; width: number; height: number }) {
  const [kind, ...rest] = tip.id.split(':')
  const key = rest.join(':')

  let body: ReactNode = null
  if (kind === 'branch') {
    const branch = layout.branches.find((node) => node.name === key)
    if (branch) {
      body = (
        <>
          <TipTitle icon={<GitBranch className="size-3" />} text={branch.name} mono />
          <TipRow label="Head" value={branch.short || 'no commits'} mono />
          <TipRow label="Last update" value={branch.lastUpdate ? timeAgo(branch.lastUpdate) : 'not fetched'} />
          <TipRow label="Protection" value={branch.protected ? 'Protected' : 'Unprotected'} />
          <TipRow
            label="Pull requests"
            value={branch.prNumbers.length > 0 ? branch.prNumbers.map((number) => `#${number}`).join(', ') : 'none open'}
          />
          <TipRow label="Fork point" value={branch.exact ? 'exact' : 'approximate'} />
          {branch.local ? (
            <>
              <TipRow label="Upstream" value={branch.upstream ?? 'none (local only)'} mono />
              <TipRow label="Ahead / behind" value={`${branch.ahead} / ${branch.behind}`} />
            </>
          ) : null}
        </>
      )
    }
  } else if (kind === 'commit') {
    const commit = layout.commits.find((node) => node.sha === key)
    if (commit) {
      body = (
        <>
          <TipTitle icon={<GitCommitHorizontal className="size-3" />} text={commit.message} />
          <TipRow label="Author" value={commit.author} />
          <TipRow label="Commit" value={commit.short} mono />
          <TipRow label="Date" value={commit.date ? timeAgo(commit.date) : 'unknown'} />
          <p className="mt-1.5 text-caption text-faint">On {layout.defaultBranch}</p>
        </>
      )
    }
  } else if (kind === 'pull') {
    const pull = layout.pulls.find((node) => node.number === Number(key))?.pr
    if (pull) {
      body = (
        <>
          <TipTitle icon={<GitPullRequest className="size-3" />} text={`#${pull.number} ${pull.title}`} />
          <TipRow label="Author" value={pull.author} />
          <TipRow label="State" value={pull.draft ? 'Draft · open' : 'Open'} />
          <TipRow label="Source" value={pull.head} mono />
          <TipRow label="Target" value={pull.base} mono />
          <TipRow label="Updated" value={timeAgo(pull.updatedAt)} />
        </>
      )
    }
  }

  if (!body) return null

  const left = Math.min(Math.max(tip.x, 128), Math.max(width - 128, 128))
  const top = Math.max(tip.y - 12, 140)
  return (
    <div
      className="pointer-events-none absolute z-40 w-[248px] -translate-x-1/2 -translate-y-full rounded-[12px] border border-line-strong bg-surface-2/95 px-2.5 py-2 text-label shadow-glow backdrop-blur"
      style={{ left, top: Math.min(top, height - 12) }}
    >
      {body}
    </div>
  )
}

function TipTitle({ icon, text, mono }: { icon: ReactNode; text: string; mono?: boolean }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-label leading-snug text-fg', mono && 'font-mono')}>
      <span className="mt-0.5 shrink-0 text-brand-2">{icon}</span>
      <span className="line-clamp-2">{text}</span>
    </p>
  )
}

function TipRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="mt-1 flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-micro uppercase tracking-[0.1em] text-faint">{label}</span>
      <span className={cn('truncate text-caption text-dim', mono && 'font-mono')}>{value}</span>
    </p>
  )
}

type DetailPanelProps = {
  repo: RepoModel
  layout: TopologyLayout
  branch: TopologyBranchNode | null
  commit: TopologyCommitNode | null
  pull: RepoPullRequest | null
  pullNode: TopologyPullNode | null
  onClose: () => void
  onSelect: (selection: TopologySelection | null) => void
  onFocus: (x: number, y: number) => void
  onBack: () => void
}

function DetailPanel({ repo, layout, branch, commit, pull, pullNode, onClose, onSelect, onFocus, onBack }: DetailPanelProps) {
  const branchPulls = branch
    ? branch.prNumbers
        .map((number) => repo.pullRequests.find((item) => item.number === number))
        .filter((item): item is RepoPullRequest => Boolean(item))
    : []
  const branchCommit = branch ? layout.commits.find((item) => item.sha === branch.sha) : undefined

  return (
    <aside
      aria-label="Selected element details"
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute inset-y-0 right-0 z-40 flex w-full max-w-[352px] flex-col border-l border-line bg-surface/95 backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-[0.2em] text-faint">
            {branch ? 'Branch' : commit ? 'Commit' : 'Pull request'}
          </p>
          <h3 className={cn('mt-1 break-words text-lead font-semibold leading-snug', branch && 'font-mono')}>
            {branch ? branch.name : commit ? commit.message : `#${pull?.number ?? ''} ${pull?.title ?? ''}`}
          </h3>
          {(branch || pull) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {branch ? (
                <>
                  {branch.protected ? (
                    <Badge variant="outline">
                      <Lock /> Protected
                    </Badge>
                  ) : null}
                  {branch.state === 'idle' ? <Badge variant="muted">No open PR</Badge> : null}
                  {branch.state === 'draft' ? <Badge variant="warning">Draft PR</Badge> : null}
                  {branch.state === 'pr' ? <Badge variant="warning">Open PR</Badge> : null}
                  {branch.stale ? <Badge variant="muted">Stale</Badge> : null}
                  {!branch.exact ? <Badge variant="outline">Approximate fork</Badge> : null}
                </>
              ) : null}
              {pull ? (
                <Badge variant={pull.draft ? 'warning' : 'success'}>{pull.draft ? 'Draft · open' : 'Open'}</Badge>
              ) : null}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid size-7 shrink-0 place-items-center rounded-[8px] text-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-body-sm">
        {branch ? (
          <>
            <dl className="space-y-2">
              <PanelRow label="Head commit" value={<span className="font-mono">{branch.short || 'no commits'}</span>} />
              <PanelRow
                label="Last activity"
                value={branch.lastUpdate ? `${timeAgo(branch.lastUpdate)} · from its pull request` : 'Not fetched'}
              />
              <PanelRow label="Open PRs" value={branch.prNumbers.length > 0 ? branch.prNumbers.length : 'none'} />
              <PanelRow label="Fork point" value={branch.exact ? 'Exact — head is a fetched commit' : 'Approximate'} />
              {branch.local ? (
                <>
                  <PanelRow
                    label="Upstream"
                    value={<span className="font-mono">{branch.upstream ?? 'none — local only'}</span>}
                  />
                  <PanelRow
                    label="Ahead / behind"
                    value={`${branch.ahead} unpushed · ${branch.behind} behind`}
                  />
                </>
              ) : null}
            </dl>

            <div
              className={cn(
                'rounded-[12px] border p-2.5 text-label leading-relaxed',
                branch.exact ? 'border-line bg-white/[0.02] text-dim' : 'border-brand-2/20 bg-brand-2/[0.05] text-dim',
              )}
            >
              {branch.exact ? (
                <span className="flex gap-1.5">
                  <GitCommitHorizontal className="mt-0.5 size-3 shrink-0 text-[#8ee0c4]" />
                  This branch points at a commit that was fetched on {layout.defaultBranch}, so its attachment is exact.
                </span>
              ) : (
                <span className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-brand-2" />
                  GitHub&apos;s branch list has no merge-base, so this branch is attached at a deterministic approximate
                  point on the timeline. The dashed connector says the fork point is unknown.
                </span>
              )}
            </div>

            <section>
              <p className="text-micro uppercase tracking-[0.16em] text-faint">Commits</p>
              {branchCommit ? (
                <button
                  type="button"
                  onClick={() => onSelect({ kind: 'commit', sha: branchCommit.sha })}
                  className="mt-2 flex w-full items-start gap-2 rounded-[10px] bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <GitCommitHorizontal className="mt-0.5 size-3 shrink-0 text-dim" />
                  <span className="min-w-0">
                    <span className="block truncate text-label text-dim">{branchCommit.message}</span>
                    <span className="font-mono text-caption text-faint">{branchCommit.short}</span>
                  </span>
                </button>
              ) : (
                <p className="mt-1.5 text-label leading-relaxed text-faint">
                  Only the branch head is in the fetched data, so individual commits on this branch are not drawn.
                </p>
              )}
            </section>

            <section>
              <p className="text-micro uppercase tracking-[0.16em] text-faint">Pull requests</p>
              {branchPulls.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {branchPulls.map((item) => (
                    <li key={item.number}>
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: 'pull', number: item.number })}
                        className="flex w-full items-center gap-2 rounded-[10px] bg-white/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                      >
                        <GitPullRequest className="size-3 shrink-0 text-brand-2" />
                        <span className="shrink-0 font-mono text-caption text-brand-2">#{item.number}</span>
                        <span className="min-w-0 flex-1 truncate text-label text-dim">{item.title}</span>
                        {item.draft ? <span className="shrink-0 text-micro uppercase text-faint">draft</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-label leading-relaxed text-faint">
                  {repo.local
                    ? 'A local snapshot carries no pull requests.'
                    : 'No open pull request opens from this branch.'}
                </p>
              )}
            </section>
          </>
        ) : null}

        {commit ? (
          <>
            <dl className="space-y-2">
              <PanelRow label="Commit" value={<span className="font-mono">{commit.sha.slice(0, 12)}</span>} />
              <PanelRow label="Author" value={commit.author} />
              <PanelRow label="Date" value={commit.date ? new Date(commit.date).toLocaleString() : 'Unknown'} />
              <PanelRow label="Relative" value={commit.date ? timeAgo(commit.date) : 'unknown'} />
            </dl>
            <p className="text-label leading-relaxed text-faint">
              One of the recent commits fetched for {layout.defaultBranch}. Its position on the spine is its order in
              that list.
            </p>
          </>
        ) : null}

        {pull ? (
          <>
            <dl className="space-y-2">
              <PanelRow label="Number" value={<span className="font-mono">#{pull.number}</span>} />
              <PanelRow label="Author" value={pull.author} />
              <PanelRow label="Source" value={<span className="font-mono">{pull.head}</span>} />
              <PanelRow label="Target" value={<span className="font-mono">{pull.base}</span>} />
              <PanelRow label="Updated" value={timeAgo(pull.updatedAt)} />
              <PanelRow
                label="Comments"
                value={
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {pull.comments}
                  </span>
                }
              />
            </dl>

            {pull.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {pull.labels.map((label) => (
                  <span
                    key={label.name}
                    className="rounded-full border px-2 py-0.5 text-caption"
                    style={{ borderColor: `#${label.color}66`, color: `#${label.color}` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="space-y-2 rounded-[12px] border border-line bg-white/[0.02] p-2.5 text-label leading-relaxed text-dim">
              <p className="flex gap-1.5">
                <GitFork className="mt-0.5 size-3 shrink-0 text-faint" />
                {pullNode?.external
                  ? 'This PR comes from a fork: its head branch is not in this repository, so it hangs off its target on the spine.'
                  : `Opened from ${pullNode?.branch ?? pull.head}.`}
              </p>
              {pullNode && !pullNode.target.known ? (
                <p className="flex gap-1.5 text-brand-2">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  It targets {pullNode.target.name}, a branch this canvas does not draw (it may be grouped, or missing
                  from the fetched branch list).
                </p>
              ) : null}
              {pullNode?.branch ? (
                <p className="flex gap-1.5">
                  <GitBranch className="mt-0.5 size-3 shrink-0 text-faint" />
                  The source branch is in this repository, so the marker sits on it.
                </p>
              ) : null}
            </div>

            {branch ? (
              <p className="text-caption text-faint">Also shown as a marker on {branch.name}.</p>
            ) : null}
          </>
        ) : null}

        {selectionNote(repo)}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        {branch ? (
          <>
            {repo.htmlUrl ? (
              <Button asChild variant="secondary" size="sm">
                <a href={branchUrl(repo, branch.name)} target="_blank" rel="noreferrer">
                  Open branch
                  <ArrowUpRight />
                </a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onFocus((branch.forkX + branch.headX) / 2, branch.y)}>
              Center on branch
            </Button>
          </>
        ) : null}
        {commit ? (
          commit.url ? (
            <Button asChild variant="secondary" size="sm">
              <a href={commit.url} target="_blank" rel="noreferrer">
                Open commit
                <ArrowUpRight />
              </a>
            </Button>
          ) : null
        ) : null}
        {pull ? (
          <>
            <Button asChild variant="secondary" size="sm">
              <a href={pull.url} target="_blank" rel="noreferrer">
                Open pull request
                <ArrowUpRight />
              </a>
            </Button>
            {pullNode?.branch ? (
              <Button variant="outline" size="sm" onClick={() => onSelect({ kind: 'branch', name: pullNode.branch! })}>
                Show source branch
              </Button>
            ) : null}
          </>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto text-faint" onClick={onBack}>
          <ChevronLeft />
          Main timeline
        </Button>
      </div>
    </aside>
  )
}

function PanelRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0 last:pb-0">
      <dt className="shrink-0 text-micro uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="min-w-0 truncate text-right text-label text-dim">{value}</dd>
    </div>
  )
}

// A single honest note about what this data can and cannot say.
function selectionNote(repo: RepoModel) {
  return (
    <p className="flex gap-1.5 border-t border-line pt-3 text-caption leading-relaxed text-faint">
      <Clock className="mt-0.5 size-2.5 shrink-0" />
      {repo.local
        ? 'A local snapshot shows this clone. Positions describe branches, not checkouts.'
        : 'Positions describe the remote repository on GitHub. Nothing here is your local checkout.'}
    </p>
  )
}
