# GitWeave

**Engineering impact intelligence for GitHub.** Answers one question for a busy engineering
leader in under ten seconds:

> Who are the most impactful engineers on this repo, and how do I know that's true?

Not with commit counts. GitWeave builds a five-dimension **Impact Fingerprint** per engineer —
Ownership, Leverage, Reach, Initiative, Problem Shaping — from signals that are expensive to
fake and cheap to verify, then makes every point of every score click-through traceable to the
exact pull requests that produced it.

Reference target: [PostHog/posthog](https://github.com/PostHog/posthog) — 15,061 merged PRs in 90 days.

📄 Full product spec: **[PRD.md](PRD.md)** · Build notes and deviations: **[IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md)**

---

## Quick start

```bash
git clone <this repo> && cd weave
cp .env.example .env          # works as-is; add a token only for live data
docker compose up -d --build  # dashboard at http://localhost:3000
```

The `seed` service loads a committed fixture, so the dashboard is populated in ~60 seconds
**with no GitHub token**. Add a token to pull live data.

### Local development

```bash
pnpm install
docker compose up -d mongo redis

pnpm --filter @gitweave/ingest run cli sync --days=90   # pull + score
pnpm --filter @gitweave/api  run dev                    # :4000
pnpm --filter @gitweave/web  run dev                    # :3000

pnpm test        # 96 tests across the metric engine
pnpm typecheck
```

---

## What it measures, and why

Three findings from the live PostHog repo shaped the whole design:

| Finding | Consequence |
|---|---|
| The 5 most prolific "reviewers" are **all bots** (`stamphog`, `posthog[bot]`, `greptile-apps`, `veria-ai`, `copilot-pull-request-reviewer`) | Bot exclusion is a core feature, and the UI shows which bots it dropped so the filter is auditable |
| **380 COMMENTED : 118 APPROVED : 4 CHANGES_REQUESTED** | Approvals are a formality and score **zero**. The unit is a review thread the author answered with a code change |
| **954 merged PRs are opened by PostHog's self-driving agent**, and humans commit into them (verified on PR #98640) | Attribution is commit- and steward-level, so neither the bot is credited nor the human erased |

### The five dimensions

| Dimension | Asks | Why it resists gaming |
|---|---|---|
| **Ownership** | Do they own hard, load-bearing things? | File centrality is derived from *other people's* behaviour — editing a file more does not make it central, it raises the denominator too |
| **Leverage** | Do they make others faster and better? | Only counts review threads that produced a code change. Nitpicking earns nothing; approvals earn zero |
| **Reach** | How far across the codebase do they operate? | Effective area count (exp of Shannon entropy), capped by total work, so a repo-wide codemod isn't breadth |
| **Initiative** | Do they start things, or only execute? | New surfaces and files, plus shepherding others' work to merge |
| **Problem Shaping** | Do they frame the problem, not just the patch? | Rate-based and Laplace-smoothed, so shipping more PRs neither helps nor hurts |

**Reliability** is applied separately as a multiplier in `[0.85, 1.10]`. It can temper a rank but
never manufacture one, and it is floored so it cannot become a blame score.

Scores are **percentile ranks within the active cohort**, not raw values — which makes the
dimensions commensurable and keeps one 4,700-line PR from dominating.

### Deliberately not measured

Lines of code as a positive signal · commit counts · hours, time-of-day or weekend activity ·
approval counts · issue-closure counts (only ~6% of PostHog PRs link an issue).

---

## Architecture

```
GitHub GraphQL ─▶ ingest worker ─▶ MongoDB (raw PRs)
                      │                  │
                 token pool +       aggregation +
                 cost scheduler     metric engine
                      │                  ▼
                 sync_state ◀──── engineer_metrics (materialised)
                                         │
                                   Fastify + tRPC ─▶ Next.js + Carbon
```

```
packages/
  core/      ⭐ the metric engine — PURE functions, no I/O, 96 tests
  github/    GraphQL queries, token pool, cost-aware scheduler
  db/        MongoDB access (native driver), indexes, bulk upserts
  types/     Zod schemas shared by every app
  config/    env parsing — the process refuses to boot on a bad env
apps/
  web/       Next.js 15 + IBM Carbon single-page dashboard
  api/       Fastify + tRPC, reads materialised metrics only
  ingest/    BullMQ worker + CLI (sync / materialise / export / seed)
```

**`packages/core` is pure functions over plain data — no database, no network, no clock.**
For a product whose entire value proposition is "trust this number", the scoring logic has to be
the most legible and most testable code in the repo.

### Scale

15,061 merged PRs in 90 days makes the naive approach fail outright: REST would need ~60,000
requests (~12h at 5,000/hr). GitWeave uses one deeply-nested GraphQL query (~300 requests), a
cost-aware scheduler that reads `rateLimit { cost remaining resetAt }` off every response,
**token pooling** (N credentials → N × 5,000 points/hr), per-page cursor checkpointing so a crash
resumes where it stopped, and a materialisation stage so the **API never scores at request time**.

Measured: ~8 cost-points and ~25 PRs per request; first paint **120 ms TTFB**, 185 kB first-load JS.

---

## Configuration

Every variable is documented in [.env.example](.env.example). The one that matters:

### GitHub token — use a fine-grained PAT

| Option | Verdict |
|---|---|
| **Fine-grained PAT** | ✅ **Recommended.** Read-only per resource, mandatory expiry, per-repo scoping |
| Classic PAT | ⚠️ Works, but its only private-repo scope is `repo`, which also grants **write** |
| GitHub App | ✅ Best for self-hosting in your own org — auto-rotating tokens, limits scale to 12,500/hr. Needs org installation |

Create at **github.com/settings/personal-access-tokens/new** → Public repositories (read-only) →
`Metadata: Read`, `Contents: Read`, `Pull requests: Read`, `Issues: Read`.

```bash
GITHUB_TOKEN=github_pat_...
GITHUB_TOKENS=tok1,tok2,tok3,tok4   # optional pool: 4 tokens turns a ~3h backfill into <45min
```

---

## Using it as a leader

| Use case | What to look at |
|---|---|
| **Promotion / calibration** | Fingerprint vs cohort median, plus the evidence rail as artefacts |
| **Find the hidden glue** | High Leverage + low authored volume — the profile every throughput tool buries |
| **Bus factor** | The treemap (🗂 in the header): red = one person owns 75%+ of a surface |
| **Review bottlenecks** | Median unblock latency in the decomposition panel |
| **Agent-era strategy** | Agent Leverage %, reported neutrally — we don't have outcome data to judge it |

### Anti-uses — shipped in-product, not just here

GitWeave measures **observable GitHub activity**. It cannot see design docs, incident response,
customer calls, interviews, architecture debates, or the conversation that stopped a bad project.

**Use it to generate questions, never to conclude answers.** Do not use it for stack ranking,
PIPs, compensation, or headcount decisions without human context. A low score frequently means
the person's highest-impact work does not happen on GitHub.

---

## Stack

TypeScript 5.7 · pnpm + Turborepo · Next.js 15 / React 19 · **IBM Carbon Design System** +
`@carbon/charts-react` · Fastify 5 + tRPC 11 · MongoDB 7 · Redis 7.2 · BullMQ · Vitest · Docker Compose.

All open source; MongoDB Community is SSPL (source-available). All store access is isolated behind
`packages/db`, so FerretDB (Apache-2.0, wire-compatible) is a drop-in if strict OSI licensing is ever required.
