import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight whitespace-nowrap [&_svg]:size-3 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-line-strong text-dim',
        muted: 'border-transparent bg-white/[0.04] text-faint',
        success: 'border-transparent bg-[rgb(123_208_181/0.14)] text-[#8ee0c4]',
        warning: 'border-transparent bg-[rgb(255_181_71/0.14)] text-brand-2',
        destructive: 'border-transparent bg-[rgb(255_77_109/0.14)] text-brand-3',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
