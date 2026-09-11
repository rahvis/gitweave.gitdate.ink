import type {
  Archetype, Confidence, DimensionKey, EvidencePR,
  InitiativeSignals, LeverageSignals, OwnershipSignals,
  ProblemShapingSignals, ReachSignals, ReliabilitySignals,
} from '@gitweave/types';
import type { PRContext } from './context.js';
import { resolveProductArea } from './paths.js';

export interface DimensionBundle {
  ownership: OwnershipSignals;
  leverage: LeverageSignals;
  reach: ReachSignals;
  initiative: InitiativeSignals;
  problemShaping: ProblemShapingSignals;
  reliability: ReliabilitySignals;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function humaniseHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/**
 * Archetypes are labels, never a ranking. A Deep Owner is not worse than a
 * Connector — they are different shapes of valuable, and conflating them is
 * exactly how good specialists get managed out.
 */
export function deriveArchetype(p: Record<DimensionKey, number>): Archetype {
  const entries = Object.entries(p) as Array<[DimensionKey, number]>;
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (top[0] === 'leverage' && p.leverage >= 70) return 'Multiplier';
  if (p.ownership >= 70 && p.reach < 50) return 'Deep Owner';
  if (p.reach >= 70 && p.ownership >= 35) return 'Connector';
  if (top[0] === 'initiative' && p.initiative >= 65) return 'Builder';
  if (p.ownership >= 70) return 'Deep Owner';
  return 'Generalist';
}

export function deriveConfidence(mergedPRs: number, minPRs: number): Confidence {
  if (mergedPRs >= Math.max(20, minPRs * 4)) return 'high';
  if (mergedPRs >= minPRs) return 'medium';
  return 'low';
}

/** One clause per dimension, always populated with the real numbers. */
function clauseFor(key: DimensionKey, d: DimensionBundle): string | null {
  switch (key) {
    case 'ownership': {
      const top = d.ownership.ownedSurfaces[0];
      if (top) return `owns ${pct(top.share)} of \`${top.area}\``;
      if (d.ownership.criticalPathPRs > 0) {
        return `${d.ownership.criticalPathPRs} changes to blast-radius paths over ${d.ownership.sustainedWeeks} weeks`;
      }
      return `sustained delivery across ${d.ownership.sustainedWeeks} weeks`;
    }
    case 'leverage': {
      const parts: string[] = [];
      if (d.leverage.consequentialThreads > 0) {
        parts.push(`${d.leverage.consequentialThreads} review thread${d.leverage.consequentialThreads === 1 ? '' : 's'} that changed code`);
      }
      if (d.leverage.distinctAuthorsReviewed >= 3) {
        parts.push(`unblocking ${d.leverage.distinctAuthorsReviewed} engineers`);
      }
      if (d.leverage.medianUnblockHours !== null) {
        parts.push(`${humaniseHours(d.leverage.medianUnblockHours)} median review latency`);
      }
      return parts.length ? parts.slice(0, 2).join(', ') : null;
    }
    case 'reach': {
      if (d.reach.productAreas < 2) return null;
      return `spans ${d.reach.productAreas} product areas and ${d.reach.stacks} stacks`;
    }
    case 'initiative': {
      if (d.initiative.newAreasFounded > 0) {
        return `founded ${d.initiative.newAreasFounded} new product surface${d.initiative.newAreasFounded > 1 ? 's' : ''}`;
      }
      if (d.initiative.filesCreated > 0) return `created ${d.initiative.filesCreated} new files`;
      if (d.initiative.stewardedMerges > 0) return `shepherded ${d.initiative.stewardedMerges} others' PRs to merge`;
      return null;
    }
    case 'problemShaping': {
      if (d.problemShaping.problemStatementRate < 0.2) return null;
      return `states the problem on ${pct(d.problemShaping.problemStatementRate)} of PRs`;
    }
    default:
      return null;
  }
}

/**
 * Deterministic templates, not an LLM: reproducible, auditable, zero-latency,
 * and nothing leaves the deployment. LLM narrative is opt-in behind a flag.
 */
export function buildWhySentence(
  percentiles: Record<DimensionKey, number>,
  d: DimensionBundle,
): string {
  const ranked = (Object.entries(percentiles) as Array<[DimensionKey, number]>)
    .sort((a, b) => b[1] - a[1]);

  const clauses: string[] = [];
  for (const [key] of ranked) {
    const c = clauseFor(key, d);
    if (c) clauses.push(c);
    if (clauses.length === 2) break;
  }

  if (d.reliability.mergedPRs >= 10 && d.reliability.reverts === 0 && clauses.length < 2) {
    clauses.push(`0 reverts across ${d.reliability.mergedPRs} merges`);
  }
  if (clauses.length === 0) return `${d.reliability.mergedPRs} merged PRs in window.`;

  const joined = clauses.join('; ');
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

/**
 * Evidence selection — the antidote to "Score: 207 with no context".
 * Ranks the engineer's PRs by the same weighting the score uses, then
 * annotates *why* each one mattered.
 */
export function selectEvidence(login: string, contexts: PRContext[], limit = 6): EvidencePR[] {
  const scored = contexts.map((ctx) => {
    const ownCommits = ctx.ownCommitCount.get(login) ?? 0;
    const threadsReceived = ctx.consequentialThreads.length;
    const weight =
      ctx.prWeight
      + (ctx.touchesCritical ? 6 : 0)
      + 1.5 * threadsReceived
      + 2 * ctx.filesCreatedHere
      + 4 * ctx.problemQuality;

    const reasons: string[] = [];
    if (ctx.touchesCritical) reasons.push('Touches a blast-radius path (CODEOWNERS / migrations / infra)');
    if (threadsReceived > 0) reasons.push(`${threadsReceived} review thread${threadsReceived > 1 ? 's' : ''} resolved with a code change`);
    if (ctx.filesCreatedHere > 0) reasons.push(`Created ${ctx.filesCreatedHere} new file${ctx.filesCreatedHere > 1 ? 's' : ''}`);
    if (ctx.isAgentPR) {
      reasons.push(`Agent-opened — ${ownCommits} commit${ownCommits === 1 ? '' : 's'} by them${ctx.steward === login ? ', merged by them' : ''}`);
    }
    if (ctx.hasProblemStatement && ctx.problemQuality >= 0.5) reasons.push('Well-articulated problem statement');
    if (reasons.length === 0) reasons.push(`${ctx.pr.changedFiles} files across ${ctx.productAreas.length} area${ctx.productAreas.length === 1 ? '' : 's'}`);

    const evidence: EvidencePR = {
      number: ctx.pr.number,
      title: ctx.pr.title,
      url: ctx.pr.url,
      mergedAt: ctx.pr.mergedAt,
      additions: ctx.pr.additions,
      deletions: ctx.pr.deletions,
      changedFiles: ctx.pr.changedFiles,
      productAreas: [...new Set(ctx.pr.files.map((f) => resolveProductArea(f.path)))].slice(0, 3),
      weight,
      reasons,
      agentOpened: ctx.isAgentPR,
      ownCommits,
      consequentialThreadsReceived: threadsReceived,
      touchesCriticalPath: ctx.touchesCritical,
    };
    return evidence;
  });

  return scored.sort((a, b) => b.weight - a.weight).slice(0, limit);
}
