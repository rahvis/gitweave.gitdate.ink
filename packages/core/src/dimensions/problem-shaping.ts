import type { ProblemShapingSignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';
import { log1p } from '../stats.js';

/**
 * Problem Shaping — the non-code half of engineering.
 *
 * The problem-statement term is **rate-based, not volume-based**: it measures
 * a habit, so shipping more PRs neither helps nor hurts. The rate is
 * Laplace-smoothed toward the prior so someone with two PRs cannot land a
 * perfect 1.0 on a sample of two.
 */
export function computeProblemShaping(raw: EngineerRaw): ProblemShapingSignals {
  const authoredCount = raw.authored.length;
  const smoothedRate = (raw.problemPRs + 1) / (authoredCount + 3);
  const avgQuality = raw.problemPRs > 0 ? raw.problemQualitySum / raw.problemPRs : 0;

  const raw_ = 10 * smoothedRate * avgQuality + 2.5 * log1p(raw.discussionOnOthers);

  return {
    problemStatementRate: authoredCount > 0 ? raw.problemPRs / authoredCount : 0,
    avgProblemQuality: avgQuality,
    discussionOnOthers: raw.discussionOnOthers,
    raw: raw_,
  };
}
