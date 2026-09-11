'use client';
import type { EngineerMetrics } from '@gitweave/types';
import { Tag } from '@carbon/react';

interface Props {
  engineer: EngineerMetrics;
  position: number;
  active: boolean;
  onSelect: (login: string) => void;
}

export function RankCard({ engineer, position, active, onSelect }: Props) {
  const owned = engineer.ownership.ownedSurfaces[0];
  return (
    <button
      type="button"
      className={`gw-rank${active ? ' gw-rank--active' : ''}`}
      onClick={() => onSelect(engineer.login)}
      aria-pressed={active}
      aria-label={`Rank ${position}, ${engineer.login}, impact score ${engineer.impactScore.toFixed(0)}. ${engineer.whySentence}`}
    >
      <span className="gw-rank__pos">{position}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="gw-rank__avatar" src={engineer.avatarUrl ?? ''} alt="" loading="lazy" width={32} height={32} />
      <span style={{ minWidth: 0 }}>
        <span className="gw-rank__name">{engineer.login}</span>
        <span className="gw-rank__why">{engineer.whySentence}</span>
        <span className="gw-rank__tags">
          <Tag type="blue" size="sm">{engineer.archetype}</Tag>
          {owned && <Tag type="outline" size="sm">{owned.area}</Tag>}
          {engineer.confidence === 'low' && <Tag type="gray" size="sm">low confidence</Tag>}
        </span>
      </span>
      <span>
        <span className="gw-rank__score">{engineer.impactScore.toFixed(0)}</span>
        <span className="gw-rank__scorelabel" style={{ display: 'block' }}>score</span>
      </span>
    </button>
  );
}
