'use client';
import type { CohortSummary } from '@gitweave/types';
import { Modal, StructuredListWrapper, StructuredListHead, StructuredListRow, StructuredListCell, StructuredListBody, InlineNotification, Tag } from '@carbon/react';
import { num } from '../lib/format';

/**
 * Anti-use notice ships *inside* the product, not in a README.
 * A tool like this is only safe if its limits travel with it.
 */
export function MethodologyModal({ open, onClose, cohort }: { open: boolean; onClose: () => void; cohort: CohortSummary }) {
  return (
    <Modal open={open} modalHeading="How GitWeave measures impact" modalLabel="Methodology" passiveModal onRequestClose={onClose} size="lg">
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title="Read this before you act on any number here"
        subtitle="GitWeave measures observable GitHub activity only. It cannot see design docs, incident response, customer calls, interviews, architecture debates, or the conversation that stopped a bad project. Use it to generate questions, never to conclude answers. Do not use it for stack ranking, PIPs, compensation, or headcount decisions without human context — a low score frequently means the person's highest-impact work does not happen on GitHub."
        style={{ maxWidth: '100%', marginBottom: '1.5rem' }}
      />

      <h5 style={{ marginBottom: '.5rem' }}>How the score is built</h5>
      <p style={{ marginBottom: '1rem', color: 'var(--cds-text-secondary)', fontSize: '.875rem' }}>
        Each dimension is a <strong>percentile rank</strong> (0&ndash;100) within the active cohort.
        The Impact Score is those five percentiles combined under your weights, which sum to 1 &mdash;
        so the score is genuinely <strong>out of 100</strong>. Reliability then applies as a
        penalty-only multiplier in (0.85,&nbsp;1.00]: a clean record earns 1.00, never a bonus, so
        it can temper a rank but can never push one past the ceiling.
      </p>

      <h5 style={{ marginBottom: '.5rem' }}>What we deliberately do not measure</h5>
      <p style={{ marginBottom: '1rem', color: 'var(--cds-text-secondary)', fontSize: '.875rem' }}>
        Lines of code as a positive signal · commit counts (squash settings make them meaningless) ·
        hours, time-of-day or weekend activity (surveillance, not impact) · approval counts
        (PostHog&apos;s approve-to-request-changes ratio is ~30:1, so approval is a formality) ·
        issue-closure counts (only ~6% of PRs here link an issue).
      </p>

      <h5 style={{ marginBottom: '.5rem' }}>The five dimensions</h5>
      <StructuredListWrapper isCondensed>
        <StructuredListHead>
          <StructuredListRow head>
            <StructuredListCell head>Dimension</StructuredListCell>
            <StructuredListCell head>What it asks</StructuredListCell>
            <StructuredListCell head>Why it resists gaming</StructuredListCell>
          </StructuredListRow>
        </StructuredListHead>
        <StructuredListBody>
          <StructuredListRow>
            <StructuredListCell noWrap>Ownership</StructuredListCell>
            <StructuredListCell>Do they own hard, load-bearing things?</StructuredListCell>
            <StructuredListCell>File centrality is derived from other people&apos;s behaviour — editing a file more does not make it more central, because that raises the denominator too.</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell noWrap>Leverage</StructuredListCell>
            <StructuredListCell>Do they make others faster and better?</StructuredListCell>
            <StructuredListCell>Only counts review threads the author answered with a code change. Nitpicking earns nothing; approvals earn exactly zero.</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell noWrap>Reach</StructuredListCell>
            <StructuredListCell>How far across the codebase do they operate?</StructuredListCell>
            <StructuredListCell>Uses effective area count (exp of Shannon entropy), so five areas at 20% beats 96/1/1/1/1.</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell noWrap>Initiative</StructuredListCell>
            <StructuredListCell>Do they start things, or only execute?</StructuredListCell>
            <StructuredListCell>New surfaces and files, plus taking responsibility for others&apos; work landing.</StructuredListCell>
          </StructuredListRow>
          <StructuredListRow>
            <StructuredListCell noWrap>Problem Shaping</StructuredListCell>
            <StructuredListCell>Do they frame the problem, not just the patch?</StructuredListCell>
            <StructuredListCell>Rate-based and Laplace-smoothed, so shipping more PRs neither helps nor hurts.</StructuredListCell>
          </StructuredListRow>
        </StructuredListBody>
      </StructuredListWrapper>

      <h5 style={{ margin: '1.5rem 0 .5rem' }}>Bots excluded from this cohort</h5>
      <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.875rem', marginBottom: '.5rem' }}>
        Without this filter the top reviewers on PostHog are all bots — <code>stamphog</code>,{' '}
        <code>posthog[bot]</code>, <code>greptile-apps</code>, <code>veria-ai</code> and{' '}
        <code>copilot-pull-request-reviewer</code>. {num(cohort.botReviewsExcluded)} bot reviews
        were discarded in this window.
      </p>
      <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
        {cohort.botsExcluded.map((b) => <Tag key={b} type="gray" size="sm">{b}</Tag>)}
      </div>

      <h5 style={{ margin: '1.5rem 0 .5rem' }}>Agent-authored PRs</h5>
      <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.875rem' }}>
        {num(cohort.agentMergedPRs)} of {num(cohort.totalMergedPRs)} merged PRs in this
        window were opened by PostHog&apos;s self-driving agent. Crediting the bot would put a robot at
        rank 1; dropping those PRs would erase the humans who committed into them and merged them.
        GitWeave attributes them at commit and steward level to the humans involved, and reports
        &ldquo;agent leverage&rdquo; as a neutral statistic rather than scoring it.
      </p>

      <h5 style={{ margin: '1.5rem 0 .5rem' }}>Known limitations</h5>
      <ul style={{ color: 'var(--cds-text-secondary)', fontSize: '.875rem', paddingLeft: '1.25rem', listStyle: 'disc' }}>
        <li>Tenure is inferred from first activity inside the window; contributions before it are invisible.</li>
        <li>Only merged PRs are ingested, so follow-through on abandoned work is not yet measured.</li>
        <li>Multiple accounts belonging to one person are not yet merged into a single identity.</li>
        <li>Percentiles are relative to this repo&apos;s active cohort — they are not cross-company comparable.</li>
      </ul>
    </Modal>
  );
}
