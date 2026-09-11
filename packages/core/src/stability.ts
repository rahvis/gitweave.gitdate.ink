import type { DimensionKey, EngineerMetrics } from '@gitweave/types';
import { DIMENSION_KEYS } from '@gitweave/types';

/**
 * Rank stability under re-weighting.
 *
 * The honest problem with any impact score is that its weights are an opinion.
 * GitWeave's answer is not to hide that — it is to measure how much the answer
 * actually depends on it. We re-rank the whole cohort under many randomly
 * drawn weightings of the five dimensions and report, per engineer, how often
 * they land in the top five and how wide their rank swings.
 *
 * That turns "trust my weights" into a falsifiable claim: a name that holds
 * rank 1-2 across every reasonable definition of impact is a finding; a name
 * that swings 4-12 is a coin flip the leader should know about.
 *
 * Deterministic by construction — a seeded generator, not Math.random — so the
 * same dataset always yields the same bands and the result is auditable.
 */

/** mulberry32: tiny, fast, well-distributed, and fully reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniform sample from the 5-simplex via normalised Exp(1) draws.
 * Sampling 5 uniforms and normalising would bias toward the centre; this does
 * not, so "every reasonable weighting" really means every weighting.
 */
function dirichletWeights(rnd: () => number): number[] {
  const w = new Array<number>(DIMENSION_KEYS.length);
  let sum = 0;
  for (let i = 0; i < w.length; i += 1) {
    const e = -Math.log(1 - rnd());
    w[i] = e;
    sum += e;
  }
  for (let i = 0; i < w.length; i += 1) w[i]! /= sum;
  return w;
}

export interface RankStability {
  /** Share of sampled weightings that place this engineer in the top 5 (0-1). */
  topFiveProbability: number;
  /** 5th and 95th percentile of their rank across the draws. */
  bandLow: number;
  bandHigh: number;
  medianRank: number;
}

export const STABILITY_DRAWS = 2000;
const TOP_N = 5;
const SEED = 0x6757_7a3e; // fixed: reproducibility is the point

export function computeRankStability(
  engineers: EngineerMetrics[],
  draws = STABILITY_DRAWS,
): Map<string, RankStability> {
  const n = engineers.length;
  const out = new Map<string, RankStability>();
  if (n === 0) return out;

  // Flatten to typed arrays once — this loop runs draws x n times.
  const pct = DIMENSION_KEYS.map((k) => Float64Array.from(engineers.map((e) => e.percentiles[k])));
  const reliability = Float64Array.from(engineers.map((e) => e.reliability.modifier));

  const ranksPerEngineer: number[][] = Array.from({ length: n }, () => []);
  const topFiveHits = new Int32Array(n);
  const rnd = seeded(SEED);
  const scores = new Float64Array(n);
  const order = new Int32Array(n);

  for (let d = 0; d < draws; d += 1) {
    const w = dirichletWeights(rnd);
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let k = 0; k < DIMENSION_KEYS.length; k += 1) s += w[k]! * pct[k]![i]!;
      scores[i] = s * reliability[i]!;
      order[i] = i;
    }
    // Descending sort of indices by score.
    const idx = Array.from(order).sort((a, b) => scores[b]! - scores[a]!);
    for (let r = 0; r < n; r += 1) {
      const i = idx[r]!;
      ranksPerEngineer[i]!.push(r + 1);
      if (r < TOP_N) topFiveHits[i]! += 1;
    }
  }

  for (let i = 0; i < n; i += 1) {
    const ranks = ranksPerEngineer[i]!.sort((a, b) => a - b);
    const at = (q: number) => ranks[Math.min(ranks.length - 1, Math.max(0, Math.floor(q * (ranks.length - 1))))]!;
    out.set(engineers[i]!.login, {
      topFiveProbability: topFiveHits[i]! / draws,
      bandLow: at(0.05),
      bandHigh: at(0.95),
      medianRank: at(0.5),
    });
  }
  return out;
}

/** Cohort-level facts the centre panel needs, kept small enough to ship. */
export interface FactDistribution {
  key: DimensionKey;
  label: string;
  unit: string;
  /** Every active engineer's raw value, ascending. ~227 floats per row. */
  values: number[];
  median: number;
  p90: number;
  /** Axis ceiling. Plotting to `max` lets one outlier squash everyone else;
   *  clipping at p95 and pinning the tail keeps the bulk readable without the
   *  distortion a log axis introduces. */
  p95: number;
  max: number;
  /** How many engineers sit at exactly zero — drawn as a count, not a blob. */
  zeroCount: number;
  leaderLogin: string;
  leaderValue: number;
  /** Impact rank of the leader — reveals when the field leader is NOT in the top 5. */
  leaderImpactRank: number;
}

/**
 * The countable fact plotted for each dimension.
 *
 * Chosen against the live cohort, and three obvious candidates were rejected
 * on measurement rather than taste:
 *
 *  - `problemShaping.problemStatementRate` — median = p90 = max = 100%.
 *    PostHog's PR template means essentially every PR has a Problem section,
 *    so the rate carries no information and would render as one flat column.
 *  - `initiative.followThrough` — exactly 1.00 for every engineer, because we
 *    ingest merged PRs only. Harmless in the score (a constant cannot change
 *    a percentile rank) but useless as an axis.
 *  - `initiative.filesCreated` — its cohort max is held by the same engineer
 *    who holds max `mergedPRs` AND max `criticalPathPRs`. It is the field in
 *    this dataset closest to raw output volume, which is the thing this
 *    product exists not to reward.
 *
 * What remains is countable, legible, and genuinely spread.
 */
export const FACT_SPEC: Array<{ key: DimensionKey; label: string; unit: string; get: (e: EngineerMetrics) => number }> = [
  { key: 'leverage', label: 'review threads that changed code', unit: 'threads', get: (e) => e.leverage.consequentialThreads },
  { key: 'ownership', label: 'PRs touching blast-radius paths', unit: 'PRs', get: (e) => e.ownership.criticalPathPRs },
  { key: 'reach', label: 'effective product areas', unit: 'areas', get: (e) => e.reach.effectiveAreas },
  { key: 'initiative', label: "of others' PRs shepherded to merge", unit: 'PRs', get: (e) => e.initiative.stewardedMerges },
  { key: 'problemShaping', label: "substantive comments on others' work", unit: 'comments', get: (e) => e.problemShaping.discussionOnOthers },
];

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function computeFactDistributions(engineers: EngineerMetrics[]): FactDistribution[] {
  const rankByLogin = new Map(engineers.map((e, i) => [e.login, i + 1]));
  return FACT_SPEC.map(({ key, label, unit, get }) => {
    const pairs = engineers.map((e) => ({ login: e.login, v: get(e) }));
    const values = pairs.map((p) => p.v).sort((a, b) => a - b);
    const leader = pairs.reduce((a, b) => (b.v > a.v ? b : a), pairs[0] ?? { login: '', v: 0 });
    return {
      key, label, unit, values,
      median: quantileSorted(values, 0.5),
      p90: quantileSorted(values, 0.9),
      p95: quantileSorted(values, 0.95),
      zeroCount: values.filter((v) => v <= 0).length,
      max: values[values.length - 1] ?? 0,
      leaderLogin: leader.login,
      leaderValue: leader.v,
      leaderImpactRank: rankByLogin.get(leader.login) ?? 0,
    };
  });
}

/**
 * The counting champion: whoever merged the most PRs.
 *
 * Plotted as a labelled counter-example. If the highest-volume engineer in the
 * repo is not in the top five, that single mark proves the ranking is not a
 * volume metric — which is the first thing a sceptical leader assumes it is.
 */
export function computeVolumeBenchmark(engineers: EngineerMetrics[]) {
  if (engineers.length === 0) return null;
  let best = engineers[0]!;
  let bestRank = 1;
  engineers.forEach((e, i) => {
    if (e.reliability.mergedPRs > best.reliability.mergedPRs) { best = e; bestRank = i + 1; }
  });
  return {
    login: best.login,
    mergedPRs: best.reliability.mergedPRs,
    impactRank: bestRank,
    facts: Object.fromEntries(FACT_SPEC.map((f) => [f.key, f.get(best)])) as Record<DimensionKey, number>,
  };
}
