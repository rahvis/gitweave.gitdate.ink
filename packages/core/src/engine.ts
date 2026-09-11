import type {
  CohortSummary, DashboardPayload, DimensionKey, EngineerMetrics,
  PullRequestRecord, Weights,
} from '@gitweave/types';
import { DEFAULT_WEIGHTS, DIMENSION_KEYS } from '@gitweave/types';
import { BotClassifier } from './attribution/bots.js';
import { AgentAttributor } from './attribution/agents.js';
import { PathClassifier, DEFAULT_CRITICAL_PATTERNS, DEFAULT_LOW_RISK_PATTERNS, resolveProductArea } from './paths.js';
import { computeFileCentrality, computeFileOrigins } from './centrality.js';
import { buildPRContext, type PRContext } from './context.js';
import { newEngineerRaw, type EngineerRaw } from './accumulator.js';
import { computeOwnership } from './dimensions/ownership.js';
import { computeLeverage } from './dimensions/leverage.js';
import { computeReach } from './dimensions/reach.js';
import { computeInitiative } from './dimensions/initiative.js';
import { computeProblemShaping } from './dimensions/problem-shaping.js';
import { computeReliability } from './dimensions/reliability.js';
import { buildWhySentence, deriveArchetype, deriveConfidence, selectEvidence } from './explain.js';
import { clamp, hoursBetween, isoWeek, median, percentileRank } from './stats.js';

export interface EngineOptions {
  repo: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  weights?: Weights;
  botDenylist: string[];
  agentAuthors: string[];
  agentBranchPrefixes: string[];
  blastHighMultiplier: number;
  blastLowMultiplier: number;
  minPRsForRanking: number;
  reliability: { min: number; max: number; penaltyFactor: number };
  criticalPatterns?: string[];
  lowRiskPatterns?: string[];
  avatarUrls?: Map<string, string>;
}

const DAY_MS = 86_400_000;
const FIX_TITLE_RE = /^\s*(fix|hotfix|fixup|bugfix|patch)\b|^\s*fix\(/i;
const RAPID_FIX_WINDOW_MS = 48 * 3_600_000;
const MIN_SHARE_FOR_OWNERSHIP = 0.30;
const MIN_PRS_FOR_OWNERSHIP = 5;

/**
 * The whole impact model, as one pure function over plain records.
 *
 * No database, no network, no clock. That is deliberate: for a product whose
 * entire value proposition is "trust this number", the scoring logic has to be
 * the most legible and most testable code in the repo.
 */
export function computeImpact(prs: PullRequestRecord[], opts: EngineOptions): DashboardPayload {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const windowStartMs = new Date(opts.windowStart).getTime();
  const windowEndMs = new Date(opts.windowEnd).getTime();

  // Agent accounts are always bots for cohort purposes: their PRs are
  // attributed to the humans who drove them, but the agent itself is never
  // rankable. Belt and braces alongside the `[bot]` login convention.
  const bots = new BotClassifier([...opts.botDenylist, ...opts.agentAuthors]);
  const agents = new AgentAttributor(opts.agentAuthors, opts.agentBranchPrefixes);
  const paths = new PathClassifier(
    opts.criticalPatterns ?? DEFAULT_CRITICAL_PATTERNS,
    opts.lowRiskPatterns ?? DEFAULT_LOW_RISK_PATTERNS,
  );

  const inWindow = prs.filter((p) => {
    if (!p.mergedAt) return false;
    const t = new Date(p.mergedAt).getTime();
    return t >= windowStartMs && t <= windowEndMs;
  });

  const authorsFor = (pr: PullRequestRecord) => agents.authorsFor(pr, bots);
  const centrality = computeFileCentrality(inWindow, bots, authorsFor);
  const fileOrigins = computeFileOrigins(inWindow);

  const deps = {
    bots, agents, paths, centrality, fileOrigins,
    blastHighMultiplier: opts.blastHighMultiplier,
    blastLowMultiplier: opts.blastLowMultiplier,
  };
  const contexts = inWindow.map((pr) => buildPRContext(pr, deps));

  /* ── Cohort-level precomputation ──────────────────────────────────────── */

  const areaTotals = new Map<string, number>();
  const areaFirstSeen = new Map<string, { ms: number; prNumber: number }>();
  const titleToAuthors = new Map<string, Set<string>>();
  const firstSeenByLogin = new Map<string, number>();
  const pathIndex = new Map<string, Array<{ prNumber: number; ms: number }>>();
  const contextByNumber = new Map<number, PRContext>();

  for (const ctx of contexts) {
    contextByNumber.set(ctx.pr.number, ctx);
    const ms = ctx.mergedAtMs;
    for (const [area, share] of ctx.areaShares) {
      areaTotals.set(area, (areaTotals.get(area) ?? 0) + share);
      const prev = areaFirstSeen.get(area);
      if (!prev || ms < prev.ms) areaFirstSeen.set(area, { ms, prNumber: ctx.pr.number });
    }
    const key = ctx.pr.title.trim().toLowerCase();
    let set = titleToAuthors.get(key);
    if (!set) { set = new Set(); titleToAuthors.set(key, set); }
    for (const a of ctx.authors) {
      set.add(a);
      const seen = firstSeenByLogin.get(a);
      if (seen === undefined || ms < seen) firstSeenByLogin.set(a, ms);
    }
    // Bound the index: pathological paths (lockfiles) would otherwise dominate.
    if (ctx.pr.files.length <= 200) {
      for (const f of ctx.pr.files) {
        let list = pathIndex.get(f.path);
        if (!list) { list = []; pathIndex.set(f.path, list); }
        if (list.length < 400) list.push({ prNumber: ctx.pr.number, ms });
      }
    }
  }

  /**
   * A contributor is "new in window" if their first merged PR lands after the
   * first quarter of the window. Honest approximation: a 90-day window cannot
   * see tenure that began before it, and the UI labels it as such.
   */
  const newContributorCutoff = windowStartMs + (windowEndMs - windowStartMs) * 0.25;
  const newContributors = new Set(
    [...firstSeenByLogin.entries()].filter(([, ms]) => ms > newContributorCutoff).map(([l]) => l),
  );

  /* ── Reverts: match `Revert "<title>"` back to the original authors ───── */
  const revertsByLogin = new Map<string, number>();
  for (const ctx of contexts) {
    if (!ctx.isRevert || !ctx.revertedTitle) continue;
    const victims = titleToAuthors.get(ctx.revertedTitle.trim().toLowerCase());
    if (!victims) continue;
    for (const v of victims) {
      if (ctx.authorSet.has(v) && victims.size === 1) continue; // self-revert of own WIP: not a defect signal
      revertsByLogin.set(v, (revertsByLogin.get(v) ?? 0) + 1);
    }
  }

  /* ── Rapid-fix follow-ons: a fix within 48h touching ≥50% the same files ─ */
  const rapidFixByLogin = new Map<string, number>();
  for (const fix of contexts) {
    if (!FIX_TITLE_RE.test(fix.pr.title) || fix.pr.files.length === 0) continue;
    const overlap = new Map<number, number>();
    for (const f of fix.pr.files) {
      const list = pathIndex.get(f.path);
      if (!list) continue;
      for (const entry of list) {
        if (entry.prNumber === fix.pr.number) continue;
        const dt = fix.mergedAtMs - entry.ms;
        if (dt <= 0 || dt > RAPID_FIX_WINDOW_MS) continue;
        overlap.set(entry.prNumber, (overlap.get(entry.prNumber) ?? 0) + 1);
      }
    }
    for (const [prNumber, shared] of overlap) {
      const victim = contextByNumber.get(prNumber);
      if (!victim || victim.pr.files.length === 0) continue;
      if (shared / victim.pr.files.length < 0.5) continue;
      for (const a of victim.authors) {
        if (fix.authorSet.has(a)) continue; // fixing your own work quickly is iteration, not failure
        rapidFixByLogin.set(a, (rapidFixByLogin.get(a) ?? 0) + 1);
      }
    }
  }

  /* ── Single accumulation pass ─────────────────────────────────────────── */

  const byLogin = new Map<string, EngineerRaw>();
  const get = (login: string): EngineerRaw => {
    let e = byLogin.get(login);
    if (!e) { e = newEngineerRaw(login); byLogin.set(login, e); }
    return e;
  };

  for (const ctx of contexts) {
    const ms = ctx.mergedAtMs;
    const day = new Date(ms).toISOString().slice(0, 10);
    const week = ctx.pr.mergedAt ? isoWeek(ctx.pr.mergedAt) : '';

    // ── author side ──
    for (const login of ctx.authors) {
      const e = get(login);
      e.authored.push(ctx);
      e.weightedChangeVolume += Math.log1p(ctx.prWeight);
      if (ctx.touchesCritical) e.criticalPRs += 1;
      for (const [area, share] of ctx.areaShares) {
        e.areaCounts.set(area, (e.areaCounts.get(area) ?? 0) + share);
      }
      for (const s of ctx.stacks) e.stacks.add(s);
      for (const t of ctx.teams) e.teams.add(t);
      // Genuine integration work spans a handful of areas. A 40-area sweep is
      // not "boundary work", it is a codemod, so the upper bound matters.
      if (ctx.productAreas.length >= 2 && ctx.productAreas.length <= 8 && ctx.stacks.length >= 2) {
        e.boundaryPRs += 1;
      }
      e.filesCreated += ctx.filesCreatedHere;
      if (week) e.weeks.add(week);
      e.activeDays.add(day);
      e.firstSeenMs = Math.min(e.firstSeenMs, ms);
      e.lastSeenMs = Math.max(e.lastSeenMs, ms);
      if (ctx.hasProblemStatement) { e.problemPRs += 1; e.problemQualitySum += ctx.problemQuality; }
      if (ctx.isAgentPR) {
        e.agentStewardedMerges += 1;
        e.commitsIntoAgentPRs += ctx.ownCommitCount.get(login) ?? 0;
      } else {
        e.humanAuthoredMerges += 1;
      }
      for (const f of ctx.pr.files) {
        let times = e.fileTouchTimes.get(f.path);
        if (!times) { times = []; e.fileTouchTimes.set(f.path, times); }
        times.push(ms);
      }
      // Founding a surface that first appeared mid-window. Requires the PR to
      // be substantially *about* that area (>=25% of its files), otherwise a
      // sweep that happens to touch a new directory first claims to have
      // founded it.
      for (const [area, share] of ctx.areaShares) {
        if (share < 0.25) continue;
        const first = areaFirstSeen.get(area);
        if (first && first.prNumber === ctx.pr.number && first.ms > newContributorCutoff) {
          e.newAreasFounded += 1;
        }
      }
    }

    // ── review side ──
    const authorIsNew = ctx.authors.some((a) => newContributors.has(a));
    for (const thread of ctx.consequentialThreads) {
      const e = get(thread.reviewer);
      e.consequentialThreads += 1;
      for (const a of ctx.authors) {
        e.reviewedAuthors.add(a);
        e.reviewEdges.set(a, (e.reviewEdges.get(a) ?? 0) + 1);
      }
      const area = thread.path ? resolveProductArea(thread.path) : ctx.productAreas[0];
      if (area) e.reviewedAreas.add(area);
      if (authorIsNew) e.mentorshipThreads += 1;
      e.activeDays.add(day);
    }
    for (const stamper of ctx.rubberStamps) get(stamper).rubberStampsGiven += 1;
    for (const { reviewer, hours } of ctx.unblockLatency) {
      if (hours >= 0 && hours < 24 * 60) get(reviewer).unblockHours.push(hours);
    }
    for (const req of ctx.pr.reviewRequests) {
      const who = req.requestedLogin;
      if (who && !bots.isBot(who) && !ctx.authorSet.has(who)) get(who).solicitedRequests += 1;
    }
    // Merging someone else's PR is taking responsibility for it landing.
    if (ctx.steward && !ctx.authorSet.has(ctx.steward)) get(ctx.steward).stewardedMerges += 1;
    // Substantive discussion on other people's PRs.
    for (const c of ctx.pr.comments) {
      const who = c.authorLogin;
      if (!who || bots.isBot(who) || ctx.authorSet.has(who)) continue;
      if (c.bodyLength >= 80) get(who).discussionOnOthers += 1;
    }
  }

  for (const [login, n] of revertsByLogin) get(login).reverts = n;
  for (const [login, n] of rapidFixByLogin) get(login).rapidFixFollowOns = n;

  /* ── Dimension computation ────────────────────────────────────────────── */

  const cohortAll = [...byLogin.values()].filter((e) => !bots.isBot(e.login));
  const windowSpanDays = Math.max(1, (windowEndMs - windowStartMs) / DAY_MS);

  interface Computed {
    raw: EngineerRaw;
    dims: ReturnType<typeof bundleFor>;
    rawByDim: Record<DimensionKey, number>;
  }

  function bundleFor(e: EngineerRaw) {
    return {
      ownership: computeOwnership(e, {
        areaTotals, minPRsForOwnership: MIN_PRS_FOR_OWNERSHIP, minShareForOwnership: MIN_SHARE_FOR_OWNERSHIP,
      }),
      leverage: computeLeverage(e),
      reach: computeReach(e),
      initiative: computeInitiative(e),
      problemShaping: computeProblemShaping(e),
      reliability: computeReliability(e, opts.reliability),
    };
  }

  const computed: Computed[] = cohortAll.map((e) => {
    const dims = bundleFor(e);
    /**
     * Tenure normalisation: someone present for only the last 30 days of a
     * 90-day window is projected up so they are not silently buried, but the
     * projection is capped at 2× so a short hot streak cannot beat a quarter
     * of sustained work. Rate-based dimensions are exempt — they need no
     * projection.
     */
    const tenureDays = e.firstSeenMs === Number.POSITIVE_INFINITY
      ? windowSpanDays
      : Math.max(1, (windowEndMs - e.firstSeenMs) / DAY_MS);
    const tenureFactor = clamp(windowSpanDays / Math.max(tenureDays, windowSpanDays * 0.25), 1, 2);
    return {
      raw: e,
      dims,
      rawByDim: {
        ownership: dims.ownership.raw * tenureFactor,
        leverage: dims.leverage.raw * tenureFactor,
        reach: dims.reach.raw * tenureFactor,
        initiative: dims.initiative.raw * tenureFactor,
        problemShaping: dims.problemShaping.raw,
      },
    };
  });

  /**
   * Cohort for percentile ranking: anyone with *any* observable participation.
   * Deliberately wide. Someone who only rubber-stamps approvals should appear
   * and rank low with a visible reason, not silently disappear — an absent row
   * is unfalsifiable, and a leader cannot audit what they cannot see.
   */
  const active = computed.filter((c) =>
    c.raw.authored.length > 0
    || c.raw.consequentialThreads > 0
    || c.raw.rubberStampsGiven > 0
    || c.raw.solicitedRequests > 0
    || c.raw.stewardedMerges > 0
    || c.raw.discussionOnOthers > 0);

  const sortedByDim = {} as Record<DimensionKey, number[]>;
  for (const key of DIMENSION_KEYS) {
    sortedByDim[key] = active.map((c) => c.rawByDim[key]).sort((a, b) => a - b);
  }

  const engineers: EngineerMetrics[] = active.map((c) => {
    const percentiles = {} as Record<DimensionKey, number>;
    for (const key of DIMENSION_KEYS) {
      percentiles[key] = percentileRank(c.rawByDim[key], sortedByDim[key]);
    }
    const weighted =
      weights.ownership * percentiles.ownership
      + weights.leverage * percentiles.leverage
      + weights.reach * percentiles.reach
      + weights.initiative * percentiles.initiative
      + weights.problemShaping * percentiles.problemShaping;
    const impactScore = weighted * c.dims.reliability.modifier;

    const topAreas = [...c.raw.areaCounts.entries()]
      .map(([area, weight]) => ({
        area,
        prCount: Math.round(weight * 10) / 10,
        share: weight / (areaTotals.get(area) ?? weight),
      }))
      .filter((a) => a.prCount >= 0.5)
      .sort((a, b) => b.prCount - a.prCount)
      .slice(0, 5);

    const totalMerges = c.raw.agentStewardedMerges + c.raw.humanAuthoredMerges;

    return {
      login: c.raw.login,
      avatarUrl: opts.avatarUrls?.get(c.raw.login) ?? `https://github.com/${c.raw.login}.png?size=80`,
      name: null,
      repo: opts.repo,
      windowDays: opts.windowDays,
      windowStart: opts.windowStart,
      windowEnd: opts.windowEnd,
      activeDays: c.raw.activeDays.size,
      firstSeenAt: new Date(c.raw.firstSeenMs === Number.POSITIVE_INFINITY ? windowStartMs : c.raw.firstSeenMs).toISOString(),
      isNewContributor: newContributors.has(c.raw.login),
      ownership: c.dims.ownership,
      leverage: c.dims.leverage,
      reach: c.dims.reach,
      initiative: c.dims.initiative,
      problemShaping: c.dims.problemShaping,
      reliability: c.dims.reliability,
      agent: {
        agentStewardedMerges: c.raw.agentStewardedMerges,
        humanAuthoredMerges: c.raw.humanAuthoredMerges,
        agentSharePct: totalMerges > 0 ? (c.raw.agentStewardedMerges / totalMerges) * 100 : 0,
        commitsIntoAgentPRs: c.raw.commitsIntoAgentPRs,
      },
      percentiles,
      impactScore,
      archetype: deriveArchetype(percentiles),
      confidence: deriveConfidence(c.raw.authored.length, opts.minPRsForRanking),
      whySentence: buildWhySentence(percentiles, c.dims),
      teams: [...c.raw.teams].slice(0, 5),
      topAreas,
      evidence: selectEvidence(c.raw.login, c.raw.authored),
    };
  });

  engineers.sort((a, b) => b.impactScore - a.impactScore);

  const ttms = contexts
    .map((c) => (c.pr.mergedAt ? hoursBetween(c.pr.createdAt, c.pr.mergedAt) : null))
    .filter((h): h is number => h !== null && h >= 0);

  const medianPercentiles = {} as Record<DimensionKey, number>;
  for (const key of DIMENSION_KEYS) {
    medianPercentiles[key] = median(engineers.map((e) => e.percentiles[key]));
  }

  const agentMergedPRs = contexts.filter((c) => c.isAgentPR).length;

  const cohort: CohortSummary = {
    repo: opts.repo,
    windowDays: opts.windowDays,
    windowStart: opts.windowStart,
    windowEnd: opts.windowEnd,
    computedAt: new Date().toISOString(),
    activeEngineers: engineers.length,
    totalMergedPRs: contexts.length,
    humanMergedPRs: contexts.length - agentMergedPRs,
    agentMergedPRs,
    botsExcluded: bots.excluded(),
    botReviewsExcluded: bots.countBotReviews(inWindow),
    medianTimeToMergeHours: median(ttms),
    medianPercentiles,
  };

  return { cohort, engineers };
}

/** Re-rank client-side under custom weights — no round-trip, no recompute. */
export function rescore(engineers: EngineerMetrics[], weights: Weights): EngineerMetrics[] {
  const total = DIMENSION_KEYS.reduce((s, k) => s + weights[k], 0) || 1;
  return [...engineers]
    .map((e) => {
      const weighted = DIMENSION_KEYS.reduce((s, k) => s + (weights[k] / total) * e.percentiles[k], 0);
      return { ...e, impactScore: weighted * e.reliability.modifier };
    })
    .sort((a, b) => b.impactScore - a.impactScore);
}
