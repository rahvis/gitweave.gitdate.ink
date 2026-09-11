# Implementation Notes

What changed between [PRD.md](PRD.md) and the shipped code, and what building it against live
data taught us. The PRD is the spec; this is the honest record of where reality pushed back.

---

## 1. Bugs the build found (and the tests that now hold them down)

These are the interesting part. Four were only visible because we ran the engine against the
real PostHog repo rather than fixtures alone.

### 1.1 The size term quietly rebuilt lines-of-code — caught by a test

`prWeight` originally multiplied centrality × blast-radius × `log1p(lines)`. But
`log1p(1800) = 7.5` versus `log1p(16) = 2.8` is a **2.7× edge for bulk**, which swamped the 1.6×
blast-radius multiplier and the centrality weighting. A synthetic cohort test — *"30 × 2,000-line
docs PRs must not outrank 12 × 12-line fixes to shared, CODEOWNERS-protected code"* — failed.

Size is now a weak tiebreaker: `1 + log1p(lines)/6`, capping the whole size range at ~1.0–2.6×.
Where you change code dominates how much you change. **This is the thesis of the product, and
the first implementation got it backwards.**

### 1.2 PostHog's AI reviewer reached rank 3 on live data

The most instructive failure, because it is the exact thing GitWeave exists to prevent.

GraphQL reports bot-ness per actor via `__typename`, but the fetcher stripped the `[bot]` suffix
from logins and kept a separate `authorIsBot` boolean. That flag only covered **the PR author** —
review authors, review-thread authors, commit authors and requested reviewers all silently became
"humans". `posthog[bot]` landed at **rank 3 with 1,059 "consequential" review threads**.

Two fixes, deliberately redundant:
1. A bot's canonical login now **always** ends in `[bot]`, so bot-ness cannot be lost in transit.
2. `agentAuthors` are added to the bot denylist inside the engine — an agent is never rankable,
   even though its PRs are attributed to the humans who drove them.

Locked down by `test/bot-leak.test.ts`.

### 1.3 A repo-wide codemod read as extraordinary breadth

Live data showed an engineer "spanning 75 product areas" from PRs that touched one file in each
of 75 directories. Counting the *set* of areas touched cannot distinguish a sweep from real
breadth.

First fix — weight each area by its share of the PR's files — was **not enough**, and the reason
is worth recording: **Shannon entropy is scale-invariant.** A perfectly uniform sweep across 60
directories has *maximal* entropy and therefore maximal effective-area count. The working fix
caps effective areas by total presence: you cannot be meaningfully engaged in more areas than you
did units of work. Sweeps also no longer earn "boundary work" credit (capped at ≤8 areas) or
claim to have founded a surface they brushed (requires ≥25% of the PR's files).

### 1.4 Problem Shaping scored zero for the entire cohort

We ingested GraphQL `bodyText`, which strips markdown. `## Problem` arrived as bare `Problem`,
so the heading regex matched **0 of 2,084** real PostHog PRs that do have a problem section.

The dimension was silently contributing nothing and nobody would have noticed — the number
looked plausible. We now ingest raw `body`, and the matcher tolerates markdown, bold and plain
headings. Two test fixtures were also passing `bodyText:` into an object typed with `body`, which
made the related assertion inert; both are fixed and the detection is now asserted explicitly.

**Lesson:** a metric that silently returns zero is worse than one that throws.

---

## 2. Deliberate deviations from the PRD

| PRD said | Shipped | Why |
|---|---|---|
| Mongoose 8 ODM | **MongoDB native driver** | The workload is ~90% bulk upserts and aggregation pipelines, exactly where an ODM adds abstraction without benefit. Schema discipline already comes from Zod in `@gitweave/types`. Keeps the store swappable behind `packages/db`. |
| Redis response cache in the API | **In-process TTL cache** | The API reads one pre-computed document per (repo, window). A shared cache would add a network hop and a failure mode to save a single indexed lookup. Redis stays where it earns its keep: the ingest job queue. |
| Radar + 4 secondary charts on one page | **Radar on-page; treemap behind a header action** | The single-screen requirement is load-bearing. Bus factor is a genuinely different question from "who is impactful", so it gets a modal rather than competing for the primary answer. |
| Initiative includes `triageActions` | **`stewardedMerges`** | We ingest merged PRs, not issues, so triage was unmeasurable. Merging someone else's PR is a real, observable act of taking responsibility. |
| Five dimensions incl. Reliability | **Five *scored* dimensions + Reliability as a modifier** | The PRD's own scoring formula had five weighted terms with Problem Shaping separate. The radar now shows the five scored axes; Reliability is displayed on its own as the multiplier it actually is. |

---

## 3. Known limitations

Stated plainly, and surfaced in-product under the ⓘ action:

- **Tenure is inferred from first activity inside the window.** A 90-day window cannot see
  tenure that began before it. "New in window" is an approximation, labelled as such.
- **Only merged PRs are ingested**, so `followThrough` is uniform. Harmless — a constant term
  does not change percentile ranks — and it becomes meaningful the moment closed-unmerged PRs
  are added.
- **`newAreasFounded` is window-relative.** With a partial backfill it over-fires badly, because
  every area looks new. It needs the complete window to be trustworthy.
- **No identity merging.** One human with two accounts is two rows.
- **Percentiles are relative to this repo's cohort** and are not comparable across companies.
- **Nested GraphQL connections are capped** (100 files, 25 reviews, 25 threads, 30 commits per
  PR). A PR touching 400 files is under-counted. Deliberate: the alternative is a per-PR
  pagination fan-out that would put the backfill back into the hours.
- **`selfReworkRatio` is computed but not yet weighted** into the reliability penalty; iteration
  is usually healthy and we have not calibrated a threshold that does not punish it.

---

## 4. Measured performance

| Metric | Target (PRD) | Measured |
|---|---|---|
| First paint (TTFB) | < 2.0s | **120 ms** |
| First-load JS | — | **185 kB** |
| Page fits 1440×900 with no scroll | required | **900px scrollHeight = 900px clientHeight** ✓ |
| Console errors | 0 | **0** |
| Metric materialisation (3 windows) | — | **~250 ms** per window |
| GraphQL cost | — | **~8 points / 25 PRs** per request |
| Engine tests | ≥85% coverage goal | **96 tests** |

A single token's 5,000 points/hr covers roughly 12,500 PRs, so the full PostHog window sits right
at the edge of one credential — which is precisely the case for `GITHUB_TOKENS` pooling that the
PRD argued for on paper and the build then confirmed in practice.
