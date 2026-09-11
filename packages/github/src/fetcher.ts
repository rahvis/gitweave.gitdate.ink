import type { PullRequestRecord, ReviewState } from '@gitweave/types';
import { GitHubGraphQLClient } from './client.js';
import { logger } from './logger.js';
import { MERGED_PRS_QUERY } from './queries.js';

/* Raw GraphQL shapes (only what we read). */
interface GqlActor { login?: string | null; __typename?: string }
interface GqlNode { [k: string]: unknown }

interface GqlPR {
  number: number; title: string; body: string | null; url: string;
  createdAt: string; mergedAt: string | null; closedAt: string | null; state: string;
  additions: number; deletions: number; changedFiles: number; headRefName: string;
  author: GqlActor | null; mergedBy: GqlActor | null;
  labels: { nodes: Array<{ name: string }> };
  files: { nodes: Array<{ path: string; additions: number; deletions: number }> } | null;
  commits: { nodes: Array<{ commit: { oid: string; committedDate: string; message: string; author: { user: GqlActor | null } | null } }> };
  reviews: { nodes: Array<{ author: GqlActor | null; state: string; submittedAt: string | null; body: string | null }> };
  reviewThreads: { nodes: Array<{ id: string; isResolved: boolean; isOutdated: boolean; path: string | null; comments: { totalCount: number; nodes: Array<{ author: GqlActor | null; createdAt: string }> } }> };
  timelineItems: { nodes: Array<GqlNode> };
  comments: { nodes: Array<{ author: GqlActor | null; createdAt: string; body: string | null }> };
}

interface MergedPRsResult {
  repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlPR[] } };
  rateLimit?: { limit: number; cost: number; remaining: number; resetAt: string };
}

const REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']);

function toReviewState(s: string): ReviewState {
  return (REVIEW_STATES.has(s) ? s : 'COMMENTED') as ReviewState;
}

/** GitHub reports bots either via __typename or a `[bot]` login suffix. Catch both. */
function isBotActor(a: GqlActor | null | undefined): boolean {
  if (!a) return false;
  if (a.__typename === 'Bot' || a.__typename === 'EnterpriseUserAccount') return true;
  return Boolean(a.login && a.login.endsWith('[bot]'));
}

/**
 * Canonical login. A bot ALWAYS ends in `[bot]`; a human never does.
 *
 * This matters more than it looks. GraphQL reports bot-ness via `__typename`,
 * which is a per-actor field we would otherwise have to thread through every
 * nested review, thread, commit and request. Stripping `[bot]` and keeping a
 * separate `authorIsBot` flag preserved it for the PR author only — and
 * PostHog's AI reviewer promptly landed at rank 3 with 1,059 "consequential"
 * review threads. Encoding it in the identifier makes it impossible to lose.
 */
function normaliseLogin(a: GqlActor | null | undefined): string | null {
  const login = a?.login;
  if (!login) return null;
  const base = login.endsWith('[bot]') ? login.slice(0, -5) : login;
  return isBotActor(a) ? `${base}[bot]` : base;
}

export function normalisePR(repo: string, pr: GqlPR): PullRequestRecord {
  return {
    repo,
    number: pr.number,
    title: pr.title ?? '',
    body: pr.body ?? '',
    url: pr.url,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    state: (pr.state === 'MERGED' || pr.state === 'CLOSED' || pr.state === 'OPEN' ? pr.state : 'CLOSED'),
    authorLogin: normaliseLogin(pr.author),
    authorIsBot: isBotActor(pr.author),
    mergedByLogin: normaliseLogin(pr.mergedBy),
    headRefName: pr.headRefName ?? '',
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changedFiles ?? 0,
    labels: (pr.labels?.nodes ?? []).map((l) => l.name),
    files: (pr.files?.nodes ?? []).map((f) => ({
      path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0,
    })),
    commits: (pr.commits?.nodes ?? []).map((c) => ({
      oid: c.commit.oid,
      authorLogin: normaliseLogin(c.commit.author?.user ?? null),
      committedAt: c.commit.committedDate,
      message: c.commit.message ?? '',
    })),
    reviews: (pr.reviews?.nodes ?? []).map((r) => ({
      reviewerLogin: normaliseLogin(r.author),
      state: toReviewState(r.state),
      submittedAt: r.submittedAt,
      bodyLength: (r.body ?? '').trim().length,
    })),
    reviewThreads: (pr.reviewThreads?.nodes ?? []).map((t) => {
      const first = t.comments?.nodes?.[0];
      return {
        id: t.id,
        authorLogin: normaliseLogin(first?.author ?? null),
        path: t.path,
        createdAt: first?.createdAt ?? null,
        isResolved: Boolean(t.isResolved),
        isOutdated: Boolean(t.isOutdated),
        commentCount: t.comments?.totalCount ?? 0,
      };
    }),
    reviewRequests: (pr.timelineItems?.nodes ?? [])
      .filter((n): n is { createdAt: string; requestedReviewer?: GqlActor } =>
        typeof (n as { createdAt?: unknown }).createdAt === 'string')
      .map((n) => ({
        requestedLogin: normaliseLogin(n.requestedReviewer ?? null),
        createdAt: n.createdAt,
      }))
      .filter((r) => r.requestedLogin !== null),
    comments: (pr.comments?.nodes ?? []).map((c) => ({
      authorLogin: normaliseLogin(c.author),
      createdAt: c.createdAt,
      bodyLength: (c.body ?? '').trim().length,
    })),
  };
}

export interface FetchOptions {
  owner: string;
  name: string;
  sinceISO: string;
  pageSize?: number;
  maxPRs?: number;
  startCursor?: string | null;
  /** Called after each page so the caller can persist the cursor (crash-resume). */
  onPage?: (prs: PullRequestRecord[], cursor: string | null, stats: FetchStats) => Promise<void>;
}

export interface FetchStats {
  pages: number; prs: number; costSpent: number; remaining: number; elapsedMs: number;
}

/**
 * Paginates merged PRs newest-first, stopping once `mergedAt` falls before the
 * window. Ordering by UPDATED_AT (the only order GitHub offers alongside a
 * MERGED filter) means a recently-touched old PR can appear late, so we use a
 * tolerance of consecutive out-of-window pages rather than bailing on the first.
 */
export async function fetchMergedPRs(
  client: GitHubGraphQLClient,
  opts: FetchOptions,
): Promise<{ prs: PullRequestRecord[]; stats: FetchStats; lastCursor: string | null }> {
  const repo = `${opts.owner}/${opts.name}`;
  const since = new Date(opts.sinceISO).getTime();
  const collected: PullRequestRecord[] = [];
  let cursor: string | null = opts.startCursor ?? null;
  let pageSize = opts.pageSize ?? 50;
  let pages = 0;
  let staleStreak = 0;
  let remaining = 0;
  const started = Date.now();
  const STALE_TOLERANCE = 3;

  for (;;) {
    let result: MergedPRsResult;
    try {
      result = await client.query<MergedPRsResult>(MERGED_PRS_QUERY, {
        owner: opts.owner, name: opts.name, pageSize, cursor,
      });
    } catch (err) {
      // A too-expensive page is the most common hard failure — halve and retry.
      if (pageSize > 10) {
        pageSize = Math.max(10, Math.floor(pageSize / 2));
        logger.warn({ pageSize, err: (err as Error).message }, 'Query failed — reducing page size');
        continue;
      }
      throw err;
    }

    pages += 1;
    remaining = result.rateLimit?.remaining ?? remaining;
    const conn = result.repository.pullRequests;
    const batch = conn.nodes.filter(Boolean).map((pr) => normalisePR(repo, pr));
    const inWindow = batch.filter((p) => p.mergedAt && new Date(p.mergedAt).getTime() >= since);
    collected.push(...inWindow);

    const stats: FetchStats = {
      pages, prs: collected.length, costSpent: client.totalCost,
      remaining, elapsedMs: Date.now() - started,
    };
    if (opts.onPage) await opts.onPage(inWindow, conn.pageInfo.endCursor, stats);

    if (pages % 10 === 0 || !conn.pageInfo.hasNextPage) {
      logger.info({ ...stats, pageSize, pool: client.poolSnapshot().length }, 'Ingest progress');
    }

    staleStreak = inWindow.length === 0 ? staleStreak + 1 : 0;
    cursor = conn.pageInfo.endCursor;

    if (!conn.pageInfo.hasNextPage) break;
    if (staleStreak >= STALE_TOLERANCE) {
      logger.info({ pages }, 'Reached end of analysis window');
      break;
    }
    if (opts.maxPRs && collected.length >= opts.maxPRs) {
      logger.info({ maxPRs: opts.maxPRs }, 'Hit configured PR cap');
      break;
    }
    // Cost headroom: grow the page back up when the budget is comfortable.
    const cost = result.rateLimit?.cost ?? 1;
    if (cost <= 1 && pageSize < 50) pageSize = Math.min(50, pageSize + 10);
  }

  return {
    prs: collected,
    stats: { pages, prs: collected.length, costSpent: client.totalCost, remaining, elapsedMs: Date.now() - started },
    lastCursor: cursor,
  };
}
