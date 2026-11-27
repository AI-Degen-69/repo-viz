import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  FileUp,
  FolderGit2,
  GitBranch,
  HardDrive,
  Loader2,
  Lock,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SnapshotSummary } from '../lib/local-snapshot'
import { timeAgo, type RepoModel } from '../lib/repo'

export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

type SnapshotPanelProps = {
  open: boolean
  onClose: () => void
  onFile: (file: File) => void
  current: RepoModel | null
  summary: SnapshotSummary | null
  error: string | null
  loading: boolean
  mismatch: { snapshot: SnapshotSummary; mapped: string } | null
  onConfirmMismatch: () => void
  onDiscardMismatch: () => void
}

const GENERATOR = 'topology-snapshot.mjs'

const WINDOWS_COMMANDS = [
  `# 1. Put ${GENERATOR} in your repository folder, then:`,
  `cd C:\\path\\to\\your-repo`,
  `node ${GENERATOR} .`,
  ``,
  `# 2. Upload the file it writes: topology-snapshot.json`,
].join('\n')

const UNIX_COMMANDS = [
  `# 1. Put ${GENERATOR} in your repository folder, then:`,
  `cd ~/projects/your-repo`,
  `node ${GENERATOR} .`,
  ``,
  `# 2. Upload the file it writes: topology-snapshot.json`,
].join('\n')

export function SnapshotPanel({
  open,
  onClose,
  onFile,
  current,
  summary,
  error,
  loading,
  mismatch,
  onConfirmMismatch,
  onDiscardMismatch,
}: SnapshotPanelProps) {
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<'generate' | 'upload'>('generate')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const takeFile = (file: File | null | undefined) => {
    if (!file) return
    onFile(file)
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/70 px-3 py-8 backdrop-blur-sm sm:items-center"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Connect your local Git workspace"
            className="depth relative w-full max-w-3xl overflow-hidden rounded-[20px] border border-line-strong bg-surface/95 shadow-glow"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-faint">
                  <FolderGit2 className="size-3" /> Local snapshot
                </p>
                <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">Connect your local Git workspace</h2>
                <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-dim">
                  Topology can map what GitHub knows, but it cannot see the branches and changes on your computer.
                  A local snapshot fills that gap.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close local snapshot panel"
                className="grid size-8 shrink-0 place-items-center rounded-[9px] text-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>

            {mismatch ? (
              <MismatchWarning
                mismatch={mismatch}
                onConfirm={onConfirmMismatch}
                onDiscard={onDiscardMismatch}
              />
            ) : summary ? (
              <LoadedSummary summary={summary} onClose={onClose} onReplace={() => inputRef.current?.click()} />
            ) : (
              <div className="px-5 py-4">
                <div className="flex gap-1 rounded-[11px] border border-line bg-white/[0.02] p-1">
                  <TabButton active={tab === 'generate'} onClick={() => setTab('generate')}>
                    <Terminal className="size-3.5" /> Generate a snapshot
                  </TabButton>
                  <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>
                    <FileUp className="size-3.5" /> Upload an existing file
                  </TabButton>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="mt-3 flex items-start gap-2 rounded-[10px] border border-brand-3/30 bg-brand-3/[0.06] px-3 py-2 text-[12px] leading-relaxed text-brand-3"
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {error}
                  </p>
                ) : null}

                {tab === 'generate' ? (
                  <div className="mt-4 space-y-4">
                    <ol className="grid gap-3 sm:grid-cols-2">
                      <Step number={1} title="Download the generator">
                        <p className="text-[11.5px] leading-relaxed text-dim">
                          A single read-only script. No install, no dependencies, no GitHub token.
                        </p>
                        <Button asChild variant="secondary" size="sm" className="mt-2.5">
                          <a href={`/${GENERATOR}`} download={GENERATOR}>
                            <Download /> {GENERATOR}
                          </a>
                        </Button>
                      </Step>
                      <Step number={2} title="Run it inside your clone">
                        <p className="text-[11.5px] leading-relaxed text-dim">
                          It writes <span className="font-mono text-fg/90">topology-snapshot.json</span> next to where
                          you run it. Nothing leaves your machine.
                        </p>
                        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
                          Needs Node.js 18 or newer. Git must be installed and on your PATH.
                        </p>
                      </Step>
                    </ol>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <CommandBlock label="Windows (PowerShell or CMD)" commands={WINDOWS_COMMANDS} />
                      <CommandBlock label="macOS / Linux" commands={UNIX_COMMANDS} />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoBox icon={<Check className="size-3.5 text-[#8ee0c4]" />} title="What it collects">
                        <ul className="space-y-1 text-[11.5px] leading-relaxed text-dim">
                          <li>· Repository name and remote URL</li>
                          <li>· Local branches, head SHAs and upstream tracking</li>
                          <li>· Ahead / behind counts where an upstream exists</li>
                          <li>· Worktrees, paths and checked-out branch</li>
                          <li>· Changed file paths and their status</li>
                          <li>· Recent commits and stash count</li>
                        </ul>
                      </InfoBox>
                      <InfoBox icon={<ShieldCheck className="size-3.5 text-[#8ee0c4]" />} title="What it never does">
                        <ul className="space-y-1 text-[11.5px] leading-relaxed text-dim">
                          <li>· Never reads file contents, .env values, tokens or environment variables</li>
                          <li>· Never writes to your repository or changes a branch</li>
                          <li>· Never uploads anything or contacts a server</li>
                          <li>· Use <span className="font-mono text-fg/90">--redact</span> to replace absolute paths and remote URLs</li>
                        </ul>
                      </InfoBox>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-white/[0.02] px-3 py-2.5">
                      <p className="text-[11px] text-faint">Already have a snapshot file?</p>
                      <Button variant="outline" size="sm" onClick={() => setTab('upload')}>
                        <FileUp /> Upload it
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        takeFile(event.dataTransfer.files?.[0])
                      }}
                      className={cn(
                        'rounded-[14px] border border-dashed p-6 text-center transition-colors',
                        dragging ? 'border-brand bg-brand/[0.06]' : 'border-line-strong bg-white/[0.015]',
                      )}
                    >
                      <span className="mx-auto grid size-10 place-items-center rounded-full bg-white/[0.05] text-dim">
                        {loading ? <Loader2 className="size-4 animate-spin" /> : <FileJson className="size-4" />}
                      </span>
                      <p className="mt-3 text-[13px] font-medium">
                        {loading ? 'Reading the snapshot…' : 'Drop topology-snapshot.json here'}
                      </p>
                      <p className="mt-1 text-[11.5px] text-faint">or choose a file from your computer</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        disabled={loading}
                        onClick={() => inputRef.current?.click()}
                      >
                        <FileUp /> Choose file
                      </Button>
                    </div>
                    <dl className="grid gap-1.5 rounded-[12px] border border-line bg-white/[0.02] px-3 py-2.5 text-[11px] text-faint sm:grid-cols-3">
                      <Detail label="File name" value="topology-snapshot.json" mono />
                      <Detail label="Format" value="Topology JSON · version 1" />
                      <Detail label="Maximum size" value="8 MB" />
                    </dl>
                    <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-faint">
                      <Lock className="mt-0.5 size-3.5 shrink-0 text-[#8ee0c4]" />
                      Your snapshot is read in this browser tab. It is never uploaded to our servers, and it is
                      discarded when you close the page.
                    </p>
                  </div>
                )}

                <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-[#8ee0c4]" />
                  Your snapshot is processed locally in this browser tab and is never uploaded to our servers.
                  Nothing in it leaves this machine unless you choose to open it here.
                </p>

                <input
                  ref={inputRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    takeFile(file)
                  }}
                />
              </div>
            )}

            {current && !summary && !mismatch ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 text-[11px] text-faint">
                <HardDrive className="size-3.5" />
                Currently mapped: <span className="font-mono text-dim">{current.fullName}</span>
                {current.local ? <Badge variant="warning">Local snapshot loaded</Badge> : null}
                <span className="ml-auto">
                  {current.local
                    ? 'A new snapshot replaces the local facts on this map.'
                    : 'A snapshot for the same repository is merged into this map.'}
                </span>
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] transition-colors',
        active ? 'bg-white/[0.07] text-fg shadow-sm' : 'text-faint hover:text-dim',
      )}
    >
      {children}
    </button>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-[12px] border border-line bg-white/[0.02] p-3">
      <p className="flex items-center gap-2 text-[12px] font-medium">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-[10px] text-brand">
          {number}
        </span>
        {title}
      </p>
      <div className="mt-1.5 pl-7">{children}</div>
    </li>
  )
}

function CommandBlock({ label, commands }: { label: string; commands: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="min-w-0 overflow-hidden rounded-[12px] border border-line bg-[#0a0807]">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5">
        <span className="truncate text-[10px] uppercase tracking-[0.12em] text-faint">{label}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              ?.writeText(commands)
              .then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              })
              .catch(() => setCopied(false))
          }}
          className="flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[10px] text-faint transition-colors hover:bg-white/[0.06] hover:text-fg"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-dim">
        <code>{commands}</code>
      </pre>
    </div>
  )
}

function InfoBox({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-line bg-white/[0.02] p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">
        {icon}
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9.5px] uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-[11px] text-dim', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}

function MismatchWarning({
  mismatch,
  onConfirm,
  onDiscard,
}: {
  mismatch: { snapshot: SnapshotSummary; mapped: string }
  onConfirm: () => void
  onDiscard: () => void
}) {
  return (
    <div className="px-5 py-5">
      <div className="rounded-[14px] border border-brand-2/30 bg-brand-2/[0.06] p-4">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-brand-2">
          <AlertTriangle className="size-4" /> This snapshot belongs to a different repository
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-dim">
          The snapshot describes <span className="font-mono text-fg">{mismatch.snapshot.fullName}</span>, but this map
          is showing <span className="font-mono text-fg">{mismatch.mapped}</span>. Loading it would mix two
          repositories on one canvas, so nothing has changed.
        </p>
        <ul className="mt-3 space-y-1 text-[11px] text-faint">
          <li>· Snapshot root: <span className="font-mono">{mismatch.snapshot.root || 'not recorded'}</span></li>
          <li>· Snapshot branches: {mismatch.snapshot.branches}</li>
          <li>· Snapshot worktrees: {mismatch.snapshot.worktrees}</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onDiscard}>
            Keep the current map
          </Button>
          <Button variant="outline" size="sm" onClick={onConfirm}>
            Open this snapshot on its own map
            <ChevronRight />
          </Button>
        </div>
        <p className="mt-2 text-[10.5px] text-faint">
          Opening it on its own replaces the GitHub map rather than merging the two.
        </p>
      </div>
    </div>
  )
}

function LoadedSummary({
  summary,
  onClose,
  onReplace,
}: {
  summary: SnapshotSummary
  onClose: () => void
  onReplace: () => void
}) {
  return (
    <div className="px-5 py-5">
      <div className="rounded-[14px] border border-[#8ee0c4]/25 bg-[#8ee0c4]/[0.05] p-4">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-[#8ee0c4]">
          <ShieldCheck className="size-4" /> Snapshot loaded
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-dim">
          Everything below was read in this tab. No file was uploaded.
        </p>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <SummaryRow label="Repository" value={summary.fullName} mono />
        <SummaryRow label="Snapshot created" value={summary.scannedAt ? timeAgo(summary.scannedAt) : 'unknown'} />
        <SummaryRow label="Local branches" value={String(summary.branches)} />
        <SummaryRow label="Worktrees" value={String(summary.worktrees)} />
        <SummaryRow
          label="Current checkout"
          value={summary.detached ? 'detached HEAD' : (summary.checkout ?? 'none')}
          mono
          icon={<GitBranch className="size-3" />}
        />
        <SummaryRow label="Modified files" value={String(summary.modifiedFiles)} />
        <SummaryRow label="Unpushed commits" value={String(summary.unpushedCommits)} />
        <SummaryRow label="Upstream" value={summary.remote ?? 'none recorded'} mono />
      </dl>

      <p className="mt-3 break-all font-mono text-[10.5px] text-faint">{summary.root}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onClose}>
          Show it on the map
          <ChevronRight />
        </Button>
        <Button variant="outline" size="sm" onClick={onReplace}>
          <FileUp /> Load another file
        </Button>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  mono,
  icon,
}: {
  label: string
  value: string
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-[10px] border border-line bg-white/[0.02] px-3 py-2">
      <dt className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-faint">
        {icon}
        {label}
      </dt>
      <dd className={cn('min-w-0 truncate text-[12px] text-dim', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}
