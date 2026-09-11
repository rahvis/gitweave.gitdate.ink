import { getEnv, resolveTokens, type Env } from '@gitweave/config';
import { GitHubGraphQLClient, fetchMergedPRs, logger } from '@gitweave/github';
import {
  connect, ensureIndexes, upsertPullRequests, saveSyncState, getSyncState, countPullRequests,
} from '@gitweave/db';
import type { PullRequestRecord } from '@gitweave/types';

export interface SyncResult {
  repo: string;
  prsIngested: number;
  pages: number;
  costSpent: number;
  elapsedMs: number;
  totalInDb: number;
}

export function windowStartISO(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/**
 * Incremental by default. Every page's cursor is persisted before the next
 * request, so a crash resumes exactly where it stopped rather than from zero —
 * which matters when a full backfill is ~300 requests over ~40 minutes.
 */
export async function syncRepo(
  env: Env = getEnv(),
  opts: { days?: number; maxPRs?: number; resume?: boolean; onProgress?: () => Promise<void> } = {},
): Promise<SyncResult> {
  const tokens = resolveTokens(env);
  if (tokens.length === 0) {
    throw new Error(
      'No GitHub credentials. Set GITHUB_TOKEN (fine-grained PAT, read-only) '
      + 'or GITHUB_TOKENS for a pooled backfill. See .env.example.',
    );
  }

  const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;
  const days = opts.days ?? env.ANALYSIS_WINDOW_DAYS;
  const maxPRs = opts.maxPRs ?? env.BACKFILL_MAX_PRS;
  const since = windowStartISO(days);
  const jobType = opts.resume ? 'backfill' : 'incremental';

  const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);
  await ensureIndexes(db);

  const prior = opts.resume ? await getSyncState(db, repo, 'backfill') : null;
  const startCursor = prior?.status === 'running' ? prior.cursor : null;
  if (startCursor) logger.info({ cursor: startCursor.slice(0, 24) }, 'Resuming from saved cursor');

  const client = new GitHubGraphQLClient({
    tokens,
    endpoint: env.GITHUB_GRAPHQL_URL,
    concurrency: env.INGEST_CONCURRENCY,
    maxRetries: env.INGEST_MAX_RETRIES,
    backoffBaseMs: env.INGEST_BACKOFF_BASE_MS,
    rateLimitBuffer: env.INGEST_RATE_LIMIT_BUFFER,
  });

  logger.info(
    { repo, days, since, tokens: client.poolSize, maxPRs: maxPRs || 'unlimited' },
    'Starting GitHub sync',
  );

  await saveSyncState(db, {
    repo, jobType, cursor: startCursor, lastRunAt: new Date().toISOString(),
    lastMergedAtSeen: null, pagesFetched: 0, prsIngested: 0, status: 'running',
  });

  let ingested = 0;
  try {
    const { stats } = await fetchMergedPRs(client, {
      owner: env.TARGET_REPO_OWNER,
      name: env.TARGET_REPO_NAME,
      sinceISO: since,
      pageSize: env.INGEST_PAGE_SIZE,
      maxPRs: maxPRs || undefined,
      startCursor,
      // Persist each page as it lands — never hold 15k PRs in memory, and
      // never lose 40 minutes of work to one transient failure.
      onPage: async (prs: PullRequestRecord[], cursor, pageStats) => {
        if (prs.length > 0) {
          await upsertPullRequests(db, prs);
          ingested += prs.length;
        }
        // A cold backfill takes ~45 minutes. Materialising periodically means
        // the dashboard fills in progressively instead of showing an empty
        // state for the whole run.
        if (opts.onProgress && pageStats.pages % 40 === 0) {
          await opts.onProgress();
        }
        await saveSyncState(db, {
          repo, jobType, cursor,
          lastRunAt: new Date().toISOString(),
          lastMergedAtSeen: prs[prs.length - 1]?.mergedAt ?? null,
          pagesFetched: pageStats.pages,
          prsIngested: ingested,
          status: 'running',
        });
      },
    });

    const totalInDb = await countPullRequests(db, repo);
    await saveSyncState(db, {
      repo, jobType, cursor: null, lastRunAt: new Date().toISOString(),
      lastMergedAtSeen: null, pagesFetched: stats.pages, prsIngested: ingested, status: 'complete',
    });

    logger.info(
      { repo, ingested, pages: stats.pages, cost: stats.costSpent, minutes: (stats.elapsedMs / 60000).toFixed(1), totalInDb },
      'Sync complete',
    );
    return { repo, prsIngested: ingested, pages: stats.pages, costSpent: stats.costSpent, elapsedMs: stats.elapsedMs, totalInDb };
  } catch (err) {
    await saveSyncState(db, {
      repo, jobType, cursor: null, lastRunAt: new Date().toISOString(),
      lastMergedAtSeen: null, pagesFetched: 0, prsIngested: ingested,
      status: 'failed', error: (err as Error).message,
    });
    throw err;
  }
}
