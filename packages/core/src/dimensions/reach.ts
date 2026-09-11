import type { ReachSignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';
import { effectiveCount, log1p } from '../stats.js';

/**
 * Reach — how far across the codebase and org do they operate?
 *
 * Uses the *effective* number of areas (exp of Shannon entropy), so five
 * areas at 20% each scores 5.0 while 96/1/1/1/1 scores ~1.2. Breadth means
 * genuine spread, not a tail of drive-by commits.
 *
 * Low Reach is NOT a deficiency — paired with high Ownership it identifies a
 * deep specialist. The UI reports that as an archetype and never ranks the
 * archetypes against each other.
 */
/** An area counts as "worked in" once half a PR's worth of files land there. */
const MEANINGFUL_AREA_WEIGHT = 0.5;

export function computeReach(raw: EngineerRaw): ReachSignals {
  const counts = [...raw.areaCounts.values()];
  const totalPresence = counts.reduce((a, b) => a + b, 0);
  const meaningful = counts.filter((w) => w >= MEANINGFUL_AREA_WEIGHT).length;

  /**
   * Entropy is scale-invariant, so a perfectly uniform sweep across 60
   * directories has *maximal* entropy and scores as maximal breadth — the
   * exact artefact we are trying to kill. Total presence (roughly, PRs' worth
   * of work) is the natural ceiling: you cannot be meaningfully engaged in
   * more areas than you did units of work.
   */
  const effAreas = Math.min(effectiveCount(counts), totalPresence);
  const raw_ =
    5 * log1p(effAreas)
    + 3 * log1p(raw.stacks.size)
    + 2 * log1p(raw.teams.size)
    + 1.5 * log1p(raw.boundaryPRs);

  return {
    productAreas: meaningful,
    effectiveAreas: effAreas,
    stacks: raw.stacks.size,
    teams: raw.teams.size,
    boundaryPRs: raw.boundaryPRs,
    raw: raw_,
  };
}
