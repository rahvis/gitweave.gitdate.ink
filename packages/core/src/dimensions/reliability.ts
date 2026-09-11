import type { ReliabilitySignals } from '@gitweave/types';
import type { EngineerRaw } from '../accumulator.js';
import { clamp } from '../stats.js';

export interface ReliabilityConfig { min: number; max: number; penaltyFactor: number }

const THIRTY_DAYS_MS = 30 * 86_400_000;

/**
 * Reliability — does what they ship hold up?
 *
 * Deliberately a **penalty-only multiplier**, never a headline, and bounded
 * to (0.85, 1.00]. A clean record earns 1.00 — no penalty — rather than a
 * bonus, for two reasons:
 *
 *   1. It is what "can only temper a rank, never manufacture one" actually
 *      means. A ceiling above 1.0 rewards, and rewarding is not tempering.
 *   2. It keeps the Impact Score genuinely bounded at 0-100. The weighted sum
 *      of percentiles maxes at 100; a 1.10 ceiling pushed the top engineer to
 *      102, which quietly broke the one thing every reader assumes about a
 *      score out of 100.
 *
 * Reverts are weighted 6x a rapid-fix follow-on: a revert is unambiguous,
 * while a same-file fix within 48h is often just healthy iteration.
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
