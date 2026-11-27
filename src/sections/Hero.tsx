import { motion } from 'motion/react'
import { ArrowRight, FileUp, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Aurora } from '../components/Aurora'
import { Container } from '../components/Container'
import { GithubMark } from '../components/GithubMark'
import { examples, hero } from '../content'

const ease = [0.22, 1, 0.36, 1] as const

type HeroProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (url: string) => void
  onOpenSnapshot: () => void
  loading: boolean
  error: string | null
  // Once a map exists the hero folds into a toolbar so the canvas can lead.
  compact?: boolean
}

export function Hero({ value, onValueChange, onSubmit, onOpenSnapshot, loading, error, compact = false }: HeroProps) {
  if (compact) {
    return (
      <section className="sticky top-16 z-30 mt-[76px] bg-bg/85 pb-1 backdrop-blur-md">
        <Container>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit(value)
            }}
            className="depth relative flex flex-col gap-2 rounded-[18px] bg-surface/80 p-2 backdrop-blur sm:flex-row sm:items-center"
          >
            <div className="flex flex-1 items-center gap-2.5 pl-2">
              <GithubMark className="size-4 shrink-0 text-faint" />
              <Input
                aria-label="GitHub repository link"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={hero.placeholder}
                className="h-9 border-0 bg-transparent px-0 text-[15.5px] shadow-none focus-visible:ring-0 md:text-[15.5px]"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onOpenSnapshot}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[11px] border border-line px-2.5 text-[13.5px] text-faint transition-colors hover:border-line-strong hover:text-dim focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <FileUp className="size-3.5" />
                <span className="hidden sm:inline">Local snapshot</span>
              </button>
              <Button type="submit" disabled={loading} size="sm" className="h-9 shrink-0 rounded-[11px] px-4">
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Mapping…
                  </>
                ) : (
                  <>
                    Map repository
                    <ArrowRight />
                  </>
                )}
              </Button>
            </div>
          </form>
          {error ? (
            <p role="alert" className="mt-2 text-[14.5px] text-brand-3">
              {error}
            </p>
          ) : null}
        </Container>
      </section>
    )
  }

  return (
    <section className="relative overflow-hidden pt-32 pb-10 sm:pt-36">
      <Aurora intensity={0.85} />
      <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[620px]" />
      <div aria-hidden className="noise pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="depth relative inline-flex h-8 items-center gap-2 rounded-[12px] bg-white/[0.04] px-3 text-[14.5px] text-dim backdrop-blur"
          >
            <span className="round size-1.5 rounded-full bg-[#8ee0c4]" />
            {hero.badge}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease }}
            className="mt-6 text-balance text-[42px] font-semibold leading-[1.03] tracking-[-0.04em] sm:text-[64px] md:text-[72px]"
          >
            {hero.title[0]}
            <br />
            <span className="text-gradient">{hero.title[1]}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease }}
            className="mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-dim sm:text-[18px]"
          >
            {hero.description}
          </motion.p>

          <motion.form
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease }}
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit(value)
            }}
            className="mt-8 w-full max-w-2xl"
          >
            <div className="depth relative flex flex-col gap-2 rounded-[20px] bg-surface/80 p-2 shadow-glow backdrop-blur sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2.5 pl-2.5">
                <GithubMark className="size-4 shrink-0 text-faint" />
                <Input
                  aria-label="GitHub repository link"
                  autoComplete="off"
                  spellCheck={false}
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder={hero.placeholder}
                  className="h-10 border-0 bg-transparent px-0 text-[16px] shadow-none focus-visible:ring-0 md:text-[16px]"
                />
              </div>
              <Button type="submit" disabled={loading} className="h-10 shrink-0 rounded-[13px] px-5 text-[16px]">
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Mapping…
                  </>
                ) : (
                  <>
                    Map repository
                    <ArrowRight />
                  </>
                )}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-left text-[15px] text-brand-3">
                {error}
              </p>
            ) : (
              <p className="mt-2 text-left text-[14px] text-faint">{hero.note}</p>
            )}
          </motion.form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[14px] text-faint"
          >
            <span>Try</span>
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  onValueChange(example)
                  onSubmit(example)
                }}
                className="rounded-full border border-line px-2.5 py-1 font-mono text-[13px] text-dim transition-colors hover:border-line-strong hover:text-fg"
              >
                {example}
              </button>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="mt-4 flex flex-col items-center gap-1.5"
          >
            <button
              type="button"
              onClick={onOpenSnapshot}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[14px] text-dim transition-colors hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <FileUp className="size-3.5" />
              Connect a local snapshot
            </button>
            <span className="text-[12.5px] text-faint">See your local branches, worktrees and uncommitted files</span>
          </motion.div>
        </div>
      </Container>
    </section>
  )
}
