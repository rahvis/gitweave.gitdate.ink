import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getEnv } from '@gitweave/config';
import { logger } from '@gitweave/github';
import { connect, countPullRequests, getSyncState } from '@gitweave/db';
import { syncRepo } from './sync.js';
import { materialise } from './materialise.js';

const env = getEnv();
const QUEUE = 'gitweave-sync';

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue(QUEUE, { connection });

interface SyncJobData { resume?: boolean; days?: number; maxPRs?: number }

const worker = new Worker<SyncJobData>(
  QUEUE,
  async (job: Job<SyncJobData>) => {
    logger.info({ job: job.name, data: job.data }, 'Job started');
    const result = await syncRepo(env, {
      days: job.data.days,
      maxPRs: job.data.maxPRs,
      resume: job.data.resume ?? true,
      onProgress: async () => {
        try {
          await materialise(env, [90]);
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'Progressive materialise failed — continuing sync');
        }
      },
    });
    await materialise(env);
    return result;
  },
  { connection, concurrency: 1 }, // one sync at a time; parallelism lives in the token pool
);

worker.on('completed', (job) => logger.info({ job: job.id }, 'Job completed'));
worker.on('failed', (job, err) => logger.error({ job: job?.id, err: err.message }, 'Job failed'));

async function main(): Promise<void> {
  await queue.upsertJobScheduler(
    'incremental-sync',
    { pattern: env.SYNC_CRON },
    { name: 'sync', data: { resume: false }, opts: { removeOnComplete: 20, removeOnFail: 50 } },
  );
  logger.info({ cron: env.SYNC_CRON }, 'Incremental sync scheduled');

  /**
   * Boot backfill is idempotent AND resumable.
   *
   * CI sets BACKFILL_ON_BOOT on every deploy, so the worker — not the
   * pipeline — decides whether a ~45-minute full sync is needed. The test is
   * "did the last backfill reach `complete`", NOT "is there any data":
   * deploying mid-backfill restarts this container, and a data-presence check
   * would treat a half-finished window as done and abandon it for good.
   *
   * `resume: true` continues from the checkpointed cursor, so an interrupted
   * backfill costs seconds, not a restart from page one.
   */
  if (env.BACKFILL_ON_BOOT) {
    const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);
    const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;
    const state = await getSyncState(db, repo, 'backfill');
    const existing = await countPullRequests(db, repo);
    const forced = process.env.FORCE_BACKFILL === 'true';
    if (state?.status !== 'complete' || forced) {
      await queue.add('backfill', { resume: true }, { removeOnComplete: 20 });
      logger.info(
        { existing, lastStatus: state?.status ?? 'none', resumeCursor: Boolean(state?.cursor), forced },
        'Backfill enqueued',
      );
    } else {
      logger.info({ existing }, 'Backfill already complete — incremental cron will keep it current');
    }
  }
  logger.info('Ingest worker ready');
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Ingest worker failed to start');
  process.exit(1);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    logger.info({ sig }, 'Shutting down ingest worker');
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  });
}
