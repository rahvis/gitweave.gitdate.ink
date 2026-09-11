import type { OwnershipSignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';

export interface OwnershipCohort {
  /** area → total human-authored PRs in the window, the denominator for "share" */
  areaTotals: Map<string, number>;
  minPRsForOwnership: number;
  minShareForOwnership: number;
}

/**
 * Ownership Depth — not *how much* code, but **where**, and whether the
 * codebase depends on you for it.
 *
 * `weightedChangeVolume` is already centrality- and blast-radius-weighted
 * (see context.ts), so a 12-line fix to `posthog/hogql/**` outranks 2,000
 * lines of generated boilerplate — which is the entire point.
 */
export function computeOwnership(raw: EngineerRaw, cohort: OwnershipCohort): OwnershipSignals {
  const ownedSurfaces: Array<{ area: string; share: number; prCount: number }> = [];
  for (const [area, weight] of raw.areaCounts) {
    const total = cohort.areaTotals.get(area) ?? 0;
    if (total === 0) continue;
    const share = weight / total;
    if (share >= cohort.minShareForOwnership && weight >= cohort.minPRsForOwnership) {
      ownedSurfaces.push({ area, share, prCount: Math.round(weight * 10) / 10 });
    }
  }
  ownedSurfaces.sort((a, b) => b.share - a.share);

  const raw_ =
    raw.weightedChangeVolume
    + 2 * raw.criticalPRs
    + 8 * ownedSurfaces.length
    + 0.5 * raw.weeks.size;

  return {
    weightedChangeVolume: raw.weightedChangeVolume,
    criticalPathPRs: raw.criticalPRs,
    ownedSurfaces: ownedSurfaces.slice(0, 6),
    sustainedWeeks: raw.weeks.size,
    raw: raw_,
  };
}
