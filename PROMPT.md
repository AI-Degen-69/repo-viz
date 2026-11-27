# Constructive prompt — design and plan Topology as a SaaS

Copy everything below into a new agent session. It assumes this folder already
contains the working v0 described in `SPEC.md`.

---

## Role

You are a product designer and front-end architect. You turn a single-purpose
developer tool into a calm, credible SaaS product. You write the plan first, then
the code. You keep the read-only promise.

## Mission

Elevate the existing Topology v0 into a polished SaaS surface built with
shadcn/ui. The center of the page is one field, `Insert GitHub repo link here...`.
The output is a templated visualization of the repository. Nothing else competes
with that flow.

## Context you must read first

1. `SPEC.md` — the product contract, data model, states and acceptance criteria.
2. `src/lib/repo.ts` — the one `RepoModel` shape and the sample data.
3. `src/worker/index.ts` — the GitHub route, cache and error codes.
4. `src/components/repo-map.tsx` — the current templated map.
5. `src/components/ui/*` and `src/styles.css` — shadcn primitives and tokens.

Do not replace these from scratch. Extend them. Preserve `RepoModel`, the route
contract and the read-only rule.

## Product statement

Topology answers one question: **what is the shape of this repository?**
It reads public GitHub data and draws branches, open pull requests and activity
as one tree with a plain sentence per state. It never writes to the repository.

## What to design

### 1. Hero (the whole first screen)

- Badge: `Read-only GitHub topology`.
- Headline: `See the shape of` / `any repository.` with the second line in the
  existing ember gradient.
- Subline: one or two sentences. No feature list.
- The field: one large input with the placeholder `Insert GitHub repo link here...`
  and a primary button `Map repository`.
- Under the field: `Public repositories · No sign-in · Read-only by design`.
- Three example chips: `honojs/hono`, `vercel/next.js`, `shadcn-ui/ui`.
- No pricing, testimonials, logo cloud or FAQ on this screen.

Constraints: the field must be the strongest element after the headline. It must
accept a paste, submit on Enter, and keep the text while loading.

### 2. The templated map

Keep the five-block order in `SPEC.md` §7.

1. **Header** — avatar, `owner/name`, description, stars, forks, watching, open
   issues, last push, license, `Open on GitHub`, `Copy clone URL`.
2. **Topology tree** — remote node, default branch, branches, open PR child rows.
   Default branch first with a filled dot. Protected and `No PR` chips.
3. **What this map says** — numbered sentences from `describeRepo()` plus a
   "Worth a look" box. If nothing needs attention, say so in one line.
4. **Tabs** — Branches, Pull requests, Activity. Tables and lists, all linked to
   GitHub.
5. **Source note** — `Live from GitHub` or `Sample data`, read time, cache window.

Use shadcn `Card`, `Badge`, `Button`, `Tabs`, `Input`, `Skeleton`. Use the
`depth` utility for the lit edge. Keep the squircle house style.

### 3. States

Design all six states in `SPEC.md` §8. The sample map must carry a visible
`Sample data` badge. A failed request must keep the previous map and show the
error under the field.

## shadcn/ui rules

- `components.json` is configured. Add primitives with
  `bunx shadcn@latest add <name>`, or copy them into `src/components/ui/`.
- Use semantic tokens (`bg-card`, `text-muted-foreground`, `border-input`,
  `bg-primary`). Never hard-code a second palette.
- The theme lives in `src/styles.css`. Add tokens there, not in components.
- `cn()` from `@/lib/utils` is the only class merge helper.
- Do not restyle a primitive per page. Add a variant when a new look repeats.

## Data contract

- One route: `GET /api/repo?url=...`.
- Statuses: 200, 400, 404, 429, 502 with the codes in `SPEC.md` §6.
- Optional `GITHUB_TOKEN` on the server only. Never in the client bundle.
- Five-minute Worker cache. Show the read time, not a fake live clock.
- Partial data must render. Missing lists become empty states, not blank cards.

## Guardrails

- Never add a write action, merge button, close button or settings form.
- Never present sample data as live data.
- Never invent a branch, PR, contributor or number.
- Never fetch PR diffs, checks or reviews in v0.
- Do not add accounts, a database or billing unless the plan says so explicitly.
- Do not show worktrees or uncommitted files. They are local-only.
- Keep the page fast: no client-side GitHub calls, no heavy chart library.

## Design language

- Warm near-black (`#0b0908`) with ember accents (`#ff7a45`, `#ffb547`).
- Google Sans, tight tracking, generous space.
- Surfaces use `depth`, not flat borders. Radii are squircles.
- Motion is one entrance per block. Respect `prefers-reduced-motion`.
- Copy is plain. No "seamless", "robust", "leverage", "unleash".

## Build order

1. **Audit** — read the five files above and list every place the contract is
   already met or broken.
2. **Plan** — write a short plan: screen map, component tree, token changes,
   states, risks. One page.
3. **Foundation** — tokens, primitives, sample data, route. No UI polish yet.
4. **Hero** — field, examples, loading, error, keyboard submit.
5. **Map** — header, tree, narrative, tabs, empty states.
6. **States** — sample, loading skeleton, partial, 404, 429.
7. **Verify** — typecheck, tests, build, then one local run with a real repo.
8. **Hand over** — list what changed, what was checked and what was not.

## Acceptance criteria

- The field placeholder is exact and visible on first paint.
- A pasted GitHub link renders a real map without a reload.
- `owner/repo`, HTTPS, SSH and `/tree/...` links all work.
- The default branch is visually first and labelled.
- Branch and PR links point to the correct GitHub pages.
- Every empty list has a plain sentence.
- Sample data is labelled in the badge and the source line.
- Errors are readable by a non-expert and never a raw JSON dump.
- `bun run typecheck`, `bun run test` and `bun run build` pass.
- No new network call happens in the browser except `/api/repo`.

## Out of scope

Private repos, OAuth, saved maps, billing, GitLab, Bitbucket, PR diffs, checks,
reviews, local worktrees, uncommitted files, email, analytics.

## Deliverables

1. Updated `SPEC.md` if a decision changed.
2. The implemented page and Worker route.
3. A short `NOTES.md` with the plan, the decisions and the verified commands.
4. A local preview at `http://127.0.0.1:5173` with a real repository mapped.
