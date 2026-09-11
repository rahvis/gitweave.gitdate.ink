import type { ReliabilitySignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';
import { clamp } from '../stats.js';

export interface ReliabilityConfig { min: number; max: number; penaltyFactor: number }

const THIRTY_DAYS_MS = 30 * 86_400_000;

/**
 * Reliability — does what they ship hold up?
 *
 * Deliberately a **multiplier**, never a headline. It can temper a high rank
 * but can never manufacture one, and it is floored so it cannot become a
 * blame score. Reverts are weighted 6× a rapid-fix follow-on: a revert is
 * unambiguous, while a same-file fix within 48h is often just healthy
 * iteration.
 */
export function computeReliability(raw: EngineerRaw, cfg: ReliabilityConfig): ReliabilitySignals {
  const mergedPRs = raw.authored.length;

  let reworkedFiles = 0;
  let totalFiles = 0;
  for (const times of raw.fileTouchTimes.values()) {
    totalFiles += 1;
    if (times.length < 2) continue;
    const sorted = [...times].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]! - sorted[i - 1]! <= THIRTY_DAYS_MS) { reworkedFiles += 1; break; }
    }
  }
  const selfReworkRatio = totalFiles > 0 ? reworkedFiles / totalFiles : 0;

  const penaltyRate = mergedPRs > 0
    ? (3 * raw.reverts + 0.5 * raw.rapidFixFollowOns) / mergedPRs
    : 0;
  const modifier = clamp(cfg.max - penaltyRate * cfg.penaltyFactor, cfg.min, cfg.max);

  return {
    mergedPRs,
    reverts: raw.reverts,
    rapidFixFollowOns: raw.rapidFixFollowOns,
    selfReworkRatio,
    penaltyRate,
    modifier,
  };
}
