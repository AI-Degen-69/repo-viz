import { Container } from '../components/Container'
import { Logo } from '../components/Logo'
import { footer } from '../content'

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <Container className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden text-[13px] text-faint sm:block">{footer.tagline}</span>
        </div>
        <p className="max-w-md text-[12.5px] leading-relaxed text-faint">{footer.note}</p>
        <span className="text-[12px] text-faint">{footer.legal}</span>
      </Container>
    </footer>
  )
}
