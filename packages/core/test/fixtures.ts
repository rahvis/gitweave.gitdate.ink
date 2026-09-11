import type { PullRequestRecord } from '@gitweave/types';

let counter = 1000;

export function makePR(overrides: Partial<PullRequestRecord> = {}): PullRequestRecord {
  counter += 1;
  const base: PullRequestRecord = {
    repo: 'PostHog/posthog',
    number: counter,
    title: `feat(cdp): change ${counter}`,
    body: '',
    url: `https://github.com/PostHog/posthog/pull/${counter}`,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T16:00:00Z',
    mergedAt: '2026-08-01T16:00:00Z',
    closedAt: '2026-08-01T16:00:00Z',
    state: 'MERGED',
    authorLogin: 'alice',
    authorIsBot: false,
    mergedByLogin: 'alice',
    headRefName: 'alice/change',
    additions: 100,
    deletions: 20,
    changedFiles: 2,
    labels: [],
    files: [{ path: 'products/cdp/handler.py', additions: 100, deletions: 20 }],
    commits: [{ oid: 'a1', authorLogin: 'alice', committedAt: '2026-08-01T11:00:00Z', message: 'work' }],
    reviews: [],
    reviewThreads: [],
    reviewRequests: [],
    comments: [],
  };
  const merged = { ...base, ...overrides };
  // Keep createdAt consistent when a test overrides only mergedAt, otherwise
  // time-to-merge goes negative and silently drops out of the cohort stats.
  if (overrides.mergedAt && !overrides.createdAt) {
    merged.createdAt = new Date(new Date(overrides.mergedAt).getTime() - 6 * 3_600_000).toISOString();
  }
  return merged;
}

export const ENGINE_OPTS = {
  repo: 'PostHog/posthog',
  windowDays: 90,
  windowStart: '2026-06-12T00:00:00Z',
  windowEnd: '2026-09-10T00:00:00Z',
  botDenylist: ['stamphog', 'greptile-apps', 'veria-ai', 'coderabbitai', 'copilot-pull-request-reviewer'],
  agentAuthors: ['posthog'],
  agentBranchPrefixes: ['posthog-self-driving/'],
  blastHighMultiplier: 1.6,
  blastLowMultiplier: 0.4,
  minPRsForRanking: 5,
  reliability: { min: 0.85, max: 1.10, penaltyFactor: 1.2 },
};
