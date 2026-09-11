'use client';
import type { EngineerMetrics } from '@gitweave/types';
import { Tag } from '@carbon/react';
import { ArrowUpRight } from '@carbon/icons-react';
import { compactDate } from '../lib/format';

/**
 * The evidence rail is the product's answer to "can we validate the findings?"
 * Every ranked engineer's highest-weighted contributions, annotated with why
 * each one counted, one click from the real PR on github.com.
 */
export function EvidenceRail({ engineer }: { engineer: EngineerMetrics }) {
  if (engineer.evidence.length === 0) {
    return <div className="gw-empty">No authored PRs in this window — this engineer's score comes from review and collaboration.</div>;
  }
  return (
    <div>
      {engineer.evidence.map((ev) => (
        <a className="gw-ev" key={ev.number} href={ev.url} target="_blank" rel="noreferrer">
          <span className="gw-ev__num">#{ev.number}</span>
          <span style={{ minWidth: 0 }}>
            <span className="gw-ev__title">{ev.title}</span>
            <span className="gw-ev__reasons" style={{ display: 'block' }}>
              {ev.reasons.join(' · ')}
            </span>
            <span style={{ display: 'flex', gap: '.25rem', marginTop: '.25rem', flexWrap: 'wrap' }}>
              {ev.touchesCriticalPath && <Tag type="red" size="sm">blast radius</Tag>}
              {ev.agentOpened && <Tag type="purple" size="sm">agent-opened</Tag>}
              {ev.productAreas.slice(0, 2).map((a) => <Tag key={a} type="outline" size="sm">{a}</Tag>)}
            </span>
          </span>
          <span className="gw-ev__stats">
            <span className="gw-add">+{ev.additions.toLocaleString()}</span>{' '}
            <span className="gw-del">-{ev.deletions.toLocaleString()}</span>{' '}
            · {ev.changedFiles}f · {compactDate(ev.mergedAt)} <ArrowUpRight size={12} />
          </span>
        </a>
      ))}
    </div>
  );
}
