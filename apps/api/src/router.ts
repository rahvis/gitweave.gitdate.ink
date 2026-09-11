import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { loadMetrics, listMetricWindows, getSyncState, countPullRequests, type Db } from '@gitweave/db';
import { buildOwnershipTreemap, rescore } from '@gitweave/core';
import { DEFAULT_WEIGHTS, WeightsSchema, type DashboardPayload } from '@gitweave/types';
import { TTLCache } from './cache.js';

export interface Context { db: Db; repo: string; cache: TTLCache<DashboardPayload> }

const t = initTRPC.context<Context>().create();

const WindowInput = z.object({
  windowDays: z.number().int().positive().default(90),
  limit: z.number().int().min(1).max(500).default(60),
});

async function getPayload(ctx: Context, windowDays: number): Promise<DashboardPayload> {
  const key = `${ctx.repo}:${windowDays}`;
  const cached = ctx.cache.get(key);
  if (cached) return cached;

  const doc = await loadMetrics(ctx.db, ctx.repo, windowDays);
  if (!doc) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `No materialised metrics for ${ctx.repo} @ ${windowDays}d. Run the ingest worker or seed the fixture.`,
    });
  }
  const payload: DashboardPayload = { cohort: doc.cohort, engineers: doc.engineers };
  ctx.cache.set(key, payload);
  return payload;
}

export const appRouter = t.router({
  health: t.procedure.query(async ({ ctx }) => ({
    status: 'ok' as const,
    repo: ctx.repo,
    pullRequests: await countPullRequests(ctx.db, ctx.repo),
    windows: await listMetricWindows(ctx.db, ctx.repo),
    sync: await getSyncState(ctx.db, ctx.repo, 'backfill'),
  })),

  /**
   * The single call that paints the dashboard.
   *
   * Reads one pre-computed document — no scoring at request time. `limit`
   * caps how many engineers cross the wire; the client re-ranks within that
   * set when weights change, which is exact for a top-5 view and keeps the
   * payload small enough to hit the sub-2s first-paint budget.
   */
  dashboard: t.procedure.input(WindowInput).query(async ({ ctx, input }) => {
    const payload = await getPayload(ctx, input.windowDays);
    return { cohort: payload.cohort, engineers: payload.engineers.slice(0, input.limit) };
  }),

  /** Server-side re-rank, for parity checking against the client's own maths. */
  ranked: t.procedure
    .input(WindowInput.extend({ weights: WeightsSchema.default(DEFAULT_WEIGHTS) }))
    .query(async ({ ctx, input }) => {
      const payload = await getPayload(ctx, input.windowDays);
      return {
        cohort: payload.cohort,
        engineers: rescore(payload.engineers, input.weights).slice(0, input.limit),
      };
    }),

  engineer: t.procedure
    .input(z.object({ login: z.string().min(1), windowDays: z.number().int().positive().default(90) }))
    .query(async ({ ctx, input }) => {
      const payload = await getPayload(ctx, input.windowDays);
      const found = payload.engineers.find((e) => e.login.toLowerCase() === input.login.toLowerCase());
      if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: `No metrics for ${input.login}` });
      return found;
    }),

  /** Bus-factor view: surfaces where one person owns most of the change. */
  ownership: t.procedure
    .input(z.object({ windowDays: z.number().int().positive().default(90), limit: z.number().int().default(40) }))
    .query(async ({ ctx, input }) => {
      const payload = await getPayload(ctx, input.windowDays);
      return buildOwnershipTreemap(payload.engineers).slice(0, input.limit);
    }),

  windows: t.procedure.query(async ({ ctx }) => listMetricWindows(ctx.db, ctx.repo)),
});

export type AppRouter = typeof appRouter;
