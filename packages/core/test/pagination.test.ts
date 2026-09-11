import { describe, expect, it } from 'vitest';
import { fetchMergedPRs } from '@gitweave/github';

/**
 * Regression: the walk terminated after 3 consecutive pages containing no
 * in-window *merges*. Because the ordering is UPDATED_AT-descending, old PRs
 * that were merely commented on recently sort early — so a run of them
 * triggered an early exit. On PostHog that stopped at 3,841 of ~15,000 PRs
 * and reported "complete".
 *
 * The sound rule keys on `updatedAt`: since updatedAt >= mergedAt always,
 * once a page's oldest updatedAt precedes the window, nothing later can be
 * in the window.
 */

const SINCE = '2026-06-13T00:00:00Z';

function node(n: number, updatedAt: string, mergedAt: string | null) {
  return {
    number: n, title: `pr ${n}`, body: '', url: `https://github.com/o/r/pull/${n}`,
    createdAt: mergedAt ?? updatedAt, updatedAt, mergedAt, closedAt: mergedAt, state: 'MERGED',
    additions: 1, deletions: 0, changedFiles: 1, headRefName: 'x',
    author: { login: 'alice', __typename: 'User' }, mergedBy: { login: 'alice', __typename: 'User' },
    labels: { nodes: [] }, files: { nodes: [] }, commits: { nodes: [] },
    reviews: { nodes: [] }, reviewThreads: { nodes: [] },
    timelineItems: { nodes: [] }, comments: { nodes: [] },
  };
}

/** Minimal stand-in for GitHubGraphQLClient. */
function stubClient(pages: Array<{ nodes: unknown[]; hasNextPage: boolean }>) {
  let i = 0;
  return {
    totalCost: 0,
    totalRequests: 0,
    poolSnapshot: () => [],
    query: async () => {
      const page = pages[i] ?? { nodes: [], hasNextPage: false };
      i += 1;
      return {
        rateLimit: { limit: 5000, cost: 1, remaining: 4999, resetAt: new Date().toISOString() },
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: page.hasNextPage, endCursor: `c${i}` },
            nodes: page.nodes,
          },
        },
      };
    },
    get pagesServed() { return i; },
  };
}

describe('fetchMergedPRs termination', () => {
  it('keeps walking past pages whose PRs merged before the window but were updated inside it', async () => {
    // Three "stale" pages: recently updated, merged long ago. The old rule
    // bailed here and lost everything after them.
    const stale = Array.from({ length: 3 }, (_, p) => ({
      nodes: [node(100 + p, '2026-08-01T00:00:00Z', '2024-01-01T00:00:00Z')],
      hasNextPage: true,
    }));
    const good = {
      nodes: [node(200, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')],
      hasNextPage: true,
    };
    const edge = {
      nodes: [node(300, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')],
      hasNextPage: true,
    };
    const client = stubClient([...stale, good, edge]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { prs } = await fetchMergedPRs(client as any, {
      owner: 'o', name: 'r', sinceISO: SINCE, pageSize: 25,
    });

    expect(prs.map((p) => p.number)).toContain(200);
    expect(prs).toHaveLength(1);
  });

  it('stops as soon as a page falls entirely before the window', async () => {
    const client = stubClient([
      { nodes: [node(1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')], hasNextPage: true },
      { nodes: [node(2, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')], hasNextPage: true },
      { nodes: [node(3, '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')], hasNextPage: true },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { prs, stats } = await fetchMergedPRs(client as any, {
      owner: 'o', name: 'r', sinceISO: SINCE, pageSize: 25,
    });

    expect(prs.map((p) => p.number)).toEqual([1]);
    // Page 2 crosses the edge, so page 3 is never requested.
    expect(stats.pages).toBe(2);
  });

  it('honours an explicit PR cap', async () => {
    const pages = Array.from({ length: 10 }, (_, p) => ({
      nodes: [node(p, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')],
      hasNextPage: true,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { prs } = await fetchMergedPRs(stubClient(pages) as any, {
      owner: 'o', name: 'r', sinceISO: SINCE, pageSize: 25, maxPRs: 3,
    });
    expect(prs.length).toBeGreaterThanOrEqual(3);
    expect(prs.length).toBeLessThan(10);
  });
});
