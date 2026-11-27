import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

// `fluid` drops the max width so a section can run the full page width with
// the same edge padding as the rest of the page.
export function Container({
  className,
  fluid,
  children,
}: {
  className?: string
  fluid?: boolean
  children: ReactNode
}) {
  return (
    <div className={cx('mx-auto w-full px-5 sm:px-8', fluid ? 'max-w-none' : 'max-w-[1120px]', className)}>
      {children}
    </div>
  )
}
