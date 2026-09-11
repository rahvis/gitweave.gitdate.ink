'use client';
import { DIMENSION_KEYS, type DimensionKey, type EngineerMetrics, type Weights } from '@gitweave/types';

/**
 * Client-side re-ranking.
 *
 * Percentiles are pre-computed server-side, so applying new weights is a
 * multiply-and-sort over a few dozen rows — sub-millisecond, no round trip.
 * That is what makes the weight sliders feel like an instrument rather than
 * a form submission.
 */
export function rescoreLocal(engineers: EngineerMetrics[], weights: Weights): EngineerMetrics[] {
  const total = DIMENSION_KEYS.reduce((s, k) => s + weights[k], 0) || 1;
  return [...engineers]
    .map((e) => {
      const weighted = DIMENSION_KEYS.reduce((s, k) => s + (weights[k] / total) * e.percentiles[k], 0);
      return { ...e, impactScore: weighted * e.reliability.modifier };
    })
    .sort((a, b) => b.impactScore - a.impactScore);
}

/** Points each dimension actually contributed — the decomposition panel. */
export function contributions(
  e: EngineerMetrics, weights: Weights,
): Array<{ key: DimensionKey; points: number; percentile: number; weight: number }> {
  const total = DIMENSION_KEYS.reduce((s, k) => s + weights[k], 0) || 1;
  return DIMENSION_KEYS.map((key) => ({
    key,
    weight: weights[key] / total,
    percentile: e.percentiles[key],
    points: (weights[key] / total) * e.percentiles[key] * e.reliability.modifier,
  }));
}
