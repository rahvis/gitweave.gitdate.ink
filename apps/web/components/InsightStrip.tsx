'use client';
import type { CohortSummary, EngineerMetrics } from '@gitweave/types';

/**
 * The "so what" line.
 *
 * Consulting discipline: an exhibit's title states the FINDING, not the chart
 * type. This is the dashboard's finding, computed rather than written — the
 * share of the repo's consequential review that the top five actually carry,
 * against their share of headcount. It is the sentence a leader repeats in a
 * meeting, and it is falsifiable from the strips directly below it.
 */
export function InsightStrip({ top, cohort }: { top: EngineerMetrics[]; cohort: CohortSummary }) {
  const leverage = cohort.factDistributions?.find((f) => f.key === 'leverage');
  if (!leverage || top.length === 0) return null;

  const total = leverage.values.reduce((a, b) => a + b, 0);
  const theirs = top.reduce((a, e) => a + (e.facts?.leverage ?? 0), 0);
  if (total <= 0) return null;

  const shareOfReview = Math.round((theirs / total) * 100);
  const shareOfPeople = Math.round((top.length / Math.max(1, cohort.activeEngineers)) * 1000) / 10;
  const locked = top.filter((e) => (e.stability?.topFiveProbability ?? 0) >= 0.9).length;

  return (
    <div className="gw-insight">
      <span className="gw-insight__eyebrow">The finding</span>
      <p className="gw-insight__text">
        These <strong>{top.length}</strong> engineers are{' '}
        <strong>{shareOfPeople}%</strong> of the {cohort.activeEngineers} active contributors, and
        resolved <strong>{shareOfReview}%</strong> of every review thread in the repo that changed
        code.{' '}
        {locked > 0 && (
          <>
            <strong>{locked}</strong> of them hold the top five under every weighting we tested.
          </>
        )}
      </p>
    </div>
  );
}
