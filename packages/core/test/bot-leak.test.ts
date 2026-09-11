import { describe, expect, it } from 'vitest';
import { computeImpact } from '../src/engine.js';
import { normalisePR } from '@gitweave/github';
import { makePR, ENGINE_OPTS } from './fixtures.js';

/**
 * Regression: PostHog's AI reviewer reached rank 3 on live data with 1,059
 * "consequential" review threads.
 *
 * Root cause: GraphQL reports bot-ness per actor via `__typename`, but the
 * fetcher stripped the `[bot]` suffix and kept a separate `authorIsBot` flag.
 * That flag only covered the PR author — review authors, thread authors,
 * commit authors and requested reviewers all silently became "humans".
 *
 * Fix: a bot's canonical login always ends in `[bot]`, so bot-ness cannot be
 * lost in transit. Both layers are asserted below.
 */
describe('bot leakage regression (live data, rank 3)', () => {
  it('marks every bot actor, not just the PR author, at normalisation time', () => {
    const raw = {
      number: 1, title: 'fix: something', body: '', url: 'https://github.com/x/y/pull/1',
      createdAt: '2026-08-01T10:00:00Z', mergedAt: '2026-08-01T16:00:00Z', closedAt: null,
      state: 'MERGED', additions: 10, deletions: 1, changedFiles: 1,
      headRefName: 'posthog-self-driving/x',
      author: { login: 'posthog', __typename: 'Bot' },
      mergedBy: { login: 'charlesvien', __typename: 'User' },
      labels: { nodes: [] },
      files: { nodes: [{ path: 'products/cdp/a.py', additions: 10, deletions: 1 }] },
      commits: { nodes: [{ commit: { oid: 'a', committedDate: '2026-08-01T11:00:00Z', message: 'x', author: { user: { login: 'charlesvien', __typename: 'User' } } } }] },
      reviews: { nodes: [{ author: { login: 'posthog', __typename: 'Bot' }, state: 'COMMENTED', submittedAt: '2026-08-01T12:00:00Z', body: 'a long automated review body '.repeat(5) }] },
      reviewThreads: { nodes: [{ id: 't1', isResolved: true, isOutdated: true, path: 'products/cdp/a.py', comments: { totalCount: 1, nodes: [{ author: { login: 'posthog', __typename: 'Bot' }, createdAt: '2026-08-01T12:00:00Z' }] } }] },
      timelineItems: { nodes: [{ createdAt: '2026-08-01T10:30:00Z', requestedReviewer: { login: 'posthog', __typename: 'Bot' } }] },
      comments: { nodes: [] },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pr = normalisePR('PostHog/posthog', raw as any);

    expect(pr.authorLogin).toBe('posthog[bot]');
    expect(pr.reviews[0]!.reviewerLogin).toBe('posthog[bot]');
    expect(pr.reviewThreads[0]!.authorLogin).toBe('posthog[bot]');
    expect(pr.reviewRequests[0]!.requestedLogin).toBe('posthog[bot]');
    // ...and the human is untouched.
    expect(pr.mergedByLogin).toBe('charlesvien');
    expect(pr.commits[0]!.authorLogin).toBe('charlesvien');
  });

  it('never ranks an AI reviewer, however many threads it opens', () => {
    const prs = Array.from({ length: 40 }, (_, i) => makePR({
      authorLogin: 'alice', mergedByLogin: 'alice',
      mergedAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
      files: [{ path: `products/cdp/f${i}.py`, additions: 40, deletions: 5 }],
      reviewThreads: [
        { id: `bot-${i}`, authorLogin: 'posthog[bot]', path: `products/cdp/f${i}.py`, createdAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T11:00:00Z`, isResolved: true, isOutdated: true, commentCount: 4 },
        { id: `gr-${i}`, authorLogin: 'greptile-apps', path: `products/cdp/f${i}.py`, createdAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T11:00:00Z`, isResolved: true, isOutdated: true, commentCount: 4 },
      ],
    }));
    const out = computeImpact(prs, ENGINE_OPTS);
    const logins = out.engineers.map((e) => e.login);
    expect(logins).not.toContain('posthog');
    expect(logins).not.toContain('posthog[bot]');
    expect(logins).not.toContain('greptile-apps');
    expect(logins).toContain('alice');
  });

  it('still credits the human on an agent PR after the suffix change', () => {
    const prs = [makePR({
      authorLogin: 'posthog[bot]', authorIsBot: true,
      headRefName: 'posthog-self-driving/x',
      mergedByLogin: 'charlesvien',
      commits: [
        { oid: 'a', authorLogin: 'posthog[bot]', committedAt: '2026-08-01T10:10:00Z', message: 'auto' },
        { oid: 'b', authorLogin: 'charlesvien', committedAt: '2026-08-01T11:00:00Z', message: 'real work' },
      ],
    })];
    const out = computeImpact(prs, ENGINE_OPTS);
    expect(out.engineers.map((e) => e.login)).toEqual(['charlesvien']);
    expect(out.engineers[0]!.agent.agentStewardedMerges).toBe(1);
  });
});
