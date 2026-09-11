#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getEnv } from '@gitweave/config';
import { connect, disconnect, ensureIndexes, upsertPullRequests, countPullRequests, loadPullRequests } from '@gitweave/db';
import { logger } from '@gitweave/github';
import type { PullRequestRecord } from '@gitweave/types';
import { syncRepo, windowStartISO } from './sync.js';
import { materialise } from './materialise.js';

const FIXTURE_PATH = process.env.FIXTURE_PATH ?? '/app/fixtures/posthog-90d.json.gz';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

async function cmdSync(): Promise<void> {
  const env = getEnv();
  const days = Number(arg('days') ?? env.ANALYSIS_WINDOW_DAYS);
  const maxPRs = Number(arg('max') ?? env.BACKFILL_MAX_PRS);
  const result = await syncRepo(env, { days, maxPRs, resume: true });
  logger.info(result, 'Sync finished');
  await materialise(env);
}

async function cmdMaterialise(): Promise<void> {
  await materialise(getEnv());
}

/** Export the ingested window as a committable fixture. */
async function cmdExport(): Promise<void> {
  const env = getEnv();
  const out = arg('out') ?? FIXTURE_PATH;
  const days = Number(arg('days') ?? env.ANALYSIS_WINDOW_DAYS);
  const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;
  const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);
  const prs = await loadPullRequests(db, repo, windowStartISO(days));
  await mkdir(dirname(out), { recursive: true });
  const json = JSON.stringify({ repo, exportedAt: new Date().toISOString(), prs });
  // Raw PRs for a 90-day PostHog window are ~150MB of JSON; gzip makes the
  // fixture committable so a fresh clone has a populated dashboard offline.
  const body = out.endsWith('.gz') ? gzipSync(Buffer.from(json), { level: 9 }) : Buffer.from(json);
  await writeFile(out, body);
  logger.info({ out, prs: prs.length, mb: (body.byteLength / 1e6).toFixed(1) }, 'Fixture exported');
}

/**
 * Seed from the committed fixture.
 *
 * This is why `docker compose up` yields a populated dashboard in ~60s with
 * no GitHub token: the reviewer's link always loads, and live sync layers on
 * top once a credential is present.
 */
async function cmdSeed(): Promise<void> {
  const env = getEnv();
  const path = arg('file') ?? FIXTURE_PATH;
  const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);
  await ensureIndexes(db);
  const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;

  const existing = await countPullRequests(db, repo);
  if (existing > 0 && !process.argv.includes('--force')) {
    logger.info({ existing }, 'Store already populated — skipping seed (use --force to reload)');
    await materialise(env);
    return;
  }

  let raw: string;
  try {
    const buf = await readFile(path);
    raw = path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  } catch {
    logger.warn({ path }, 'No fixture found — start the ingest worker with a GitHub token instead');
    return;
  }
  const parsed = JSON.parse(raw) as { prs: PullRequestRecord[] };
  const written = await upsertPullRequests(db, parsed.prs);
  logger.info({ path, prs: parsed.prs.length, written }, 'Fixture seeded');
  await materialise(env);
}

const COMMANDS: Record<string, () => Promise<void>> = {
  sync: cmdSync,
  materialise: cmdMaterialise,
  materialize: cmdMaterialise,
  export: cmdExport,
  seed: cmdSeed,
};

const command = process.argv[2] ?? 'sync';
const run = COMMANDS[command];
if (!run) {
  console.error(`Unknown command "${command}". Expected one of: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

run()
  .then(async () => { await disconnect(); process.exit(0); })
  .catch(async (err) => {
    logger.error({ err: (err as Error).message }, `Command "${command}" failed`);
    await disconnect();
    process.exit(1);
  });
