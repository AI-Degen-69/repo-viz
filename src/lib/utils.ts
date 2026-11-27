import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The named sizes declared in the @theme block of src/styles.css. tailwind-merge
// only knows Tailwind's own scale, so these have to be registered as font sizes;
// otherwise it reads `text-micro` as a color and lets a later `text-dim` win.
const TYPE_SCALE = [
  'micro',
  'caption',
  'label',
  'body-sm',
  'body',
  'lead',
  'title',
  'title-lg',
  'h2',
  'h2-lg',
  'h1',
  'h1-lg',
  'h1-xl',
]

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_SCALE }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
