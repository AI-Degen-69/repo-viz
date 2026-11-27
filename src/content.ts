// All page copy lives here so the product can be re-themed without touching
// layout. The map itself writes its sentences from repository data.

export const brand = {
  name: 'Topology',
  tagline: 'See the shape of any repository.',
}

export const nav = {
  note: 'Read-only by design',
  cta: 'Map a repo',
}

export const hero = {
  badge: 'Read-only GitHub topology',
  title: ['See the shape of', 'any repository.'],
  description:
    'Paste a public GitHub link. Get a plain-language map of branches, pull requests and activity in seconds. Nothing is cloned, fetched or changed.',
  placeholder: 'Insert GitHub repo link here...',
  note: 'Public repositories · No sign-in · Read-only by design',
}

export const examples = ['honojs/hono', 'vercel/next.js', 'shadcn-ui/ui']

export const footer = {
  tagline: 'A map, not a merge button.',
  note: 'GitHub maps come from the public REST API and are cached for five minutes. Local snapshots are read in your browser and never uploaded. Topology never writes to a repository.',
  legal: `© ${new Date().getFullYear()} Topology`,
}
