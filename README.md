# Topology

A read-only GitHub topology map. Paste a public repository link and get a
templated visualization of its branches, open pull requests and activity.

This is the SaaS form of the `git-project-topology` skill. A public map reads a
GitHub URL. A local snapshot reads a clone on your own machine, including its
worktrees and uncommitted files, and is loaded in the browser. Local snapshots
are never uploaded and get no permalink.

- `SPEC.md` — product spec, data contract, states, pricing hypothesis, roadmap.
- `PROMPT.md` — the constructive prompt for the next design and build pass.

## Run it

```sh
bun install
bun run dev        # http://127.0.0.1:5173 (Vite + the Worker in workerd)
bun run typecheck
bun run test
bun run build      # dist/client (assets) + dist/saas_landing/index.js (Worker)
node public/topology-snapshot.mjs .   # standalone, read-only snapshot generator
bun run snapshot "C:/path/to/projects" -o my.snapshot.json  # bun-based variant
```

## Optional GitHub token

Unauthenticated GitHub allows 60 requests an hour. A token raises that to 5,000.
Copy `.dev.vars.example` to `.dev.vars` and set `GITHUB_TOKEN`. The Worker reads
it. The browser never sees it.

## How it works

```
Hero form → GET /api/repo?url=... → Worker + Hono → GitHub REST
         → RepoModel → templated map
```

- `src/worker/index.ts` — URL parsing, six GitHub reads, normalization, 5-minute
  cache, 400/404/429/502 errors.
- `src/lib/repo.ts` — `RepoModel`, formatting helpers, `describeRepo()` sentences,
  and the labelled sample map.
- `src/components/topology-canvas.tsx` — the interactive Sacred Timeline canvas:
  pan, zoom, fit, branch focus, local-checkout markers and details panels.
- `src/lib/topology.ts` — deterministic layout from `RepoModel`: spine, branch
  lanes, exact/approximate forks and pull-request markers.
- `src/components/repo-map.tsx` — header, narrative, branch table, pull request
  list, activity.
- `public/topology-snapshot.mjs` — dependency-free generator users download and
  run inside a clone. Read-only git commands, `--redact`, writes
  `topology-snapshot.json`.
- `scripts/local-snapshot.ts` — bun-based variant of the same scanner. Both write
  the same `RepoModel` plus a `local` block; load it with "Connect a local
  snapshot".
- `src/sections/Hero.tsx` — the `Insert GitHub repo link here...` field.
- `src/components/ui/*` — shadcn/ui primitives. `components.json` is configured.
- `src/styles.css` — design tokens and shadcn theme variables.

## Read-only

Only `GET` requests reach GitHub. The product never merges, closes, labels,
pushes or changes settings. The cache holds a summary for five minutes and no
repository content is stored.

## Deploy with Freebuff Sites

`deploy.json` points at the build output. After `bun run build`, deploy it with
the `sites_deploy` tool from this directory. Add `GITHUB_TOKEN` in Sites →
Secrets for a production rate limit.
