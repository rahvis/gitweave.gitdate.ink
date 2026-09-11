import Fastify from 'fastify';
import cors from '@fastify/cors';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { getEnv } from '@gitweave/config';
import { connect, ensureIndexes, loadMetrics } from '@gitweave/db';
import type { DashboardPayload } from '@gitweave/types';
import { appRouter, type Context } from './router.js';
import { TTLCache } from './cache.js';

const env = getEnv();
const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;

async function main(): Promise<void> {
  const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);
  await ensureIndexes(db);

  const cache = new TTLCache<DashboardPayload>(env.REDIS_CACHE_TTL_SECONDS * 1000);
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  await app.register(cors, { origin: true, credentials: true });

  app.all('/trpc/*', async (req, reply) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const response = await fetchRequestHandler({
      endpoint: '/trpc',
      req: new Request(url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      }),
      router: appRouter,
      createContext: (): Context => ({ db, repo, cache }),
      onError: ({ error, path }) => app.log.error({ path, err: error.message }, 'tRPC error'),
    });
    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));
    return reply.send(await response.text());
  });

  // Plain REST mirrors, so the data is inspectable with curl and exportable.
  app.get('/healthz', async () => {
    const doc = await loadMetrics(db, repo, env.ANALYSIS_WINDOW_DAYS);
    return {
      status: doc ? 'ok' : 'degraded',
      repo,
      metricsComputedAt: doc?.computedAt ?? null,
      engineers: doc?.engineers.length ?? 0,
    };
  });

  app.get<{ Querystring: { window?: string; limit?: string } }>('/api/dashboard', async (req, reply) => {
    const windowDays = Number(req.query.window ?? env.ANALYSIS_WINDOW_DAYS);
    const limit = Number(req.query.limit ?? 60);
    const doc = await loadMetrics(db, repo, windowDays);
    if (!doc) return reply.status(404).send({ error: `No metrics for ${repo} @ ${windowDays}d` });
    return { cohort: doc.cohort, engineers: doc.engineers.slice(0, limit) };
  });

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info({ repo, port: env.API_PORT }, 'GitWeave API ready');
}

main().catch((err) => {
  console.error('API failed to start:', err);
  process.exit(1);
});
