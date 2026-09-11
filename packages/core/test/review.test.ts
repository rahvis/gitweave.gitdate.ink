import { describe, expect, it } from 'vitest';
import { BotClassifier } from '../src/attribution/bots.js';
import { AgentAttributor } from '../src/attribution/agents.js';
import { PathClassifier } from '../src/paths.js';
import { buildPRContext, scoreProblemStatement } from '../src/context.js';
import { computeFileCentrality, computeFileOrigins } from '../src/centrality.js';
import { makePR, ENGINE_OPTS } from './fixtures.js';
import type { PullRequestRecord } from '@gitweave/types';

const bots = new BotClassifier(ENGINE_OPTS.botDenylist);
const agents = new AgentAttributor(ENGINE_OPTS.agentAuthors, ENGINE_OPTS.agentBranchPrefixes);
const paths = new PathClassifier();

function ctxFor(pr: PullRequestRecord, all: PullRequestRecord[] = [pr]) {
  const authorsFor = (p: PullRequestRecord) => agents.authorsFor(p, bots);
  return buildPRContext(pr, {
    bots, agents, paths,
    centrality: computeFileCentrality(all, bots, authorsFor),
    fileOrigins: computeFileOrigins(all),
    blastHighMultiplier: 1.6,
    blastLowMultiplier: 0.4,
  });
}

describe('consequential review detection', () => {
  it('counts a thread GitHub marked outdated — the code it pointed at changed', () => {
    const pr = makePR({
      reviewThreads: [{
        id: 't1', authorLogin: 'bob', path: 'products/cdp/handler.py',
        createdAt: '2026-08-01T12:00:00Z', isResolved: false, isOutdated: true, commentCount: 2,
      }],
    });
    const c = ctxFor(pr);
    expect(c.consequentialThreads).toHaveLength(1);
    expect(c.consequentialThreads[0]!.reason).toBe('outdated');
  });

  it('counts a resolved thread followed by a push before merge', () => {
    const pr = makePR({
      commits: [
        { oid: 'a', authorLogin: 'alice', committedAt: '2026-08-01T11:00:00Z', message: 'first' },
        { oid: 'b', authorLogin: 'alice', committedAt: '2026-08-01T14:00:00Z', message: 'address review' },
      ],
      reviewThreads: [{
        id: 't1', authorLogin: 'bob', path: 'products/cdp/handler.py',
        createdAt: '2026-08-01T12:00:00Z', isResolved: true, isOutdated: false, commentCount: 1,
      }],
    });
    expect(ctxFor(pr).consequentialThreads[0]!.reason).toBe('resolved-with-push');
  });

  it('does NOT count a resolved thread with no subsequent push — nothing changed', () => {
    const pr = makePR({
      commits: [{ oid: 'a', authorLogin: 'alice', committedAt: '2026-08-01T11:00:00Z', message: 'first' }],
      reviewThreads: [{
        id: 't1', authorLogin: 'bob', path: 'x.py',
        createdAt: '2026-08-01T12:00:00Z', isResolved: true, isOutdated: false, commentCount: 1,
      }],
    });
    expect(ctxFor(pr).consequentialThreads).toHaveLength(0);
  });

  it('scores approvals at exactly zero — on PostHog the approve:request-changes ratio is ~30:1', () => {
    const pr = makePR({
      reviews: [
        { reviewerLogin: 'bob', state: 'APPROVED', submittedAt: '2026-08-01T12:00:00Z', bodyLength: 0 },
        { reviewerLogin: 'carol', state: 'APPROVED', submittedAt: '2026-08-01T12:30:00Z', bodyLength: 4 },
      ],
    });
    const c = ctxFor(pr);
    expect(c.consequentialThreads).toHaveLength(0);
    expect(c.rubberStamps.sort()).toEqual(['bob', 'carol']);
  });

  it('ignores bot review threads', () => {
    const pr = makePR({
      reviewThreads: [{
        id: 't1', authorLogin: 'greptile-apps', path: 'x.py',
        createdAt: '2026-08-01T12:00:00Z', isResolved: true, isOutdated: true, commentCount: 1,
      }],
    });
    expect(ctxFor(pr).consequentialThreads).toHaveLength(0);
  });

  it('ignores self-review', () => {
    const pr = makePR({
      reviewThreads: [{
        id: 't1', authorLogin: 'alice', path: 'x.py',
        createdAt: '2026-08-01T12:00:00Z', isResolved: true, isOutdated: true, commentCount: 1,
      }],
    });
    expect(ctxFor(pr).consequentialThreads).toHaveLength(0);
  });
});

describe('unblock latency', () => {
  it('measures request → first substantive review', () => {
    const pr = makePR({
      reviewRequests: [{ requestedLogin: 'bob', createdAt: '2026-08-01T10:00:00Z' }],
      reviews: [{ reviewerLogin: 'bob', state: 'COMMENTED', submittedAt: '2026-08-01T12:00:00Z', bodyLength: 200 }],
    });
    const [entry] = ctxFor(pr).unblockLatency;
    expect(entry!.reviewer).toBe('bob');
    expect(entry!.hours).toBeCloseTo(2, 5);
  });

  it('does not reward an empty "LGTM" — a rubber stamp is not an unblock', () => {
    const pr = makePR({
      reviewRequests: [{ requestedLogin: 'bob', createdAt: '2026-08-01T10:00:00Z' }],
      reviews: [{ reviewerLogin: 'bob', state: 'APPROVED', submittedAt: '2026-08-01T10:01:00Z', bodyLength: 4 }],
    });
    expect(ctxFor(pr).unblockLatency).toHaveLength(0);
  });
});

describe('problem statement scoring', () => {
  it('scores a rich PostHog-style problem section highly', () => {
    const body = `## Problem

- A person reading the Desktop agents fleet saw \`daily at 09:00\` with no timezone,
  so they read a correct schedule as local time and thought the scout ran hours late.
- Scout cron schedules resolve in the project timezone, which means nothing on the
  fleet table said so. See https://github.com/PostHog/posthog/issues/123

| Surface | Before | After |
| --- | --- | --- |
| Fleet row | daily at 09:00 | daily at 09:00 (PDT) |

## Changes
Stuff.`;
    const r = scoreProblemStatement(body);
    expect(r.has).toBe(true);
    expect(r.quality).toBeGreaterThan(0.7);
  });

  it('gives nothing to an empty body', () => {
    expect(scoreProblemStatement('')).toEqual({ has: false, quality: 0 });
  });

  it('gives nothing when there is no problem section', () => {
    expect(scoreProblemStatement('## Changes\nBumped a version.').has).toBe(false);
  });

  it('scores a thin problem section low', () => {
    const r = scoreProblemStatement('## Problem\nBug.');
    expect(r.has).toBe(true);
    expect(r.quality).toBeLessThan(0.2);
  });

  /**
   * Regression: we originally ingested GraphQL `bodyText`, which strips
   * markdown. `## Problem` arrived as bare `Problem`, so the heading regex
   * matched 0 of 2,084 real PostHog PRs that DO have a problem section, and
   * Problem Shaping silently scored zero for the entire cohort. We now ingest
   * raw `body`, and the matcher tolerates both shapes.
   */
  it('matches a markdown heading (raw body)', () => {
    expect(scoreProblemStatement('## Problem\n\nThe thing is broken because X.').has).toBe(true);
  });
  it('matches a markdown-stripped heading (bodyText shape)', () => {
    const stripped = 'Problem\n\nPostHog widgets render blank in ChatGPT: the iframe CSP only allows the connector origin.';
    expect(scoreProblemStatement(stripped).has).toBe(true);
  });
  it('matches a bold heading', () => {
    expect(scoreProblemStatement('**Problem**\n\nSomething is wrong here.').has).toBe(true);
  });
  it('does not false-positive on the word appearing in prose', () => {
    expect(scoreProblemStatement('This fixes a problem with the parser.').has).toBe(false);
    expect(scoreProblemStatement('## Changes\nThe problem was in the loop.').has).toBe(false);
  });
});
