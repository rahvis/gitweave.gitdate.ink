import { Suspense } from 'react';
import { loadDashboard } from '../lib/api';
import { Dashboard } from '../components/Dashboard';
import { EmptyState } from '../components/EmptyState';

export const dynamic = 'force-dynamic';

/**
 * Server Component: the dashboard arrives already populated, so the primary
 * answer paints without a client-side fetch waterfall.
 */
export default async function Page({
  searchParams,
}: { searchParams: Promise<{ window?: string }> }) {
  const params = await searchParams;
  const windowDays = Number(params.window ?? 90) || 90;
  const { payload, error } = await loadDashboard(windowDays);

  if (!payload || payload.engineers.length === 0) {
    return <EmptyState error={error} windowDays={windowDays} />;
  }

  return (
    <Suspense fallback={null}>
      <Dashboard payload={payload} windowDays={windowDays} />
    </Suspense>
  );
}
