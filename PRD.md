# GitWeave — Product Requirements Document

**Engineering Impact Intelligence for GitHub**

| | |
|---|---|
| **Product** | GitWeave |
| **Version** | 1.0 (PRD) |
| **Author** | holly@workonward.org |
| **Date** | 2026-09-10 |
| **Reference repo** | [PostHog/posthog](https://github.com/PostHog/posthog) |
| **Analysis window** | Rolling 90 days (2026-06-12 → 2026-09-10), configurable |
| **Status** | Ready for build |

---

## 0. TL;DR

GitWeave answers one question for an engineering leader in under ten seconds:

> **"Who are the most impactful engineers on this repo, and how do I know that's true?"**

It does *not* answer it with commit counts. It builds a **five-dimension Impact Fingerprint** per engineer — Ownership, Leverage, Reliability, Reach, Initiative — from signals that are expensive to fake and cheap to verify, then makes every single point of every score **click-through traceable to the exact pull requests that produced it**.

The product is a TypeScript monorepo (Next.js + Fastify + MongoDB + Redis), styled entirely in **IBM Carbon Design System**, fully containerised with Docker Compose.

---

## 1. Why this product exists

### 1.1 The problem with every existing engineering dashboard

Engineering analytics tools (LinearB, Swarmia, Jellyfish, Code Climate Velocity, GitHub Insights) overwhelmingly measure **throughput**: commits, lines of code, PR count, cycle time, DORA. These are operationally useful and *individually meaningless*. They share four fatal flaws:

1. **They measure motion, not consequence.** 2,000 lines of generated boilerplate outranks a 12-line fix to a race condition in the ingestion pipeline.
2. **They are trivially gameable.** Split one PR into six. Approve everything instantly. Reformat a directory.
3. **They are invisible to the highest-leverage work.** The engineer who unblocks nine teams a day through fast, deep code review and who mentors three new hires produces *fewer* commits than average and ranks near the bottom.
4. **They are unauditable.** A leader is shown `Score: 207` and has no path from that number to the work. They correctly refuse to act on it.

### 1.2 What we validated on the actual PostHog repo

Before designing a single metric we pulled live data. The findings were decisive:

- **15,061 merged PRs in 90 days.** ~167/day. Volume metrics are pure noise at this scale; everyone's number is large.
- **The five most prolific "reviewers" are all bots** — `stamphog` (105 reviews in a 100-PR sample), `posthog[bot]` (68), `greptile-apps` (58), `veria-ai` (29), `copilot-pull-request-reviewer` (20). A naive leaderboard shipped today would tell a PostHog leader that their best engineers are four LLM review bots and a CI stamper. **This is the single most common way these dashboards fail, and it is invisible until you look.**
- **Approvals are near-worthless as signal.** In our sample: 380 `COMMENTED`, 118 `APPROVED`, and only **4** `CHANGES_REQUESTED`. Approval is a formality. The substantive unit is the **review thread that caused a code change before merge**.
- **PostHog runs an AI agent that authors PRs.** 954 merged PRs in 90 days come from `posthog[bot]` on `posthog-self-driving/*` branches. We inspected PR #98640: the bot opened it, then **Charles Vien pushed three commits, resolved the discussion, and merged it**. Any tool that either (a) credits the bot or (b) filters bot PRs out entirely will **erase real senior engineering work**. Correct attribution in the agent era is commit-level and steward-level, and this is a genuine differentiator.
- **Only 6% of PRs link a closing issue.** Any impact model built on issue linkage would produce near-zero signal here. We build on discussion participation instead.
- **Median time-to-merge is 5.5 hours** (p25 2.1h, p90 345h). In a culture this fast, *review latency is a real differentiator* — a slow reviewer is a visible tax.
- **The repo self-describes its own taxonomy**: 85 directories under `products/`, 37 `team/*` labels, 102 `feature/*` labels, plus a deliberately minimal CODEOWNERS (PostHog's own comment: *"Adding entries to the codeowners file is an anti-social... thing to do"*). We get product-area and team attribution **for free**, and CODEOWNERS paths mark the genuinely high-blast-radius code (`posthog/hogql/**`, `posthog/clickhouse/migrations/**`, security workflows).

Every design decision below traces back to one of these findings.

### 1.3 Target user

**Primary — the busy engineering leader.** VP Eng, Director, EM. Understands roughly what their people do. Does not read PRs. Has 10 minutes before a calibration meeting, a headcount conversation, or a 1:1. Needs a defensible claim, not a vibe.

**Secondary** — Staff/Principal engineers auditing the health and bus-factor of a product surface; the engineers themselves, seeing their own work reflected fairly.

---

## 2. Defining impact

> *"Every engineer knows that counting lines of code, commits, reviews, etc. does not define someone's impact."*

Agreed. Here is the definition we build on.

### 2.1 The thesis

**Impact is the delta in the organisation's output that is attributable to this person being here.**

That's unobservable. But it decomposes into five observable families, each of which asks a *structurally different* question. Crucially, each family has a different gaming profile — you cannot inflate all five simultaneously without doing actual work.

| # | Dimension | The question it asks | Why volume metrics miss it |
|---|---|---|---|
| 1 | **Ownership Depth** | Do they own things that are *hard* and *load-bearing*? | Treats a docs typo and a HogQL planner change as equal |
| 2 | **Leverage** | Do they make *other people* faster and better? | Reviewing costs you commits; the best multipliers rank lowest |
| 3 | **Reliability** | Does what they ship *hold up*? | Never penalises the revert; ships-fast-breaks-everything wins |
| 4 | **Reach** | How far across the codebase and org do they operate? | Cannot distinguish a deep specialist from a narrow one |
| 5 | **Initiative** | Do they *start* things and *shape problems*, or only execute? | Cannot see the difference between founding and maintaining |

### 2.2 Dimension 1 — Ownership Depth

Not *how much* code, but **where**, and **whether you are the person the codebase depends on for it**.

| Signal | Computation | Rationale |
|---|---|---|
| **File centrality weight** | For each file, `centrality = log(1 + distinct_authors_90d) × log(1 + total_changes_90d)`. Every PR is weighted by the mean centrality of files it touches. | A file 40 engineers depend on is high-leverage. A private corner is not. This is a **collaboration-graph** measure, not a size measure. |
| **Blast-radius multiplier** | ×1.6 for CODEOWNERS-protected paths, DB migrations (`**/migrations/**`), CI/security workflows, `rust/`, `services/`. ×0.4 for `docs/`, snapshots, lockfiles, generated files. | PostHog's own CODEOWNERS *is* a declaration of what's dangerous. We use their judgement, not ours. |
| **Surface ownership share** | % of all merged changes in a `products/<area>` directory authored by this person. Reported as a **fact**, not a score: *"Owns 62% of `products/error_tracking`"*. | The most leadership-legible sentence the product can produce. |
| **Depth of engagement** | Distinct weeks in the window with a merged change in that surface. | Separates sustained ownership from a drive-by. |

**Anti-gaming:** centrality is computed from *other people's* behaviour, not yours. You cannot make a file important by editing it more — that raises the denominator too. Touching many low-centrality files is explicitly worth less than touching one high-centrality file.

### 2.3 Dimension 2 — Leverage (the force multiplier)

The dimension every other tool gets most wrong. Our data shows why: raw review counts hand the top five slots to bots, and approvals are rubber stamps at a 30:1 ratio to change-requests.

| Signal | Computation | Rationale |
|---|---|---|
| **Consequential review** | A review thread by X on Y's PR is *consequential* if Y pushed a commit touching that file path **after** the thread opened and **before** merge. Score = count of consequential threads. | This is the crux. It measures review that **changed the outcome** — the only review worth counting. Approvals score **zero**. |
| **Unblock latency** | Median hours from `review_requested` (or PR ready) → that reviewer's first substantive review. Scored inversely, log-damped. | In a 5.5h-median-merge culture, the person who answers in 40 minutes is structurally load-bearing. |
| **Review reach** | Distinct PR authors reviewed × distinct `products/*` areas reviewed. | Reviewing across 9 teams is de-facto Staff work regardless of title. |
| **Mentorship gradient** | Share of consequential reviews given to contributors whose first commit is <90 days old, and to authors more junior by tenure. | Growing people is impact. It is otherwise completely invisible. |
| **Solicited trust** | Times *others explicitly requested* this person as reviewer, normalised by cohort. | A revealed preference of the whole org. Near-impossible to self-inflate — you don't control who requests you. |

**Anti-gaming:** you cannot farm consequential threads by nitpicking — the thread only counts if the *author chose to change code in response*. You cannot farm latency by spraying "LGTM" — non-substantive reviews (no thread, no body >N chars) are excluded from both numerator and denominator.

### 2.4 Dimension 3 — Reliability

Shipping fast means nothing if it comes back. This dimension can only ever *subtract*, and it is the counterweight to everything else.

| Signal | Computation | Rationale |
|---|---|---|
| **Revert rate** | PRs whose merge commit is later reverted, or titled `Revert "<their PR title>"`. | The cleanest negative signal GitHub offers. |
| **Rapid-fix follow-on** | A PR merged within 48h by *anyone*, titled `fix(`/`hotfix`/`fixup`, touching ≥50% the same files. | Catches the "shipped broken, someone patched it" pattern that reverts miss. |
| **Self-rework ratio** | Fraction of their own merged lines rewritten by themselves within 30 days. | Mild signal; high values suggest under-baked design. Deliberately low-weighted — iteration is healthy. |
| **First-pass CI health** | % of their PRs green on first full CI run. | Respect for shared CI capacity and colleagues' time. |
| **Incident linkage** | PRs carrying incident/sev labels or referenced from incident issues. | Direct, if sparse. |

**Reported as a modifier in `[0.85, 1.10]`, never as a headline.** A leader should see *"Reliability: strong (0 reverts / 84 merges)"* as reassurance, not as a stick. We explicitly refuse to build a "blame score."

### 2.5 Dimension 4 — Reach

| Signal | Computation |
|---|---|
| **Surface breadth** | Distinct `products/*` areas touched, entropy-weighted (Shannon) so 5 areas at 20% each beats 5 areas at 96/1/1/1/1 |
| **Stack breadth** | Distinct language/runtime zones: `frontend/` (TS), `posthog/` (Python), `rust/`, `nodejs/`, `services/`, `ee/`, infra |
| **Cross-team collaboration** | Distinct `team/*` labels on PRs they authored *or* consequentially reviewed |
| **Boundary work** | PRs that touch ≥2 product areas **and** ≥2 stacks — genuine integration work, which is disproportionately hard and disproportionately uncredited |

**Interpretation matters here, and the UI must carry it.** Low Reach + high Ownership Depth = a **deep specialist** (excellent, and a bus-factor risk). High Reach + moderate Depth = a **connector** (excellent, and usually under-promoted). GitWeave labels these as *archetypes*, never ranks one above the other.

### 2.6 Dimension 5 — Initiative & problem-shaping

| Signal | Computation |
|---|---|
| **Net-new surface** | PRs that create new `products/*` dirs, new modules, or new top-level packages |
| **Problem articulation** | PostHog's PR template has a `## Problem` section. We score its presence and substance (length, links, before/after tables) with a deterministic heuristic — *optionally* LLM-scored, off by default. A PR that states the problem well is doing product work. |
| **Discussion leadership** | Comments on *others'* issues and PRs that attract replies (thread-starting, not thread-noise) |
| **Triage** | Issue labelling, closing, reproduction steps authored |
| **Follow-through** | Fraction of started work that reaches merge rather than staleness |

### 2.7 Dimension 6 (cross-cutting) — Agent Leverage

**This is our sharpest differentiator and it is specific to what is actually happening on this repo in 2026.**

954 merged PRs in the window were opened by `posthog[bot]`. The naive handling is one of two mistakes:

- **Mistake A — credit the bot.** The leaderboard's #1 engineer is a robot.
- **Mistake B — drop all bot PRs.** Charles Vien's three commits, review resolution, and merge on PR #98640 vanish from the record, along with hundreds of similar cases.

GitWeave does neither. On an agent-authored PR we attribute to the human by role:

| Human role on an agent PR | Credit |
|---|---|
| Pushed commits into the branch | **Full author credit** for those commits' files and lines |
| Consequential review | Full Leverage credit |
| Merged it (`mergedBy`) | **Steward credit** — accountability for the merge landing |
| Opened/triggered the agent run (branch prefix, `## Problem` attribution) | Initiative credit |

We then surface **Agent Leverage** as a first-class, *neutral* statistic on the profile: *"38% of merged output stewarded through agents."* We deliberately do **not** score it up or down. Leadership decides whether that's the future or a red flag — our job is to make it **visible**, because today it is invisible everywhere.

### 2.8 Composing the score

```
Raw_d      = Σ (signal_i × weight_i)                      for each dimension d
Pct_d      = percentile_rank(Raw_d, active_cohort)        → 0–100
Impact     = (0.28·Pct_own + 0.30·Pct_lev + 0.18·Pct_reach
              + 0.14·Pct_init + 0.10·Pct_problem) × Reliability_modifier
```

Five deliberate choices, each defending against a known failure mode:

1. **Leverage is weighted highest (0.30).** A considered stance: at PostHog's scale the multipliers matter more than the individual producers. It is also the thing every other tool under-counts, so it is where we add the most value.
2. **Percentile ranks, not raw values.** Makes dimensions with wildly different units commensurable, and makes the score robust to the long tail (one 4,723-line PR can't dominate).
3. **Per-PR diminishing returns.** Every per-PR contribution passes through `log1p` before summation. Ten small PRs and one huge one converge.
4. **Tenure normalisation.** Signals are per-active-day, so someone who joined 5 weeks ago competes fairly. A **data-sufficiency badge** (`<10 merged PRs` → "Low confidence") appears on the card rather than silently ranking them.
5. **Reliability multiplies, never adds.** It cannot manufacture a high rank; it can only temper one.

**Weights are user-editable in the UI.** *"There's no one right answer"* is the honest position, so the product treats our weights as a **defensible default**, not a truth. A leader who believes reliability matters more drags a slider and watches the ranking reshuffle live. That single interaction converts the dashboard from "a number I don't trust" into "a model I can argue with" — which is the only way a leader ever actually adopts one.

### 2.9 What we deliberately do **not** measure

Stating this explicitly is part of the product's credibility:

- **Lines of code**, in any form, as a positive signal. Used only as a weak size prior inside `log1p`.
- **Commit count.** Squash-vs-merge settings make it meaningless.
- **Hours, time-of-day, weekend activity.** Surveillance, not impact. Actively harmful to trust.
- **Approval count.** 30:1 approve-to-request-changes ratio proves it is a formality.
- **Issue-closure counts.** 6% linkage rate — no signal on this repo.
- **Any cross-person comparison without a shown denominator.** Every number in the UI ships with its basis.

---

## 3. Product requirements

### 3.1 Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Ingest ≥90 days of PRs, reviews, review threads, commits, files, comments, labels, issues from any public GitHub repo | P0 |
| FR-2 | Classify and exclude bot identities (`__typename == Bot`, `[bot]` suffix, curated allow/deny list incl. `stamphog`, `greptile-apps`, `veria-ai`, `coderabbitai`, `copilot-pull-request-reviewer`) | P0 |
| FR-3 | Compute all five dimensions + Reliability modifier + Impact Score per engineer per window | P0 |
| FR-4 | Single-page dashboard showing the **top 5** most impactful engineers with a one-line plain-English "why" each | P0 |
| FR-5 | Every score component drills through to the **exact PRs** that produced it, with deep links to github.com | P0 |
| FR-6 | Impact Fingerprint radar: selected engineer vs cohort median | P0 |
| FR-7 | Score decomposition showing each dimension's point contribution and raw inputs | P0 |
| FR-8 | Adjustable dimension weights with live re-ranking (<200ms) | P1 |
| FR-9 | Time-window selector: 30 / 90 / 180 / 365 days | P1 |
| FR-10 | Agent Leverage % shown neutrally on every profile | P1 |
| FR-11 | Ownership treemap of `products/*` by dominant owner (bus-factor view) | P1 |
| FR-12 | Collaboration alluvial: reviewer → author flows | P2 |
| FR-13 | Team rollup by `team/*` label | P2 |
| FR-14 | Identity merging (same human, multiple accounts / email aliases) | P2 |
| FR-15 | CSV / JSON export for calibration packets | P2 |

### 3.2 Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Dashboard first meaningful paint | **< 2.0s** |
| NFR-2 | Fully interactive (TTI) | **< 3.5s** (hard ceiling 10s — an explicit red flag) |
| NFR-3 | Weight-slider re-rank | < 200ms (client-side, pre-computed dimension percentiles) |
| NFR-4 | Full 90-day cold ingest of PostHog/posthog | < 45 min with 4 pooled tokens |
| NFR-5 | Incremental sync | < 3 min, every 15 min |
| NFR-6 | Fits one 1440×900 laptop screen with no scrolling for the primary answer | Hard requirement |
| NFR-7 | Accessibility | WCAG 2.1 AA (inherited from Carbon; verified with `axe`) |
| NFR-8 | Cold start `docker compose up` → seeded dashboard | Single command |
| NFR-9 | Metric engine unit-test coverage | ≥ 85% on `packages/core` |

---

## 4. UX & UI design

### 4.1 Design principles

1. **Answer first, evidence one click away.** The top 5 and their "why" are above the fold, always.
2. **No naked numbers.** Every figure carries its denominator and a hover-formula. This directly targets the `Score: 207` failure mode.
3. **Explain, then rank.** The score is a summary of the evidence, not a substitute for it.
4. **Argue with the model.** Weight sliders make our opinion negotiable.
5. **Carbon-native.** No custom design language; Carbon tokens, type scale, 2x grid, motion tokens throughout.

### 4.2 Single-page layout (1440×900)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ▣ GitWeave   PostHog/posthog ▾   [90 days ▾]   ⚙ Weights   ⟳ synced 4m ago   │ 48px UI Shell
├──────────────────────┬────────────────────────────┬───────────────────────────┤
│ TOP 5 BY IMPACT      │  IMPACT FINGERPRINT        │  HOW THIS SCORE IS BUILT  │
│ (of 184 active eng.) │                            │                           │
│                      │        Ownership           │  Ownership   28 ▓▓▓▓▓▓▓░  │
│ ①  ◕ Gilbert09   94  │            ╱╲              │   ↳ 62% of products/cdp   │
│   Owns 62% of CDP;   │  Initiative  ╱  ╲ Leverage │   ↳ 11 CODEOWNERS files   │
│   unblocks 9 teams   │       ╲    ▓▓▓▓   ╱        │  Leverage    27 ▓▓▓▓▓▓▓░  │
│   ▂▃▅▆▇▆▇  0 reverts │        ╲  ▓▓▓▓▓▓ ╱         │   ↳ 143 threads → change  │
│  ─────────────────── │         ╲▓▓▓▓▓▓╱          │   ↳ 34min median unblock  │
│ ②  ◕ danielcarletti  │      Reach ── Initiative   │   ↳ 22 distinct authors   │
│   87 · Review spine  │                            │  Reach       14 ▓▓▓▓▓░░░  │
│   of feature-flags   │  ▬▬ Gilbert09              │  Initiative   9 ▓▓▓░░░░░  │
│  ─────────────────── │  ┈┈ cohort median          │  Reliability ×1.06 ✓      │
│ ③  ◕ haacked     81  │                            │ ───────────────────────── │
│  ─────────────────── │  Archetype: DEEP OWNER     │  Agent leverage      38%  │
│ ④  ◕ Piccirello  78  │  Confidence: HIGH (84 PRs) │  ▓▓▓▓▓▓▓░░░░░░░░░░░       │
│  ─────────────────── │                            │  32 of 84 merges were     │
│ ⑤  ◕ k11kirky    74  │                            │  agent-opened, human-     │
│                      │                            │  driven. (Neutral stat.)  │
├──────────────────────┴────────────────────────────┴───────────────────────────┤
│ EVIDENCE — the 5 highest-weighted contributions behind this score      [All ▸] │
│ #98640 fix(desktop): name the project timezone…  +212/−40 · 6 files · CDP      │
│        agent-opened · 3 commits by them · merged by them        ↗ view on GH   │
│ #98512 feat(cdp): batched destination retries    +1.1k/−380 · 24 files · CDP   │
│        ⚠ CODEOWNERS path · 4 consequential review threads       ↗ view on GH   │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Below the fold** (secondary, deliberately not competing with the answer): Ownership Treemap (bus-factor), Collaboration Alluvial, Team Rollup, Full Leaderboard.

### 4.3 Carbon components and charts

| Region | Carbon component |
|---|---|
| Shell | `Header`, `HeaderName`, `HeaderGlobalBar`, `Dropdown`, `Tag` |
| Rank cards | `ClickableTile`, `AspectRatio`, `Tag`, `SkeletonPlaceholder` |
| Weights panel | `SideNav` / `Modal` + `Slider`, `Toggle`, `Button` |
| Evidence rail | `StructuredList` / `DataTable` with `ExpandableRow` |
| Explanations | `Popover`, `DefinitionTooltip`, `InlineNotification` |
| Loading | Carbon `SkeletonText` + `DataTableSkeleton` (never a spinner) |

**`@carbon/charts-react` (Apache-2.0)** covers the visual needs natively — no third-party charting:

| Visual | Carbon chart type | Why this one |
|---|---|---|
| Impact Fingerprint | **Radar** | Purpose-built for 5 commensurable percentile axes; overlaying the cohort median makes "above/below" instant |
| Score decomposition | **Stacked horizontal bar** + **Meter** | Shows exactly which dimension bought which points |
| Agent Leverage | **Meter** | Single proportion, neutral framing |
| 90-day trend | **Sparkline / Line** | Trajectory, not just position |
| Ownership / bus-factor | **Treemap** | Area = surface size, colour = dominant owner; single-owner areas pop immediately |
| Reviewer → author flows | **Alluvial** | The canonical shape for who-unblocks-whom |
| Activity distribution | **Heatmap** | Engineer × product area |
| Cohort context | **Box plot** | Shows the distribution a percentile is drawn from |

**Motion** uses `@carbon/motion` tokens only — `$duration-moderate-01` (150ms) for hovers, `$duration-moderate-02` (240ms) with `productive` easing for rank reshuffles. Ranks animate with a FLIP transition when weights change, so the leader *sees causality*. Carbon Charts' built-in entry animations are enabled; `prefers-reduced-motion` disables all of it.

### 4.4 The interaction that sells the product

**Weight adjustment → live reshuffle.** A leader opens ⚙ Weights, drags *Leverage* from 0.30 to 0.45. Cards re-rank with a 240ms FLIP animation; #4 moves to #1. A `InlineNotification` reads *"Ranking now reflects your weights. Reset to GitWeave defaults."*

This is the moment the tool stops being an oracle and becomes an instrument. It is also intellectually honest: we are asserting a *model*, not a fact.

### 4.5 Why-sentence generation

Each rank card carries one deterministic, template-generated sentence built from that engineer's **two strongest dimensions relative to cohort**, filled with real numbers:

> *"Owns 62% of `products/cdp`; unblocks 9 teams at 34-min median review latency."*
> *"Review spine of feature-flags — 143 review threads that changed code, 0 reverts across 84 merges."*

Deterministic templates, not an LLM, by default: reproducible, auditable, zero-latency, no data egress. LLM-generated narrative is an opt-in enhancement behind a flag.

### 4.6 Accessibility

Carbon gives WCAG 2.1 AA for free; we must not break it. Carbon Charts colour palettes are colour-blind-safe and every series is redundantly encoded with pattern/label. Full keyboard path: `Tab` through rank cards, `Enter` to select, `Esc` to close panels. Radar chart ships with a screen-reader `<table>` equivalent. All charts pass `axe-core` in CI.

---

## 5. Leadership use cases

The dashboard's value is the decisions it changes.

| # | Use case | The question | What GitWeave shows | Decision enabled |
|---|---|---|---|---|
| 1 | **Promotion & calibration** | "Is the Staff case for X real?" | Fingerprint vs the Staff cohort median + the 5 strongest PRs as evidence | Walk into calibration with artefacts, not adjectives |
| 2 | **Find the hidden glue** | "Who's load-bearing that I'd never notice?" | High Leverage + low authored volume — the profile every throughput tool buries | Retain and promote the people who actually hold it together |
| 3 | **Bus-factor / key-person risk** | "What breaks if someone leaves?" | Ownership treemap; single-owner surfaces flagged red | Fund a second owner *before* the resignation |
| 4 | **Review bottlenecks** | "Why is everything slow?" | Unblock-latency distribution + alluvial load concentration | Rebalance reviewer load; add reviewers to the choke point |
| 5 | **Onboarding health** | "Are new hires ramping?" | Trajectory for <90-day contributors vs the historical ramp curve | Intervene at week 6, not month 6 |
| 6 | **Team health** | "Which teams are healthy?" | Team rollup by `team/*`: distribution shape, reliability, cross-team reach | Spot the team carried by one person |
| 7 | **Agent-era strategy** | "Is the self-driving agent working, and who's good at driving it?" | Agent Leverage % by engineer and team, with reliability alongside | Decide whether to expand agent investment — with evidence |
| 8 | **Underloaded / at-risk** | "Who's disengaging?" | Sustained decline across dimensions | A 1:1, early |
| 9 | **Reorg input** | "Where do the real seams run?" | Alluvial + cross-team reach reveal the *de facto* org chart | Align the formal org with reality |

### 5.1 Explicit anti-uses

Shipped **in-product** as a dismissible notice on first run, because a tool like this is only safe if its limits travel with it:

> GitWeave measures *observable GitHub activity*. It cannot see design docs, incident response, customer calls, interviews, architecture debates, or the conversation that stopped a bad project. Use it to **generate questions**, never to conclude answers.
>
> **Do not** use GitWeave for stack ranking, PIPs, compensation, or headcount decisions without human context. Low score ≠ low performer; it frequently means their highest-impact work does not happen on GitHub.

---

## 6. Technical architecture

### 6.1 Stack

| Layer | Choice | Licence | Why |
|---|---|---|---|
| Language | TypeScript 5.6 (strict) | Apache-2.0 | Shared types end-to-end |
| Monorepo | pnpm workspaces + Turborepo | MIT | Fast, cached, minimal |
| Web | Next.js 15 (App Router) + React 19 | MIT | RSC for fast first paint of a read-heavy dashboard |
| Design system | **@carbon/react + @carbon/charts-react** | Apache-2.0 | Required; charts cover every visual need |
| API | Fastify 5 + tRPC 11 | MIT | End-to-end type safety, no codegen |
| Validation | Zod 3 | MIT | One schema for API, DB, env |
| Database | **MongoDB 7 Community** | SSPL-1.0 | Per requirement. Aggregation framework is an excellent fit for the metric pipelines; flexible schema suits GitHub's irregular payloads |
| ODM | Mongoose 8 | MIT | Schema discipline over a schemaless store |
| Queue / cache | BullMQ + Redis 7.2 | MIT / BSD-3 | Checkpointed, retryable ingestion |
| GitHub client | `@octokit/graphql` + `@octokit/plugin-throttling` | MIT | Rate-limit handling is the hard part |
| Testing | Vitest + Playwright + Testcontainers | MIT / Apache-2.0 | Metric engine is pure TS → fast unit tests |
| Container | Docker + Compose v2 | Apache-2.0 | Single-command bring-up |

> **Licence note:** MongoDB Community is SSPL, which is source-available rather than OSI-approved. It is specified here per requirement and is entirely unproblematic for self-hosted use. If strict OSI compliance ever becomes a constraint (e.g. offering GitWeave as a managed service), FerretDB (Apache-2.0, MongoDB wire-protocol compatible) is a drop-in swap — which is why all DB access is isolated behind `packages/db`.

### 6.2 Monorepo layout

```
gitweave/
├── apps/
│   ├── web/                 # Next.js 15 · Carbon · the single-page dashboard
│   ├── api/                 # Fastify + tRPC · reads materialised metrics only
│   └── ingest/              # BullMQ worker · GitHub sync + metric materialisation
├── packages/
│   ├── core/                # ⭐ PURE metric engine — no I/O, fully unit-tested
│   │   ├── dimensions/      # ownership · leverage · reliability · reach · initiative
│   │   ├── attribution/     # bot classification · agent-PR attribution · identity merge
│   │   ├── normalise/       # percentile ranks · log-damping · tenure adjustment
│   │   └── explain/         # evidence selection · why-sentence templates
│   ├── db/                  # Mongoose models · aggregation pipelines · indexes
│   ├── github/              # GraphQL queries · cost-aware scheduler · token pool
│   ├── types/               # Zod schemas shared by every app
│   └── config/              # env parsing/validation · eslint · tsconfig bases
├── docker/                  # Dockerfiles · mongo init · seed fixtures
├── docker-compose.yml
├── docker-compose.dev.yml
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

**The critical structural decision:** `packages/core` is **pure functions over plain data — no database, no network**. The entire impact model is therefore unit-testable with fixtures, deterministic, and reviewable by an engineer who doesn't want to read infrastructure code. For a product whose whole value proposition is *"trust this number,"* the scoring logic must be the most legible code in the repo.

### 6.3 Ingestion — the real engineering problem

**15,061 merged PRs in 90 days** makes naive approaches fail outright:

- REST: 151 pages of PR lists **plus** 4 sub-resource calls per PR (reviews, review comments, files, commits) ≈ **60,000+ requests**. At 5,000/hr that is 12 hours.
- Unbatched GraphQL: same problem, different syntax.

**The design:**

1. **GraphQL with deep nesting.** One query per 100-PR page returns PRs + `reviews(first:30)` + `reviewThreads(first:30)` + `files(first:100)` + `commits(first:50)` + labels + `mergedBy`. ~151 primary requests instead of 60,000.
2. **Cost-aware scheduler.** Every response returns `rateLimit { cost remaining resetAt }`. The scheduler reads actual cost, maintains a token-bucket per credential, and adaptively shrinks page size when nested connections get expensive. **Never** blind-retries into a limit.
3. **Token pooling.** `GITHUB_TOKENS` accepts a comma-separated list; least-recently-used rotation across N credentials gives N × 5,000 points/hr. Four tokens → the 90-day cold backfill lands in **under 45 minutes**.
4. **Secondary-limit protection.** GitHub's concurrency limit is separate and undocumented. Hard cap of 6 concurrent requests, exponential backoff with full jitter, honour `Retry-After`.
5. **Cursor checkpointing.** Every page's `endCursor` is persisted to `sync_state`. A crash resumes at the exact page, never from zero.
6. **Bulk upserts.** `bulkWrite` with `ordered: false`, batches of 500.
7. **Incremental sync** every 15 min on `orderBy: {field: UPDATED_AT}`, short-circuiting at the last-seen watermark.
8. **Materialisation stage.** Aggregation pipelines write `$merge` into `engineer_metrics`. **The API never computes a score at request time** — it reads a precomputed document. This is what buys NFR-1's sub-2s paint against a 15k-PR dataset.

```
GitHub GraphQL ─▶ ingest worker ─▶ MongoDB (raw)
                       │                 │
                  token pool +       aggregation
                  cost scheduler      pipelines
                       │                 ▼
                  sync_state ◀──── engineer_metrics (materialised)
                                          │
                                    Fastify/tRPC ─▶ Next.js + Carbon
                                          │
                                    Redis (response cache)
```

### 6.4 Data model (MongoDB)

| Collection | Purpose | Key indexes |
|---|---|---|
| `repositories` | Tracked repos, sync config | `{owner, name}` unique |
| `pull_requests` | Merged/open PRs with embedded label + file summaries | `{repo, mergedAt}`, `{repo, authorId}`, `{repo, number}` unique |
| `reviews` | Reviews + review threads, with `consequential` flag precomputed at ingest | `{prId}`, `{reviewerId, submittedAt}` |
| `commits` | Commit-level authorship — **essential for agent-PR attribution** | `{prId}`, `{authorId, committedAt}` |
| `file_changes` | Per-PR file deltas with resolved product area + blast-radius class | `{prId}`, `{path}`, `{productArea}` |
| `file_centrality` | Materialised per-file centrality weights | `{repo, path}` unique |
| `identities` | GitHub login ↔ canonical person; bot flag; first-seen (tenure) | `{login}` unique, `{personId}` |
| `engineer_metrics` | **Materialised** per-engineer, per-window dimension scores + evidence PR ids | `{repo, window, personId}` unique, `{repo, window, impactScore: -1}` |
| `sync_state` | Cursors, watermarks, job checkpoints | `{repo, jobType}` unique |

`engineer_metrics` stores **dimension percentiles**, not the final score. The final score is composed client-side from the leader's weights — which is exactly how FR-8's <200ms re-rank is achieved without a round-trip.

### 6.5 Docker

`docker-compose.yml` brings up: `mongo` (7, healthcheck, named volume), `redis` (7.2-alpine, AOF), `api`, `ingest`, `web`, and a one-shot `seed` service that loads a committed PostHog fixture so **`docker compose up` yields a populated dashboard in ~60 seconds with no GitHub token required**. Live sync starts only once a token is present. All app images are multi-stage (`node:22-alpine` builder → distroless runtime), non-root, with healthchecks and pinned digests.

---

## 7. Environment configuration

### 7.1 GitHub token strategy — the reasoning

This deserves real thought, because it determines both security posture and whether the backfill finishes.

**Option A — Classic PAT.** Works everywhere, simplest. But the only scope that reads private repos is `repo`, which also grants **write**. For a read-only analytics tool that is a serious over-grant. Classic PATs can also be created without expiry. **Rejected as default.**

**Option B — Fine-grained PAT. ✅ RECOMMENDED DEFAULT.** Per-resource read-only permissions, mandatory expiry, per-repository scoping, independently revocable. Full 5,000 req/hr and full GraphQL support. For PostHog/posthog — a public repo we don't own — a fine-grained PAT with **Public Repositories (read-only)** is exactly right.

Required permissions:

| Permission | Level | Used for |
|---|---|---|
| Repository → Metadata | Read | Mandatory baseline |
| Repository → Contents | Read | CODEOWNERS, directory structure, commits |
| Repository → Pull requests | Read | PRs, reviews, review threads, comments |
| Repository → Issues | Read | Issue triage and discussion signals |
| Repository → Actions | Read | *Optional* — first-pass CI health |
| Organization → Members | Read | *Optional* — only works for orgs you belong to; team rollup falls back to `team/*` labels |

**Option C — GitHub App.** The right answer for GitWeave-as-a-product: installation tokens auto-expire hourly, rate limits scale with org size (up to 12,500/hr), per-repo installation, clean audit trail, no human's credential in the loop. Requires org installation, so it can't be used against PostHog from outside. **Supported as an alternative auth mode, recommended for self-hosting inside your own org.**

**Decision: support all three, default to fine-grained PAT, and pool multiple credentials.** Token pooling is the difference between a 3-hour and a 45-minute backfill, and it costs ~30 lines of code.

### 7.2 `.env.example`

```bash
# ───────────────────────────────────────────────────────────────
# GITHUB ACCESS
# ───────────────────────────────────────────────────────────────
# AUTH MODE: "pat" (default) | "app"
GITHUB_AUTH_MODE=pat

# RECOMMENDED: fine-grained PAT, read-only.
#   github.com/settings/personal-access-tokens/new
#   Resource owner: your account
#   Repository access: "Public repositories (read-only)"
#   Permissions: Metadata:R, Contents:R, Pull requests:R, Issues:R, Actions:R (optional)
#   Expiration: 90 days (rotate; never "no expiration")
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxxxxxx

# OPTIONAL: comma-separated token pool. N tokens → N × 5,000 pts/hr.
# Cuts the 15k-PR / 90-day PostHog backfill from ~3h to <45min.
GITHUB_TOKENS=

# ALTERNATIVE — GitHub App (recommended when self-hosting in your own org)
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/gitweave-app.pem

GITHUB_API_URL=https://api.github.com
GITHUB_GRAPHQL_URL=https://api.github.com/graphql

# ───────────────────────────────────────────────────────────────
# TARGET REPOSITORY
# ───────────────────────────────────────────────────────────────
TARGET_REPO_OWNER=PostHog
TARGET_REPO_NAME=posthog
ANALYSIS_WINDOW_DAYS=90
BACKFILL_MAX_DAYS=365

# ───────────────────────────────────────────────────────────────
# DATABASE
# ───────────────────────────────────────────────────────────────
MONGODB_URI=mongodb://gitweave:gitweave@mongo:27017/gitweave?authSource=admin
MONGODB_DB_NAME=gitweave
MONGO_INITDB_ROOT_USERNAME=gitweave
MONGO_INITDB_ROOT_PASSWORD=change-me-in-production

REDIS_URL=redis://redis:6379
REDIS_CACHE_TTL_SECONDS=300

# ───────────────────────────────────────────────────────────────
# INGESTION TUNING
# ───────────────────────────────────────────────────────────────
INGEST_CONCURRENCY=6              # keep ≤8: GitHub's secondary (concurrency) limit
INGEST_PAGE_SIZE=100              # auto-reduced by the cost-aware scheduler
INGEST_RATE_LIMIT_BUFFER=500      # stop and wait when points remaining drops below this
INGEST_MAX_RETRIES=5
INGEST_BACKOFF_BASE_MS=1000       # exponential + full jitter
SYNC_CRON=*/15 * * * *
BACKFILL_ON_BOOT=true

# ───────────────────────────────────────────────────────────────
# ATTRIBUTION & BOT HANDLING
# ───────────────────────────────────────────────────────────────
# Beyond __typename==Bot and the [bot] suffix. Comma-separated.
# These five would otherwise occupy the top 5 reviewer slots on PostHog.
BOT_DENYLIST=stamphog,greptile-apps,veria-ai,coderabbitai,copilot-pull-request-reviewer,dependabot,dependabot-preview,scheduled-actions-posthog,github-actions,renovate
# Agent accounts whose PRs are attributed to the humans who commit/review/merge them
AGENT_AUTHORS=posthog
AGENT_BRANCH_PREFIXES=posthog-self-driving/
ATTRIBUTE_AGENT_PRS_TO_HUMANS=true

# ───────────────────────────────────────────────────────────────
# SCORING (defaults; overridable live in the UI)
# ───────────────────────────────────────────────────────────────
WEIGHT_OWNERSHIP=0.28
WEIGHT_LEVERAGE=0.30
WEIGHT_REACH=0.18
WEIGHT_INITIATIVE=0.14
WEIGHT_PROBLEM_SHAPING=0.10
RELIABILITY_MODIFIER_MIN=0.85
RELIABILITY_MODIFIER_MAX=1.10
MIN_PRS_FOR_RANKING=5             # below this → "low confidence" badge, still listed
BLAST_RADIUS_MULTIPLIER=1.6
LOW_RISK_PATH_MULTIPLIER=0.4

# ───────────────────────────────────────────────────────────────
# APPLICATION
# ───────────────────────────────────────────────────────────────
NODE_ENV=development
API_PORT=4000
WEB_PORT=3000
NEXT_PUBLIC_API_URL=http://localhost:4000
LOG_LEVEL=info

# ───────────────────────────────────────────────────────────────
# AUTH (optional; dashboard is open in local/dev)
# ───────────────────────────────────────────────────────────────
AUTH_ENABLED=false
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=

# ───────────────────────────────────────────────────────────────
# FEATURE FLAGS
# ───────────────────────────────────────────────────────────────
FEATURE_LLM_SUMMARIES=false       # off by default: determinism + no data egress
FEATURE_AGENT_LEVERAGE_PANEL=true
FEATURE_TEAM_ROLLUP=true
FEATURE_EXPORT=true
```

### 7.3 Secrets handling

`.env` is git-ignored; only `.env.example` is committed. Compose reads secrets via `env_file` and the GitHub App key via a Docker secret mount, never baked into an image. Env is parsed and validated by a Zod schema in `packages/config` at boot — **the process refuses to start on a malformed or missing required variable** rather than failing three layers deep at the first API call.

---

## 8. Delivery plan

### 8.1 Phase 0 — the 90-minute take-home slice

The assignment caps at 90 minutes and rewards pragmatism, so Phase 0 is a deliberately narrowed vertical slice that still fully answers the question:

| In | Out (deferred) |
|---|---|
| GraphQL ingest, 90 days, merged PRs + reviews + files + commits | Real-time sync, webhooks |
| Bot exclusion + agent attribution (the two findings that actually change the answer) | Identity merging across accounts |
| All five dimensions, default weights | Live weight sliders |
| Single-page Carbon dashboard: top 5, radar, decomposition, evidence rail | Treemap, alluvial, team rollup |
| Docker Compose + committed fixture (guarantees the reviewer's link loads fast) | Auth, multi-repo |

This directly retires every stated red flag: the fixture guarantees the link loads, sub-2s paint beats the 10s ceiling, the evidence rail kills "Score: 207 with no context," and the top-5 card grid answers the literal question.

### 8.2 Roadmap

| Phase | Scope |
|---|---|
| **1 — Foundation** | Monorepo, Docker, Mongo schema, GraphQL ingest with token pool + checkpointing, bot/agent attribution |
| **2 — Metric engine** | `packages/core`: all five dimensions + reliability, percentile normalisation, evidence selection, ≥85% unit coverage against fixtures |
| **3 — Dashboard** | Carbon single page, radar, decomposition, evidence rail, skeleton loading |
| **4 — Interrogation** | Weight sliders + FLIP re-rank, window selector, drill-through, treemap, alluvial |
| **5 — Scale** | Multi-repo, team rollups, identity merging, exports, GitHub App auth, trend tracking |

### 8.3 Success metrics

| Metric | Target |
|---|---|
| Leader can name the top 5 and *why* within 60s of first load, unaided | ≥ 80% in usability testing |
| Leader can trace any score to source PRs | 100% of components |
| Engineers shown their own profile rate it "fair" | ≥ 70% |
| TTI on the PostHog dataset | < 3.5s |
| Ranking disagreement vs. leaders' independent blind top-5 | ≤ 2 of 5 differ |

### 8.4 Risks

| Risk | Mitigation |
|---|---|
| **Goodhart's law** — the metric becomes the target | Five orthogonal dimensions; the signals with highest weight (consequential review, solicited trust, file centrality) all depend on *other people's* behaviour. Ship the anti-use notice in-product. |
| **Bot contamination** silently corrupts rankings | Two-layer detection (typename + denylist), and a **visible "N bots excluded" chip** so it is auditable rather than hidden |
| **Agent-PR misattribution** | Commit-level and steward-level attribution, validated against PR #98640 as a regression fixture |
| **GitHub rate limits** stall the backfill | Cost-aware scheduler, token pooling, checkpointed resume, committed fixture as fallback |
| **Leaders misuse for stack-ranking** | Explicit in-product anti-use notice; confidence badges; archetypes framed as neutral, never ranked |
| **New-joiner penalty** | Per-active-day normalisation + low-confidence badge instead of silent burial |

---

## 9. Open questions

1. Should Agent Leverage ever feed the score, or stay permanently neutral? (Current stance: neutral — we lack the outcome data to judge, and pretending otherwise would be the exact overreach this product is built to avoid.)
2. Is 0.30 the right weight for Leverage, or should the default be flat 0.20 across all five and let every leader form their own opinion from a neutral prior?
3. Should engineers see their own profile by default? (Argues for fairness; risks anxiety-driven behaviour change.)
4. Is a 90-day window right for calibration, or should the default be 180 days to smooth project cycles?

---

## Appendix A — Implementation findings (added after the build)

The PRD above is the design. Building it against the live PostHog repository corrected the model
in four places. Recording them here keeps the spec honest rather than retro-fitting it to look
prescient. Full detail in [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md).

### A.1 Size must be a weak tiebreaker, not a term

§2.2 specified `prWeight = Σ centrality × blast-radius × log1p(size)`. In practice
`log1p(1800) = 7.5` against `log1p(16) = 2.8` gives bulk a 2.7× edge that swamps both the 1.6×
blast-radius multiplier and centrality — quietly rebuilding the lines-of-code metric this product
exists to replace. **Corrected to `1 + log1p(size)/6`**, capping the size range at ~1.0–2.6×.

### A.2 Bot-ness must live in the identifier

§3.1 FR-2 treated bot exclusion as a filter. That is not sufficient: GraphQL reports bot-ness
per actor via `__typename`, and any pipeline carrying it as a side-channel flag will lose it on
some actor. It did — on review authors, thread authors, commit authors and requested reviewers —
and PostHog's AI reviewer reached **rank 3 with 1,059 "consequential" review threads**.
**Corrected: a bot's canonical login always ends in `[bot]`**, and agent accounts are
force-added to the bot denylist inside the engine.

### A.3 Entropy alone cannot detect a codemod

§2.5 argued that entropy-weighted area counts distinguish real breadth from a long tail. It does
not, because **Shannon entropy is scale-invariant**: a perfectly uniform sweep across 60
directories has *maximal* entropy. Live data showed an engineer "spanning 75 product areas" from
one-file-per-directory codemods. **Corrected: effective areas are capped by total work presence**
— you cannot be meaningfully engaged in more areas than you did units of work — plus fractional
per-area attribution, a ≤8-area cap on boundary-work credit, and a ≥25%-of-files requirement
before a PR can claim to have founded a surface.

### A.4 Ingest raw markdown, not `bodyText`

§2.6's problem-statement heuristic reads `## Problem` headings, tables and links. GraphQL's
`bodyText` strips all of them, so the heading regex matched **0 of 2,084** PostHog PRs that do
have a problem section, and the dimension contributed nothing while looking perfectly plausible.
**Corrected: ingest raw `body`**, and tolerate markdown, bold and plain headings.

### A.5 Termination must key on the ordering field

§6.3 specified cursor pagination over `orderBy: UPDATED_AT` with a `mergedAt` window filter, but
did not specify the stop condition. The implementation used a tolerance of three consecutive
pages with no in-window merges, which silently truncated PostHog's window at **3,841 of ~15,000
PRs** while reporting completion — old PRs commented on recently sort early and trip the
heuristic. **Corrected: stop when a page's oldest `updatedAt` precedes the window start.** Since
`updatedAt >= mergedAt`, that is provably lossless.

This maps directly onto the assignment's own red flag — *"incorrect, incomplete or missing
data"* — and it is the kind of bug that only surfaces when output is checked against the source
rather than against itself.

### A.6 Confirmed as specified

- **Token pooling is necessary, not a nicety.** Measured ~8 GraphQL cost-points per 25 PRs, so a
  single credential's 5,000 points/hr covers ~12,500 PRs — the 90-day PostHog window sits right
  at the edge of one token, exactly as §6.3 predicted.
- **Materialisation delivers the latency budget.** Measured 120 ms TTFB and 185 kB first-load JS
  against NFR-1's 2.0s target, because the API reads one pre-computed document.
- **The single-screen constraint holds.** Measured `scrollHeight === clientHeight === 900` at
  1440×900 with zero console errors.
