import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getEnv } from '@gitweave/config';
import { logger } from '@gitweave/github';
import { connect, countPullRequests } from '@gitweave/db';
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
   * Boot backfill is idempotent: CI sets BACKFILL_ON_BOOT on every deploy, so
   * the worker — not the pipeline — decides whether a ~45-minute full sync is
   * actually needed. An empty store means a fresh droplet; a populated one is
   * left to the 15-minute incremental cron.
   */
  if (env.BACKFILL_ON_BOOT) {
    const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);
    const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;
    const existing = await countPullRequests(db, repo);
    const forced = process.env.FORCE_BACKFILL === 'true';
    if (existing === 0 || forced) {
      await queue.add('backfill', { resume: true }, { removeOnComplete: 20 });
      logger.info({ existing, forced }, 'Backfill enqueued');
    } else {
      logger.info({ existing }, 'Store already populated — skipping boot backfill');
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
