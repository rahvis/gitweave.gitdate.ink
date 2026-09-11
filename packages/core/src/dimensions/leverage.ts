import type { LeverageSignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';
import { clamp, log1p, median } from '../stats.js';

const MIN_LATENCY_SAMPLES = 3;

/**
 * Leverage — do they make *other people* faster and better?
 *
 * The dimension every other tool gets most wrong, for two measurable reasons
 * on this repo:
 *   1. Raw review counts hand the top 5 slots to bots.
 *   2. Approvals are a formality (380 COMMENTED : 118 APPROVED : 4
 *      CHANGES_REQUESTED). Approvals therefore score zero here.
 *
 * Responsiveness is applied as a *multiplier* rather than an additive bonus,
 * so it cannot create leverage out of nothing — it can only amplify or damp
 * review work that actually happened. Engineers with too few request→review
 * samples get a neutral 1.0 instead of a penalty.
 */
export function computeLeverage(raw: EngineerRaw): LeverageSignals {
  const medianUnblockHours = raw.unblockHours.length >= MIN_LATENCY_SAMPLES
    ? median(raw.unblockHours)
    : null;

  const reviewCore =
    1.0 * raw.consequentialThreads
    + 1.5 * raw.reviewedAuthors.size
    + 2.0 * raw.reviewedAreas.size
    + 1.5 * raw.mentorshipThreads
    + 0.75 * raw.solicitedRequests;

  // ~1.35× for a 30-minute median response, 1.0× at a day, floored at 0.8×.
  const responsiveness = medianUnblockHours === null
    ? 1.0
    : clamp(1.4 - 0.12 * log1p(medianUnblockHours), 0.8, 1.4);

  return {
    consequentialThreads: raw.consequentialThreads,
    distinctAuthorsReviewed: raw.reviewedAuthors.size,
    distinctAreasReviewed: raw.reviewedAreas.size,
    mentorshipReviews: raw.mentorshipThreads,
    solicitedRequests: raw.solicitedRequests,
    medianUnblockHours,
    rubberStampApprovals: raw.rubberStampsGiven,
    raw: reviewCore * responsiveness,
  };
}
