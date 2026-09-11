import type { InitiativeSignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';
import { log1p } from '../stats.js';

/**
 * Initiative — do they *start* things, or only execute on what exists?
 *
 * `followThrough` is uniform (1.0) when the dataset contains merged PRs only;
 * a constant term does not change percentile ranks, so it is harmless then and
 * becomes meaningful as soon as closed-unmerged PRs are ingested.
 */
export function computeInitiative(raw: EngineerRaw, followThrough = 1): InitiativeSignals {
  const raw_ =
    3 * log1p(raw.filesCreated)
    + 6 * raw.newAreasFounded
    + 2 * log1p(raw.stewardedMerges)
    + 5 * followThrough;

  return {
    filesCreated: raw.filesCreated,
    newAreasFounded: raw.newAreasFounded,
    stewardedMerges: raw.stewardedMerges,
    followThrough,
    raw: raw_,
  };
}
