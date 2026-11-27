import { ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Container } from '../components/Container'
import { GithubMark } from '../components/GithubMark'
import { Logo } from '../components/Logo'
import { nav } from '../content'

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="border-b border-line bg-bg/70 backdrop-blur-xl">
        <Container className="flex h-16 items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3 sm:gap-5">
            <span className="hidden items-center gap-1.5 text-[14px] text-faint sm:flex">
              <ShieldCheck className="size-3.5" />
              {nav.note}
            </span>
            <Button asChild variant="secondary" size="sm">
              <a href="#map">
                <GithubMark />
                {nav.cta}
              </a>
            </Button>
          </div>
        </Container>
      </div>
    </header>
  )
}
