'use client';
import { useId, useState } from 'react';
import { Information } from '@carbon/icons-react';

interface Props {
  label: React.ReactNode;
  /** How the number is computed. Shown in place, never as a floating layer. */
  detail: string;
}

/**
 * In-place disclosure instead of a hover tooltip.
 *
 * Carbon's DefinitionTooltip renders a floating layer positioned against its
 * trigger. Inside a narrow `overflow-y: auto` panel that layer was both
 * clipped by the scroll container and pushed off the panel's left edge.
 *
 * The deeper problem is that hover does not exist on touch, and this dashboard
 * has to work on a phone — so a hover-only affordance would simply hide the
 * methodology from every mobile reader. Expanding in place fixes the clipping
 * structurally (there is nothing to position and nothing to overflow) and is
 * the same interaction on every input device.
 */
export function Explain({ label, detail }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className={`gw-explain__trigger${open ? ' gw-explain__trigger--open' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span>
        <Information size={14} aria-hidden />
        <span className="gw-sr">{open ? 'Hide how this is calculated' : 'Show how this is calculated'}</span>
      </button>
      {open && <p className="gw-explain__detail" id={id}>{detail}</p>}
    </>
  );
}
