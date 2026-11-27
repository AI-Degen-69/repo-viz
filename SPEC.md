# Topology — SaaS product spec

Status: v0 built in this folder. Public repos only. No accounts.
Source skill: `git-project-topology` (read-only local Git map).
Date: 2026-11-26.

---

## 1. One line

Paste a GitHub link. Get a plain-language map of the repository in seconds.

## 2. The problem

Most people who touch a repository cannot read its state. They see 40 branches,
a red badge, and a pull request list. They do not know which branch is the
default, which branch already shipped, or which one holds abandoned work.

The skill solved this for a local clone. It reads branches, worktrees, uncommitted
files and upstream drift, then draws one tree with a sentence per state. The SaaS
removes the install step: one URL, one map, no Git knowledge.

## 3. The product

A single page with three parts.

| Part | Job |
|---|---|
| Hero | One field: `Insert GitHub repo link here...` and a `Map repository` button. |
| Map | A templated visualization of the repository: remote, default branch, branches, open PRs. |
| Detail | Tabs for every branch, every open pull request, and recent activity. |

No sign-in, no setup, no clone. Public data only in v0.

## 4. Who it is for

| Person | Job to be done | What the map answers |
|---|---|---|
| New contributor | Understand a repository before opening a PR | Which branch is default, where work happens, what is open |
| Reviewer or lead | See what is in flight | Branches with no PR, stale branches, PR spread |
| Recruiter or analyst | Judge project health fast | Activity, contributors, languages, maintenance |
| Maintainer | Explain the repo to others | A link that shows the shape instead of a paragraph |

Primary wedge: the new contributor. They feel the pain first and share links.

## 5. Scope

| In v0 | Out of v0 |
|---|---|
| Public GitHub repositories | Private repos (needs OAuth) |
| Branches, open PRs, languages, contributors, commits | Fetching PR diffs, checks, reviews |
| Activity for the last 12 weeks | Long-term history or snapshots |
| Links to GitHub | Any write, merge, or settings change |
| Sample map before the first link | Accounts, billing, saved maps |
| One Worker route and one screen | GitLab or Bitbucket |

**Worktrees and uncommitted files stay out of the URL product.** They exist only
on a local machine. A future desktop bridge can add them. Do not fake them from
remote data.

## 6. The data model

One normalized object, `RepoModel`, in `src/lib/repo.ts`. The Worker builds it.
The UI reads it. Nothing else derives Git facts.

| Field group | Examples |
|---|---|
| Identity | `owner`, `name`, `fullName`, `description`, `htmlUrl`, `avatarUrl` |
| Counters | `stars`, `forks`, `watchers`, `openIssues` |
| State | `defaultBranch`, `archived`, `fork`, `isPrivate`, `pushedAt`, `license` |
| Branches | `name`, `sha`, `isDefault`, `protected`, `pullRequests[]` |
| Pull requests | `number`, `title`, `author`, `head`, `base`, `draft`, `labels`, `comments` |
| Activity | `languages[]`, `contributors[]`, `commits[]`, `commitActivity[12]` |

### Sources

| Endpoint | Used for |
|---|---|
| `GET /repos/{owner}/{repo}` | Identity, counters, default branch, push date |
| `GET /repos/{owner}/{repo}/branches?per_page=100` | Branches, head SHA, protection |
| `GET /repos/{owner}/{repo}/pulls?state=open&per_page=100` | Open PRs and their head/base |
| `GET /repos/{owner}/{repo}/languages` | Language split |
| `GET /repos/{owner}/{repo}/contributors?per_page=12` | People |
| `GET /repos/{owner}/{repo}/commits?per_page=8` | Recent commits |
| `GET /repos/{owner}/{repo}/stats/commit_activity` | 12-week activity |

One GitHub failure must not blank the page. Optional data degrades to an empty
list plus an honest notice.

### Route contract

`GET /api/repo?url=<github link or owner/repo>`

| Status | Body | When |
|---|---|---|
| 200 | `{ repo, source: "github", notice, fetchedAt, cached }` | Read succeeded |
| 400 | `{ error, code: "invalid_url" }` | Not a GitHub repository link |
| 404 | `{ error, code: "not_found" }` | Missing or private repository |
| 429 | `{ error, code: "rate_limit" }` | GitHub limit reached |
| 502 | `{ error, code: "upstream" }` | GitHub did not answer |

Cache: five minutes in the Worker isolate, `public, max-age=60` on the response.
An optional server-side `GITHUB_TOKEN` raises the limit from 60 to 5,000 an hour.
The token never reaches the browser.

## 7. The templated map

Five blocks, always in this order.

| Block | Contents | Why |
|---|---|---|
| Repository header | Owner avatar, name, description, stars, forks, watch, issues, last push, license, clone copy | Establishes the subject |
| Topology tree | `github.com/owner/repo` → default branch → branches → open PRs | The answer, first |
| What this map says | Three to five generated sentences plus "Worth a look" | Explains state in plain words |
| Detail tabs | Branches table, pull requests list, activity | Evidence, on demand |
| Source note | Live or sample, read time, cache window | Honesty about freshness |

Tree rules:

- Default branch first, filled dot, `Default` chip, protection chip.
- A branch with an open PR gets the PR number and a child row per PR.
- A branch with no PR says `No PR`. That is the "look here" signal.
- Branch names link to `/tree/<branch>`. PR chips link to `/pull/<n>`.
- Cap the tree at eight branches, then link the rest on GitHub.
- Empty repository: one sentence. Never invent branches.

Sentences are generated from data in `describeRepo()`. Examples:

- `acme-labs/atlas has 7 branches and 4 open pull requests.`
- `main is the default branch, and it is protected.`
- `The last push was 2 days ago.`
- `2 branches have no open pull request.`

## 8. States

| State | What the user sees |
|---|---|
| First visit | The full map with invented data, badge `Sample data`, line `Paste a link above to map a real repository` |
| Loading | Header skeleton; input button reads `Mapping…` |
| Success | Badge `Live from GitHub`, read time, real map |
| Partial | Map plus `Some GitHub data did not answer.` |
| Bad link | Inline error under the field, no page change |
| Not found | `Repository not found. Check the link, or it may be private.` |
| Rate limit | `GitHub rate limit reached. Wait a few minutes, or set GITHUB_TOKEN.` |

Demo mode is labelled. It is never described as live data.

## 9. Read-only guarantee

- The product makes only `GET` requests to GitHub.
- It never stores repository content. The cache holds the normalized summary for
  five minutes.
- It never asks for write scopes. A future private-repo login asks for read only.
- No merge, close, label, branch or settings control exists anywhere in the UI.
- The clone button copies a URL. It does not clone.

This is a product promise, not a setting. Keep it in the UI copy.

## 10. Architecture

```
Browser: React 19 + Vite + Tailwind v4 + shadcn/ui
   │  GET /api/repo?url=...
   ▼
Cloudflare Worker: Hono
   │  6 parallel GitHub reads, 8s timeout, 5-min memory cache
   ▼
api.github.com (public data, optional GITHUB_TOKEN)
```

- `src/worker/index.ts` — URL parsing, GitHub reads, normalization, cache, errors.
- `src/lib/repo.ts` — `RepoModel`, helpers, `describeRepo()`, sample data.
- `src/components/repo-map.tsx` — the templated visualization.
- `src/sections/Hero.tsx` — the link field and examples.
- `src/components/ui/*` — shadcn primitives. Theme tokens live in `src/styles.css`.
- `deploy.json` + `wrangler.jsonc` — Freebuff Sites build output.

No database in v0. No KV. No queue. The Worker is stateless apart from its cache.

## 11. Packaging (hypothesis)

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Public repos, 25 maps a day, current snapshot |
| Pro | $12 / user / month | Private repos, saved maps, share links, 90-day snapshots |
| Team | $29 / user / month | Org overview, stale-branch alerts, SSO, audit log |

Ship Free first. Charge for private repos and saved history, not for the map.

## 12. Success metrics

| Metric | Target |
|---|---|
| Link submitted → map rendered | ≥ 85% |
| p75 time from submit to map | ≤ 4 seconds (cache hit: ≤ 1s) |
| Repeat map within 7 days | ≥ 25% |
| Share or copy action per session | ≥ 10% |
| Error rate (non-2xx) | ≤ 2% |

## 13. Roadmap

**Now** — this build: URL → map, public repos, honest sample, read-only.

**Next** — GitHub OAuth with read-only scopes, private repos, saved maps with a
permalink, compare two branches, stale-PR alerts.

**Later** — desktop bridge for worktrees, uncommitted files and conflicts (the
original skill's full power), org portfolio view, GitHub App webhooks for
freshness, CSV or PNG export.

## 14. Risks

| Risk | Mitigation |
|---|---|
| GitHub rate limits break the demo | Token, five-minute cache, clear 429 copy, graceful partial data |
| API schema drift | One normalization layer, typed fixtures, tests on the mapper |
| "Another dashboard" | No login, instant value, one shareable page |
| Private repos need review | Ship public first, request read-only scopes later |
| Sample data mistaken for real | Permanent `Sample data` badge and copy |
| Scope creep into writes | Read-only rule in the spec, the UI and the route |

## 15. MVP acceptance criteria

- [x] Hero field placeholder is exactly `Insert GitHub repo link here...`.
- [x] `owner/repo`, HTTPS, SSH and deep links all resolve to the same repo.
- [x] Non-GitHub links are rejected with a 400 and plain copy.
- [x] The map shows header, tree, sentences and three tabs.
- [x] Default branch, protection and open PRs are visible in the tree.
- [x] Branch and PR links open the correct GitHub pages.
- [x] Empty states are honest for no branches, no PRs and no activity.
- [x] Sample data is labelled everywhere it appears.
- [x] `bun run typecheck`, `bun run test` and `bun run build` pass.
- [x] The page renders with the Worker running locally.

## 16. Open questions

1. Is private-repo access table stakes on day one?
2. Should a map have a permanent permalink before accounts exist?
3. Is the map the product, or the alert when a branch goes stale?
4. Does the brand keep the name Topology, or move to something plainer?
