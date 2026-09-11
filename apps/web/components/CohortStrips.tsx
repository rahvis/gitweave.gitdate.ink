'use client';
import { useMemo } from 'react';
import type { CohortSummary, DimensionKey, EngineerMetrics } from '@gitweave/types';

interface Props {
  engineer: EngineerMetrics;
  peers: EngineerMetrics[];      // the other top-5, drawn as ghosts
  cohort: CohortSummary;
  compact: boolean;
}

const ROW_H = 62;
const PAD_L = 0;
const PAD_R = 0;

function fmt(v: number, unit: string): string {
  if (unit === '%') return `${Math.round(v)}%`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Cohort strips — the centre panel's default view.
 *
 * WHY THIS REPLACED A RADAR. The radar plotted percentile, and percentile is
 * exactly the axis on which the top five are indistinguishable: they all sit
 * between roughly 78 and 100 on every dimension, so every radar rendered as a
 * near-maximal pentagon. It looked analytical and carried no information.
 *
 * These strips plot the RAW COUNTABLE FACT behind each dimension, where the
 * same five engineers span 0-630 threads, 5.6-23.5 effective areas and 0-89%
 * surface ownership. Same people, same data, an axis that actually separates
 * them — and one a leader can verify, because "34 review threads that changed
 * code" is a checkable claim in a way that "94th percentile" is not.
 *
 * Every engineer in the cohort is drawn as a tick, so the reader sees the
 * distribution a percentile was drawn from rather than being asked to trust it.
 * Scales are LINEAR on purpose: these distributions are violently right-skewed,
 * and that skew is the finding. A log axis would flatter the middle and
 * compress precisely the differences that matter at the top.
 */
export function CohortStrips({ engineer, peers, cohort, compact }: Props) {
  const rows = cohort.factDistributions ?? [];
  const bench = cohort.volumeBenchmark;

  const peerByFact = useMemo(() => {
    const m = new Map<DimensionKey, Array<{ login: string; v: number }>>();
    for (const r of rows) {
      m.set(r.key, peers.map((p) => ({ login: p.login, v: p.facts?.[r.key] ?? 0 })));
    }
    return m;
  }, [rows, peers]);

  if (rows.length === 0) {
    return <div className="gw-empty">Cohort distributions are still being computed.</div>;
  }

  return (
    <div className="gw-strips">
      {rows.map((row) => {
        // Axis ceiling is p95, not max. These distributions are violently
        // right-skewed (one row runs median 0 / p90 41 / max 831), and plotting
        // to max would pin 95% of the cohort into the leftmost few pixels.
        // Clipping keeps the bulk legible; the tail is pinned at the edge and
        // labelled with its real value, so nothing is hidden and nothing is
        // distorted the way a log axis would distort it.
        const axisMax = Math.max(row.p95 || row.max, 1);
        const mine = engineer.facts?.[row.key] ?? 0;
        const x = (v: number) => `${Math.min(100, (v / axisMax) * 100)}%`;
        const clipped = (v: number) => v > axisMax;
        const max = row.max;
        const ghosts = peerByFact.get(row.key) ?? [];
        const benchV = bench?.facts?.[row.key];
        const leaderOutside = row.leaderImpactRank > 5 && row.leaderLogin !== engineer.login;
        const ahead = row.values.filter((v) => v < mine).length;
        const pctAhead = row.values.length ? Math.round((ahead / row.values.length) * 100) : 0;

        // Collision avoidance for the two reference labels.
        const pos = (v: number) => Math.min(100, (v / axisMax) * 100);
        const medPos = pos(row.median);
        const p90Pos = pos(row.p90);
        const showMedianLabel = medPos > 14 && medPos < 70;
        const showP90Label = p90Pos > 14 && p90Pos < 74 && Math.abs(p90Pos - medPos) > 16;

        return (
          <div className="gw-strip" key={row.key}>
            <div className="gw-strip__head">
              <span className="gw-strip__label">
                {row.label.charAt(0).toUpperCase() + row.label.slice(1)}
              </span>
              <span className="gw-strip__value">
                <strong>{fmt(mine, row.unit)}</strong>
                <span className="gw-strip__unit">
                  {row.unit === '%' ? '' : ` ${row.unit}`} · ahead of {pctAhead}% of the cohort
                </span>
              </span>
            </div>

            <div className="gw-strip__track" role="img"
              aria-label={`${row.label}: ${fmt(mine, row.unit)}, ahead of ${pctAhead} percent of ${row.values.length} engineers. Cohort median ${fmt(row.median, row.unit)}, 90th percentile ${fmt(row.p90, row.unit)}.`}>
              {/* The whole cohort, so the distribution behind the percentile is visible. */}
              {row.values.map((v, i) => (
                <span key={i} className="gw-strip__tick" style={{ left: x(v) }} aria-hidden />
              ))}

              <span className="gw-strip__rule gw-strip__rule--median" style={{ left: x(row.median) }} aria-hidden />
              <span className="gw-strip__rule gw-strip__rule--p90" style={{ left: x(row.p90) }} aria-hidden />

              {/* The counting champion. If the repo's highest-volume engineer is
                  not in the top five, this single mark refutes the first thing a
                  sceptical leader assumes: that this is a volume metric. */}
              {benchV !== undefined && bench && bench.login !== engineer.login && (
                <span className="gw-strip__bench" style={{ left: x(benchV) }}
                  title={`${bench.login} — most PRs merged (${bench.mergedPRs}), impact rank ${bench.impactRank}`} aria-hidden />
              )}

              {ghosts.map((g) => (
                <span key={g.login} className="gw-strip__ghost" style={{ left: x(g.v) }} title={g.login} aria-hidden />
              ))}

              <span className={`gw-strip__me${clipped(mine) ? ' gw-strip__me--clipped' : ''}`}
                style={{ left: x(mine) }} aria-hidden />
            </div>

            <div className="gw-strip__scale" aria-hidden>
              <span className="gw-strip__scalestart">
                {row.zeroCount > 0 ? `${row.zeroCount} of ${row.values.length} at 0` : '0'}
              </span>
              {/* Reference labels are positioned against their rules, but only
                  when there is room. Anchored labels sit at both ends, and on
                  skewed rows the median can land at 0% and p90 near the
                  ceiling — printing them unconditionally collided them into
                  "med137 at 0" and "p90 13.17.6+". */}
              {showMedianLabel && (
                <span className="gw-strip__scalemid" style={{ left: x(row.median) }}>
                  med {fmt(row.median, row.unit)}
                </span>
              )}
              {showP90Label && (
                <span className="gw-strip__scalemid gw-strip__scalemid--p90" style={{ left: x(row.p90) }}>
                  p90 {fmt(row.p90, row.unit)}
                </span>
              )}
              <span className="gw-strip__scaleend">
                {clipped(max) ? `${fmt(axisMax, row.unit)}+` : fmt(max, row.unit)}
                {leaderOutside && (
                  <em> · top {fmt(row.leaderValue, row.unit)} {row.leaderLogin} (#{row.leaderImpactRank})</em>
                )}
              </span>
            </div>
          </div>
        );
      })}

      <div className="gw-strips__legend">
        <span><i className="gw-lg gw-lg--me" />{engineer.login}</span>
        <span><i className="gw-lg gw-lg--ghost" />other top 5</span>
        {bench && <span><i className="gw-lg gw-lg--bench" />{bench.login} · most PRs ({bench.mergedPRs}), ranks #{bench.impactRank}</span>}
        <span><i className="gw-lg gw-lg--tick" />each of {cohort.activeEngineers} engineers</span>
      </div>
      {!compact && (
        <p className="gw-strips__note">
          Linear scales. These distributions are heavily right-skewed and that skew is the point —
          a log axis would compress exactly the differences that decide the ranking.
        </p>
      )}
    </div>
  );
}
