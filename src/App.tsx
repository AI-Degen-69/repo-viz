import { useCallback, useRef, useState } from 'react'

import { RepoMap, RepoMapSkeleton } from './components/repo-map'
import { MAX_SNAPSHOT_BYTES, SnapshotPanel } from './components/snapshot-panel'
import { AnalyzeError, analyzeRepo, type AnalyzeResult } from './lib/api'
import {
  mergeLocalSnapshot,
  parseSnapshotFile,
  SnapshotError,
  summarizeSnapshot,
  type SnapshotSummary,
} from './lib/local-snapshot'
import { SAMPLE_REPO, type RepoModel } from './lib/repo'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { Nav } from './sections/Nav'

// A map permalink is rendered by the Worker with the repo model embedded, so
// the first paint is the real map instead of a skeleton or the sample.
function readInitialResult(): AnalyzeResult | null {
  if (typeof document === 'undefined') return null
  const node = document.getElementById('initial-data')
  if (!node?.textContent) return null
  try {
    const parsed = JSON.parse(node.textContent) as { kind?: string; data?: AnalyzeResult }
    return parsed.kind === 'repo' && parsed.data?.repo?.fullName ? parsed.data : null
  } catch {
    return null
  }
}

const initialResult = readInitialResult()

export function App() {
  const [value, setValue] = useState(initialResult?.repo.fullName ?? '')
  const [result, setResult] = useState<AnalyzeResult | null>(initialResult)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const mapRef = useRef<HTMLDivElement | null>(null)

  // Every accepted mapping gets a number. The map and its canvas are keyed by
  // it, so no selection, pan, tooltip or expand state can outlive the
  // repository it belongs to.
  const sessionRef = useRef(0)
  const [sessionKey, setSessionKey] = useState(0)

  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [snapshotSummary, setSnapshotSummary] = useState<SnapshotSummary | null>(null)
  const [pendingSnapshot, setPendingSnapshot] = useState<{ repo: RepoModel; summary: SnapshotSummary } | null>(null)
  const [mismatch, setMismatch] = useState<{ snapshot: SnapshotSummary; mapped: string } | null>(null)

  // Two frames: the first lets the hero collapse, the second scrolls the canvas
  // to the top of the freshly laid-out page.
  const scrollToMap = () => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })),
    )
  }

  const applyResult = useCallback((next: AnalyzeResult) => {
    const id = (sessionRef.current += 1)
    setResult(next)
    setSessionKey(id)
    setValue(next.repo.fullName)
    setSnapshotSummary(null)
    setMismatch(null)
    setPendingSnapshot(null)
  }, [])

  const analyze = useCallback(
    async (raw: string) => {
      const url = raw.trim()
      if (!url) {
        setError('Paste a GitHub repository link first.')
        return
      }

      requestRef.current?.abort()
      const controller = new AbortController()
      requestRef.current = controller
      const id = (sessionRef.current += 1)
      setLoading(true)
      setError(null)
      setSnapshotError(null)

      try {
        const data = await analyzeRepo(url, controller.signal)
        // A slow earlier request must never paint over a newer mapping.
        if (id !== sessionRef.current) return
        applyResult(data)
        scrollToMap()
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        if (id !== sessionRef.current) return
        setError(caught instanceof AnalyzeError ? caught.message : 'Could not read that repository. Try again.')
      } finally {
        if (requestRef.current === controller) setLoading(false)
      }
    },
    [applyResult],
  )

  // A local snapshot is read in this tab. A snapshot for the repository that is
  // already mapped is merged into it; a snapshot for a different repository is
  // never merged silently.
  const openSnapshot = useCallback(
    async (file: File) => {
      requestRef.current?.abort()
      const id = (sessionRef.current += 1)
      setLoading(true)
      setSnapshotError(null)
      setMismatch(null)
      setPendingSnapshot(null)

      try {
        if (file.size > MAX_SNAPSHOT_BYTES) {
          throw new SnapshotError(
            `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Snapshots must be 8 MB or smaller.`,
          )
        }
        const text = await file.text()
        if (id !== sessionRef.current) return
        const parsed = parseSnapshotFile(text)
        if (id !== sessionRef.current) return
        const summary = summarizeSnapshot(parsed)

        const current = result
        const mappedFromGitHub = current?.source === 'github'
        const sameRepository =
          mappedFromGitHub && current.repo.fullName.toLowerCase() === parsed.fullName.trim().toLowerCase()

        if (mappedFromGitHub && !sameRepository) {
          setPendingSnapshot({ repo: parsed, summary })
          setMismatch({ snapshot: summary, mapped: current.repo.fullName })
          setLoading(false)
          return
        }

        const repo = sameRepository ? mergeLocalSnapshot(current!.repo, parsed) : parsed
        // The snapshot message must not drop a notice the GitHub read already
        // raised — a capped list or a partial read still applies.
        const snapshotNotice = sameRepository
          ? `Local snapshot from ${summary.checkout ?? 'a detached HEAD'} merged into this GitHub map.`
          : null
        applyResult({
          repo,
          source: sameRepository ? 'github' : 'local',
          notice: [current?.notice, snapshotNotice].filter(Boolean).join(' ') || null,
          fetchedAt: repo.local?.scannedAt ?? new Date().toISOString(),
        })
        setSnapshotSummary(summary)
        setSnapshotOpen(true)
        scrollToMap()
      } catch (caught) {
        if (id !== sessionRef.current) return
        setSnapshotError(caught instanceof SnapshotError ? caught.message : `Could not read ${file.name}.`)
      } finally {
        setLoading(false)
      }
    },
    [applyResult, result],
  )

  const openSnapshotPanel = useCallback(() => {
    setSnapshotError(null)
    setSnapshotOpen(true)
  }, [])

  const repo = result?.repo ?? SAMPLE_REPO

  return (
    <>
      {/* While the panel is open the page behind it is inert and hidden from
          screen readers. The dialog is a sibling of this block, so it stays
          reachable. */}
      <div inert={snapshotOpen} aria-hidden={snapshotOpen || undefined}>
        <Nav />
        <main>
          <Hero
            value={value}
            onValueChange={setValue}
            onSubmit={analyze}
            onOpenSnapshot={openSnapshotPanel}
            loading={loading}
            error={error}
            compact={result !== null}
          />
          <div ref={mapRef} className="scroll-mt-20">
            {loading && result ? (
              <div className="w-full px-5 pt-4 sm:px-8">
                <p className="flex items-center gap-2 rounded-[10px] border border-line bg-white/[0.03] px-3 py-2 text-body-sm text-dim">
                  <span className="size-2 animate-pulse rounded-full bg-brand" />
                  Reading <span className="font-mono text-fg">{value || 'the new repository'}</span> — the map below
                  still shows <span className="font-mono text-fg">{result.repo.fullName}</span> until the new data arrives.
                </p>
              </div>
            ) : null}
            {loading && !result ? (
              <RepoMapSkeleton />
            ) : (
              <RepoMap
                key={sessionKey}
                repo={repo}
                live={result?.source === 'github'}
                fetchedAt={result?.fetchedAt ?? null}
                notice={result?.notice ?? null}
              />
            )}
          </div>
        </main>
        <Footer />
      </div>

      <SnapshotPanel
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        onFile={openSnapshot}
        current={result?.source === 'github' ? result.repo : null}
        summary={snapshotSummary}
        error={snapshotError}
        loading={loading}
        mismatch={mismatch}
        onConfirmMismatch={() => {
          if (!pendingSnapshot) return
          applyResult({
            repo: pendingSnapshot.repo,
            source: 'local',
            notice: `Opened ${pendingSnapshot.summary.fullName} from a local snapshot instead of the previously mapped repository.`,
            fetchedAt: pendingSnapshot.repo.local?.scannedAt ?? new Date().toISOString(),
          })
          setSnapshotSummary(pendingSnapshot.summary)
          setPendingSnapshot(null)
          setMismatch(null)
          scrollToMap()
        }}
        onDiscardMismatch={() => {
          setPendingSnapshot(null)
          setMismatch(null)
        }}
      />
    </>
  )
}
