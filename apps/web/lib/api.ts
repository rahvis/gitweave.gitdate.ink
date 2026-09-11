import type { DashboardPayload } from '@gitweave/types';

/**
 * Server-side data access.
 *
 * The dashboard is fetched in a React Server Component so the first paint is
 * already populated — no client waterfall, no loading spinner on the primary
 * answer. Inside Docker the browser cannot reach `api:4000`, so the internal
 * URL is separate from the public one.
 */
const INTERNAL_API = process.env.API_INTERNAL_URL
  ?? process.env.NEXT_PUBLIC_API_URL
  ?? 'http://localhost:4000';

export interface LoadResult {
  payload: DashboardPayload | null;
  error: string | null;
}

export async function loadDashboard(windowDays: number, limit = 60): Promise<LoadResult> {
  const url = `${INTERNAL_API}/api/dashboard?window=${windowDays}&limit=${limit}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) {
      return { payload: null, error: 'No metrics computed yet. The ingest worker is still building the first window.' };
    }
    if (!res.ok) return { payload: null, error: `API returned ${res.status}` };
    return { payload: (await res.json()) as DashboardPayload, error: null };
  } catch (err) {
    return { payload: null, error: `Cannot reach the GitWeave API at ${INTERNAL_API} — ${(err as Error).message}` };
  }
}
