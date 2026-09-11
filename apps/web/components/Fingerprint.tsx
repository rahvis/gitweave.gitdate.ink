'use client';
import { useMemo } from 'react';
import { DIMENSION_KEYS, DIMENSION_LABELS, type EngineerMetrics, type CohortSummary } from '@gitweave/types';
import { Tag } from '@carbon/react';
import { RadarChart } from './charts/Charts';
import '@carbon/charts/styles.css';

interface Props { engineer: EngineerMetrics; cohort: CohortSummary; theme: 'g100' | 'white' }

/**
 * The Impact Fingerprint.
 *
 * Radar is the right form here and rarely is: five axes that are genuinely
 * commensurable (all percentile ranks, all 0-100, all "more is different"
 * rather than "more is better"). Overlaying the cohort median is what makes
 * the shape readable at a glance — without it a radar is just decoration.
 */
export function Fingerprint({ engineer, cohort, theme }: Props) {
  const data = useMemo(() => {
    const rows: Array<{ group: string; feature: string; value: number }> = [];
    for (const key of DIMENSION_KEYS) {
      rows.push({ group: engineer.login, feature: DIMENSION_LABELS[key], value: Math.round(engineer.percentiles[key]) });
    }
    for (const key of DIMENSION_KEYS) {
      rows.push({ group: 'Cohort median', feature: DIMENSION_LABELS[key], value: Math.round(cohort.medianPercentiles[key] ?? 50) });
    }
    return rows;
  }, [engineer, cohort]);

  const options = useMemo(() => ({
    title: '',
    radar: { axes: { angle: 'feature', value: 'value' } },
    data: { groupMapsTo: 'group' },
    legend: { enabled: true, alignment: 'center' as const },
    color: { scale: { [engineer.login]: '#4589ff', 'Cohort median': '#6f6f6f' } },
    height: '100%',
    width: '100%',
    theme,
    toolbar: { enabled: false },
    // Carbon motion tokens; suppressed automatically under reduced-motion.
    animations: true,
  }), [engineer.login, theme]);

  return (
    <div className="gw-chartwrap">
      <div style={{ flex: 1, minHeight: '15rem' }}>
        <RadarChart data={data} options={options} />
      </div>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.5rem' }}>
        <Tag type="blue" size="sm">{engineer.archetype}</Tag>
        <Tag type={engineer.confidence === 'high' ? 'green' : engineer.confidence === 'medium' ? 'teal' : 'gray'} size="sm">
          {engineer.confidence} confidence · {engineer.reliability.mergedPRs} merged PRs
        </Tag>
        {engineer.isNewContributor && <Tag type="purple" size="sm">new in window</Tag>}
        {engineer.teams.slice(0, 2).map((t) => <Tag key={t} type="outline" size="sm">{`team/${t}`}</Tag>)}
      </div>
      {/* Screen-reader equivalent — a radar chart is unreadable without one. */}
      <table style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        <caption>{`Impact fingerprint for ${engineer.login}, percentile rank within the active cohort`}</caption>
        <thead><tr><th scope="col">Dimension</th><th scope="col">{engineer.login}</th><th scope="col">Cohort median</th></tr></thead>
        <tbody>
          {DIMENSION_KEYS.map((k) => (
            <tr key={k}>
              <th scope="row">{DIMENSION_LABELS[k]}</th>
              <td>{Math.round(engineer.percentiles[k])}</td>
              <td>{Math.round(cohort.medianPercentiles[k] ?? 50)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
