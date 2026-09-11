'use client';
import type { CohortSummary, EngineerMetrics } from '@gitweave/types';

interface Props {
  engineers: EngineerMetrics[];
  selected: EngineerMetrics | undefined;
  cohort: CohortSummary;
  onSelect: (login: string) => void;
}

function fmt(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : (Number.isInteger(v) ? String(v) : v.toFixed(1));
}

/**
 * The strongest countable fact this engineer holds, with their rank on it.
 *
 * The panel flagged one real hazard in a pure rank-stability view: it runs on
 * the same percentiles that were compressed, so it could laminate a
 * measurement artefact into a certificate of robustness. Printing a checkable
 * number beside every band means the view is never numbers-only — the reader
 * can always cross to something countable.
 */
function leadingFact(e: EngineerMetrics, cohort: CohortSummary) {
  const dists = cohort.factDistributions ?? [];
  let best: { label: string; value: number; rank: number; unit: string } | null = null;
  for (const d of dists) {
    const v = e.facts?.[d.key] ?? 0;
    if (v <= 0) continue;
    const rank = d.values.filter((x) => x > v).length + 1;
    if (!best || rank < best.rank) best = { label: d.label, value: v, rank, unit: d.unit };
  }
  return best;
}

const SHOW = 8;

/**
 * The Cut Line — how much the answer depends on how you define impact.
 *
 * Every impact score embeds an opinion in its weights. The usual move is to
 * hide that behind a confident number. GitWeave's answer is to measure it:
 * the cohort is re-ranked under 2,000 randomly drawn weightings of the five
 * dimensions, and each engineer gets the rank band they occupy across all of
 * them plus how often they land in the top five.
 *
 * That converts "trust my weights" into a falsifiable claim. A name holding
 * rank 1-2 under every reasonable definition of impact is a finding a leader
 * can act on. A name swinging 4-12 is a coin flip they should know is a coin
 * flip *before* they cite it in a calibration meeting.
 *
 * Sampling is uniform over the weight simplex and seeded, so the bands are
 * identical on every recomputation and can be audited.
 */
export function CutLine({ engineers, selected, cohort, onSelect }: Props) {
  const rows = engineers.slice(0, SHOW);
  if (rows.length === 0) return <div className="gw-empty">No cohort to simulate.</div>;

  const maxRank = Math.max(...rows.map((e) => e.stability?.bandHigh ?? 1), 6);
  const scale = (r: number) => ((r - 1) / Math.max(1, maxRank - 1)) * 100;
  const locked = rows.filter((e) => (e.stability?.topFiveProbability ?? 0) >= 0.9).length;
  const mostRobust = rows.reduce((a, b) =>
    (b.stability?.topFiveProbability ?? 0) > (a.stability?.topFiveProbability ?? 0) ? b : a);
  const contested = rows.filter((e) => {
    const p = e.stability?.topFiveProbability ?? 0;
    return p > 0.1 && p < 0.9;
  });

  return (
    <div className="gw-cut">
      <p className="gw-cut__verdict">
        Re-ranked under <strong>{(cohort.stabilityDraws ?? 2000).toLocaleString()}</strong> random
        weightings of the five dimensions,{' '}
        {locked > 0 ? (
          <>
            <strong>{locked}</strong> of these names hold a top-five seat almost every time
            {contested.length > 0 && (
              <> and <strong>{contested.length}</strong>{' '}
                {contested.length === 1 ? 'seat is' : 'seats are'} a genuine judgment call</>
            )}
            .
          </>
        ) : (
          <>
            no seat is locked — the most robust is{' '}
            <strong>{mostRobust.login}</strong> at{' '}
            <strong>{Math.round((mostRobust.stability?.topFiveProbability ?? 0) * 100)}%</strong>.
            This ranking is a judgment call, and the weights are yours to set.
          </>
        )}
      </p>

      <div className="gw-cut__rows">
        {rows.map((e, i) => {
          const s = e.stability ?? { bandLow: i + 1, bandHigh: i + 1, medianRank: i + 1, topFiveProbability: 0 };
          const isSel = selected?.login === e.login;
          const p = Math.round(s.topFiveProbability * 100);
          const fact = leadingFact(e, cohort);
          const left = scale(s.bandLow);
          const width = Math.max(1.5, scale(s.bandHigh) - scale(s.bandLow));
          return (
            <button
              type="button"
              key={e.login}
              className={`gw-cut__row${isSel ? ' gw-cut__row--sel' : ''}`}
              onClick={() => onSelect(e.login)}
              aria-pressed={isSel}
              aria-label={`${e.login}: median rank ${s.medianRank}, ranges ${s.bandLow} to ${s.bandHigh} across weightings, in the top five ${p}% of the time`}
            >
              <span className="gw-cut__id">
                <span className="gw-cut__rank">{i + 1}</span>
                <span className="gw-cut__name">{e.login}</span>
              </span>
              <span className="gw-cut__track">
                <span className="gw-cut__band" style={{ left: `${left}%`, width: `${width}%` }} />
                <span className="gw-cut__median" style={{ left: `${scale(s.medianRank)}%` }} />
              </span>
              <span className={`gw-cut__prob${p >= 90 ? ' gw-cut__prob--locked' : p >= 40 ? ' gw-cut__prob--mid' : ' gw-cut__prob--low'}`}>
                {p}%
              </span>
              {fact && (
                <span className="gw-cut__fact">
                  <strong>{fmt(fact.value)}</strong> {fact.label}
                  <em> · #{fact.rank} in repo</em>
                </span>
              )}
            </button>
          );
        })}
        {/* The cut itself: everything left of this line is inside the top five. */}
        {/* The cut itself. Track column = 100% minus the id (9rem) and
            probability (3rem) columns and their two 0.5rem gaps. */}
        <span
          className="gw-cut__line"
          style={{ left: `calc(9.5rem + (100% - 13rem) * ${scale(5.5) / 100})` }}
          aria-hidden
        >
          <span className="gw-cut__linelabel">top 5</span>
        </span>
      </div>

      <div className="gw-cut__axis" aria-hidden>
        <span>rank 1</span>
        <span>rank {maxRank}</span>
      </div>
      <p className="gw-strips__note">
        Bars span the 5th–95th percentile of each engineer&apos;s rank across the draws; the notch is
        their median rank. Weightings are drawn uniformly over the simplex from a fixed seed, so
        these bands are reproducible.
      </p>
    </div>
  );
}
