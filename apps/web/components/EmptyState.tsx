import { InlineNotification } from '@carbon/react';

export function EmptyState({ error, windowDays }: { error: string | null; windowDays: number }) {
  return (
    <main style={{ maxWidth: '42rem', margin: '6rem auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '.5rem' }}>GitWeave</h1>
      <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '1.5rem' }}>
        Engineering impact intelligence for GitHub.
      </p>
      <InlineNotification
        kind="warning"
        lowContrast
        hideCloseButton
        title={`No metrics available for the last ${windowDays} days`}
        subtitle={error ?? 'The ingest worker has not produced a materialised window yet.'}
        style={{ maxWidth: '100%' }}
      />
      <pre style={{
        marginTop: '1.5rem', padding: '1rem', background: 'var(--cds-layer-01)',
        fontSize: '.8125rem', overflowX: 'auto', borderLeft: '3px solid var(--cds-support-info)',
      }}>
{`# Seed from the committed fixture (no GitHub token needed)
docker compose run --rm seed

# Or pull live data
export GITHUB_TOKEN=github_pat_...
pnpm ingest sync --days=90`}
      </pre>
    </main>
  );
}
