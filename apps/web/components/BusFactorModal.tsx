'use client';
import { useMemo } from 'react';
import { Modal, Tag, StructuredListWrapper, StructuredListHead, StructuredListRow, StructuredListCell, StructuredListBody } from '@carbon/react';
import type { EngineerMetrics } from '@gitweave/types';
import { TreemapChart } from './charts/Charts';
import { pct } from '../lib/format';

interface OwnerNode { area: string; prCount: number; topOwner: string; topOwnerShare: number; distinctOwners: number; risk: 'high' | 'medium' | 'low' }

/**
 * Bus-factor / key-person risk.
 *
 * Kept off the main page deliberately — the single-screen answer is "who is
 * impactful", and this is a different question. But it is the use case that
 * most often changes a decision: fund a second owner *before* the
 * resignation, not after it.
 */
export function BusFactorModal({
  open, onClose, engineers, theme,
}: { open: boolean; onClose: () => void; engineers: EngineerMetrics[]; theme: 'g100' | 'white' }) {
  const nodes = useMemo<OwnerNode[]>(() => {
    const byArea = new Map<string, Map<string, number>>();
    for (const e of engineers) {
      for (const a of e.topAreas) {
        let owners = byArea.get(a.area);
        if (!owners) { owners = new Map(); byArea.set(a.area, owners); }
        owners.set(e.login, (owners.get(e.login) ?? 0) + a.prCount);
      }
    }
    const out: OwnerNode[] = [];
    for (const [area, owners] of byArea) {
      const total = [...owners.values()].reduce((x, y) => x + y, 0);
      if (total < 3) continue;
      const [topOwner, topCount] = [...owners.entries()].sort((x, y) => y[1] - x[1])[0]!;
      const share = topCount / total;
      out.push({
        area, prCount: total, topOwner, topOwnerShare: share, distinctOwners: owners.size,
        risk: owners.size === 1 || share >= 0.75 ? 'high' : share >= 0.5 ? 'medium' : 'low',
      });
    }
    return out.sort((a, b) => b.prCount - a.prCount).slice(0, 36);
  }, [engineers]);

  const data = useMemo(
    () => nodes.map((n) => ({ name: n.area, value: n.prCount, group: n.risk })),
    [nodes],
  );

  const options = useMemo(() => ({
    title: '',
    height: '320px',
    theme,
    toolbar: { enabled: false },
    color: { scale: { high: '#fa4d56', medium: '#ff832b', low: '#42be65' } },
    data: { groupMapsTo: 'group' },
  }), [theme]);

  const atRisk = nodes.filter((n) => n.risk === 'high');

  return (
    <Modal open={open} onRequestClose={onClose} passiveModal size="lg"
      modalHeading="Bus factor — key-person risk by product surface" modalLabel="Ownership">
      <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.875rem', marginBottom: '1rem' }}>
        Area = volume of change. Colour = concentration of ownership.{' '}
        <strong style={{ color: 'var(--cds-support-error)' }}>Red</strong> means one person authored
        75%+ of the change in that surface (or is its only author) — fund a second owner before you
        need one.
      </p>
      <div style={{ minHeight: 340 }}>
        <TreemapChart data={data} options={options} />
      </div>

      <h5 style={{ margin: '1.5rem 0 .5rem' }}>
        {atRisk.length} surface{atRisk.length === 1 ? '' : 's'} with concentrated ownership
      </h5>
      <StructuredListWrapper isCondensed>
        <StructuredListHead>
          <StructuredListRow head>
            <StructuredListCell head>Surface</StructuredListCell>
            <StructuredListCell head>Primary owner</StructuredListCell>
            <StructuredListCell head>Their share</StructuredListCell>
            <StructuredListCell head>Contributors</StructuredListCell>
            <StructuredListCell head>Risk</StructuredListCell>
          </StructuredListRow>
        </StructuredListHead>
        <StructuredListBody>
          {nodes.slice(0, 16).map((n) => (
            <StructuredListRow key={n.area}>
              <StructuredListCell noWrap><code>{n.area}</code></StructuredListCell>
              <StructuredListCell>{n.topOwner}</StructuredListCell>
              <StructuredListCell>{pct(n.topOwnerShare)}</StructuredListCell>
              <StructuredListCell>{n.distinctOwners}</StructuredListCell>
              <StructuredListCell>
                <Tag size="sm" type={n.risk === 'high' ? 'red' : n.risk === 'medium' ? 'magenta' : 'green'}>
                  {n.risk}
                </Tag>
              </StructuredListCell>
            </StructuredListRow>
          ))}
        </StructuredListBody>
      </StructuredListWrapper>
      <p style={{ marginTop: '1rem', fontSize: '.75rem', color: 'var(--cds-text-helper)' }}>
        Shares are computed over the engineers loaded into this view, so a surface owned mostly by
        someone outside the top cohort may read as more concentrated than it is.
      </p>
    </Modal>
  );
}
