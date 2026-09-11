'use client';
import { DIMENSION_LABELS, type EngineerMetrics, type Weights } from '@gitweave/types';
import { Tag } from '@carbon/react';
import { Explain } from './Explain';
import { contributions } from '../lib/score';
import { DIMENSION_COLORS, hours, pct } from '../lib/format';

interface Props { engineer: EngineerMetrics; weights: Weights }

/**
 * "How this score is built."
 *
 * This panel exists to retire one specific failure mode: showing a leader
 * `Score: 207` with no way to interrogate it. Every row states the points it
 * contributed, the percentile behind those points, the weight applied, AND
 * the raw facts underneath — so the number is always falsifiable.
 */
export function Decomposition({ engineer, weights }: Props) {
  const rows = contributions(engineer, weights);
  const max = Math.max(...rows.map((r) => r.points), 1);

  const facts: Record<string, string[]> = {
    ownership: [
      ...engineer.ownership.ownedSurfaces.slice(0, 2).map((s) => `${pct(s.share)} of ${s.area} (${s.prCount} PRs)`),
      `${engineer.ownership.criticalPathPRs} PRs on blast-radius paths`,
      `${engineer.ownership.sustainedWeeks} active week${engineer.ownership.sustainedWeeks === 1 ? '' : 's'}`,
    ],
    leverage: [
      `${engineer.leverage.consequentialThreads} review threads that changed code`,
      `${engineer.leverage.distinctAuthorsReviewed} engineers unblocked, ${engineer.leverage.distinctAreasReviewed} areas`,
      `${hours(engineer.leverage.medianUnblockHours)} median response to review requests`,
      ...(engineer.leverage.mentorshipReviews > 0 ? [`${engineer.leverage.mentorshipReviews} reviews for new contributors`] : []),
    ],
    reach: [
      `${engineer.reach.productAreas} areas (${engineer.reach.effectiveAreas.toFixed(1)} effective)`,
      `${engineer.reach.stacks} stacks, ${engineer.reach.teams} teams`,
      `${engineer.reach.boundaryPRs} cross-boundary PR${engineer.reach.boundaryPRs === 1 ? '' : 's'}`,
    ],
    initiative: [
      `${engineer.initiative.filesCreated} new file${engineer.initiative.filesCreated === 1 ? '' : 's'} created`,
      ...(engineer.initiative.newAreasFounded > 0 ? [`${engineer.initiative.newAreasFounded} surface${engineer.initiative.newAreasFounded === 1 ? '' : 's'} founded`] : []),
      `${engineer.initiative.stewardedMerges} of others' PRs merged by them`,
    ],
    problemShaping: [
      `${pct(engineer.problemShaping.problemStatementRate)} of PRs state the problem`,
      `${pct(engineer.problemShaping.avgProblemQuality)} mean problem-statement quality`,
      `${engineer.problemShaping.discussionOnOthers} substantive comment${engineer.problemShaping.discussionOnOthers === 1 ? '' : 's'} on others' work`,
    ],
  };

  const formula = {
    ownership: 'centrality x blast-radius weighted change, owned surfaces, sustained weeks',
    leverage: 'consequential review threads, breadth of people/areas unblocked, x responsiveness',
    reach: 'effective product areas (exp of entropy), stacks, teams, boundary PRs',
    initiative: 'files created, surfaces founded, others\' PRs shepherded to merge',
    problemShaping: 'smoothed rate x quality of problem statements, discussion on others\' work',
  };

  return (
    <div className="gw-decomp">
      {rows.map((r) => (
        <div className="gw-decomp__row" key={r.key}>
          <div className="gw-decomp__head">
            <Explain
              label={<span className="gw-decomp__label">{DIMENSION_LABELS[r.key]}</span>}
              detail={`${formula[r.key]}. Percentile ${Math.round(r.percentile)} of 100 within the active cohort, x weight ${r.weight.toFixed(2)} = ${r.points.toFixed(1)} points.`}
            />
            <span className="gw-decomp__points">{r.points.toFixed(1)}</span>
          </div>
          <div className="gw-bar">
            <div
              className="gw-bar__fill"
              style={{ width: `${(r.points / max) * 100}%`, background: DIMENSION_COLORS[r.key] }}
            />
          </div>
          <div className="gw-decomp__facts">
            {facts[r.key]?.map((f) => <span className="gw-decomp__fact" key={f}>{f}</span>)}
          </div>
        </div>
      ))}

      <div style={{ borderTop: 'var(--gw-rail)', paddingTop: '.75rem' }}>
        <div className="gw-kv">
          <Explain
            label={<span>Reliability</span>}
            detail="A multiplier, never a headline. It can temper a high rank but cannot manufacture one, and it is floored at 0.85 so it never becomes a blame score."
          />
          <strong>
            &times;{engineer.reliability.modifier.toFixed(2)}{' '}
            {engineer.reliability.reverts === 0
              ? <Tag type="green" size="sm">0 reverts</Tag>
              : <Tag type="red" size="sm">{engineer.reliability.reverts} reverts</Tag>}
          </strong>
        </div>
        <div className="gw-note" style={{ marginTop: '.25rem' }}>
          {engineer.reliability.reverts} reverts, {engineer.reliability.rapidFixFollowOns} rapid-fix follow-ons
          across {engineer.reliability.mergedPRs} merges.
        </div>
      </div>
    </div>
  );
}
