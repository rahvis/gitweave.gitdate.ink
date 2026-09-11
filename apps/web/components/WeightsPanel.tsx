'use client';
import { DIMENSION_KEYS, DIMENSION_LABELS, DEFAULT_WEIGHTS, type Weights } from '@gitweave/types';
import { Button, Modal, Slider, InlineNotification } from '@carbon/react';

interface Props {
  open: boolean;
  weights: Weights;
  dirty: boolean;
  onChange: (w: Weights) => void;
  onClose: () => void;
  onReset: () => void;
}

const RATIONALE: Record<string, string> = {
  ownership: 'Centrality- and blast-radius-weighted change, not lines.',
  leverage: 'Review that changed code, breadth of people unblocked, responsiveness.',
  reach: 'Effective spread across product areas, stacks and teams.',
  initiative: 'New surfaces founded, files created, others\' PRs shepherded.',
  problemShaping: 'How consistently and how well they state the problem.',
};

/**
 * The interaction that turns a dashboard into an instrument.
 *
 * "There's no one right answer" is the honest position on impact, so
 * GitWeave ships its weights as a defensible default rather than a truth.
 * A leader who believes reliability matters more drags a slider and watches
 * the ranking reshuffle — which is the only way they ever actually adopt it.
 */
export function WeightsPanel({ open, weights, dirty, onChange, onClose, onReset }: Props) {
  return (
    <Modal
      open={open}
      modalHeading="How should impact be weighted?"
      modalLabel="GitWeave scoring model"
      primaryButtonText="Done"
      secondaryButtonText="Reset to defaults"
      onRequestSubmit={onClose}
      onRequestClose={onClose}
      onSecondarySubmit={onReset}
      size="md"
    >
      <p style={{ marginBottom: '1rem', color: 'var(--cds-text-secondary)' }}>
        There is no single correct definition of engineering impact. These are GitWeave&apos;s
        defaults, not a claim of truth &mdash; Leverage is weighted highest because multipliers
        matter more than individual producers at this scale, and because it is the signal every
        other tool under-counts. Change them and the ranking re-sorts live.
      </p>

      {DIMENSION_KEYS.map((key) => (
        <div key={key} style={{ marginBottom: '.5rem' }}>
          <Slider
            id={`weight-${key}`}
            labelText={`${DIMENSION_LABELS[key]} — ${RATIONALE[key]}`}
            min={0}
            max={100}
            step={1}
            value={Math.round(weights[key] * 100)}
            onChange={({ value }) => onChange({ ...weights, [key]: value / 100 })}
          />
        </div>
      ))}

      {dirty && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="Custom weights active"
          subtitle="The ranking now reflects your definition of impact, not GitWeave's defaults."
          style={{ marginTop: '1rem', maxWidth: '100%' }}
        />
      )}

      <p style={{ marginTop: '1rem', fontSize: '.75rem', color: 'var(--cds-text-helper)' }}>
        Weights are normalised, so only their ratio matters, and the score stays out of 100.
        Reliability is applied separately as a penalty-only multiplier in (0.85, 1.00] and is not
        adjustable &mdash; it can temper a rank but must never manufacture one. Defaults:{' '}
        {DIMENSION_KEYS.map((k) => `${DIMENSION_LABELS[k]} ${DEFAULT_WEIGHTS[k]}`).join(', ')}.
      </p>
      <Button kind="ghost" size="sm" onClick={onReset} style={{ marginTop: '.5rem' }}>
        Reset to GitWeave defaults
      </Button>
    </Modal>
  );
}
