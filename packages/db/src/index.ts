import { MongoClient, type Collection, type Db } from 'mongodb';

export type { Db, Collection } from 'mongodb';
import type { CohortSummary, EngineerMetrics, PullRequestRecord } from '@gitweave/types';

/**
 * Native driver rather than an ODM.
 *
 * GitWeave's access pattern is ~90% bulk upserts and aggregation pipelines,
 * which is precisely where an ODM adds overhead and abstraction leakage
 * without buying anything — schema discipline already comes from Zod in
 * @gitweave/types. Keeping all Mongo access behind this package also means the
 * store is swappable (e.g. FerretDB) without touching the engine.
 */

export interface StoredPR extends PullRequestRecord { _id?: string }

export interface SyncState {
  _id: string;
  repo: string;
  jobType: 'backfill' | 'incremental';
  cursor: string | null;
  lastRunAt: string;
  lastMergedAtSeen: string | null;
  pagesFetched: number;
  prsIngested: number;
  status: 'idle' | 'running' | 'failed' | 'complete';
  error?: string;
}

export interface MetricsDoc {
  _id: string;
  repo: string;
  windowDays: number;
  computedAt: string;
  cohort: CohortSummary;
  engineers: EngineerMetrics[];
}

export interface Collections {
  pullRequests: Collection<StoredPR>;
  syncState: Collection<SyncState>;
  engineerMetrics: Collection<MetricsDoc>;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connect(uri: string, dbName: string): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri, {
    maxPoolSize: 20,
    retryWrites: true,
    serverSelectionTimeoutMS: 15_000,
  });
  await client.connect();
  db = client.db(dbName);
  return db;
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}

export function collections(database: Db): Collections {
  return {
    pullRequests: database.collection<StoredPR>('pull_requests'),
    syncState: database.collection<SyncState>('sync_state'),
    engineerMetrics: database.collection<MetricsDoc>('engineer_metrics'),
  };
}

export async function ensureIndexes(database: Db): Promise<void> {
  const c = collections(database);
  await Promise.all([
    c.pullRequests.createIndex({ repo: 1, number: 1 }, { unique: true }),
    c.pullRequests.createIndex({ repo: 1, mergedAt: -1 }),
    c.pullRequests.createIndex({ repo: 1, authorLogin: 1 }),
    c.syncState.createIndex({ repo: 1, jobType: 1 }, { unique: true }),
    c.engineerMetrics.createIndex({ repo: 1, windowDays: 1 }, { unique: true }),
  ]);
}

/** Unordered bulk upsert — a single duplicate must not abort the batch. */
export async function upsertPullRequests(
  database: Db, prs: PullRequestRecord[], batchSize = 500,
): Promise<number> {
  if (prs.length === 0) return 0;
  const col = collections(database).pullRequests;
  let written = 0;
  for (let i = 0; i < prs.length; i += batchSize) {
    const slice = prs.slice(i, i + batchSize);
    const ops = slice.map((pr) => ({
      replaceOne: {
        filter: { repo: pr.repo, number: pr.number },
        replacement: pr as StoredPR,
        upsert: true,
      },
    }));
    const res = await col.bulkWrite(ops, { ordered: false });
    written += (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0) + (res.matchedCount ?? 0);
  }
  return written;
}

export async function loadPullRequests(
  database: Db, repo: string, sinceISO: string,
): Promise<PullRequestRecord[]> {
  return collections(database).pullRequests
    .find({ repo, mergedAt: { $gte: sinceISO } }, { projection: { _id: 0 } })
    .toArray() as unknown as Promise<PullRequestRecord[]>;
}

export async function countPullRequests(database: Db, repo: string): Promise<number> {
  return collections(database).pullRequests.countDocuments({ repo });
}

export async function saveMetrics(
  database: Db, repo: string, windowDays: number,
  cohort: CohortSummary, engineers: EngineerMetrics[],
): Promise<void> {
  const _id = `${repo}:${windowDays}`;
  await collections(database).engineerMetrics.replaceOne(
    { _id },
    { repo, windowDays, computedAt: new Date().toISOString(), cohort, engineers },
    { upsert: true },
  );
}

export async function loadMetrics(
  database: Db, repo: string, windowDays: number,
): Promise<MetricsDoc | null> {
  return collections(database).engineerMetrics.findOne({ _id: `${repo}:${windowDays}` });
}

export async function listMetricWindows(database: Db, repo: string): Promise<number[]> {
  const docs = await collections(database).engineerMetrics
    .find({ repo }, { projection: { windowDays: 1 } }).toArray();
  return docs.map((d) => d.windowDays).sort((a, b) => a - b);
}

export async function getSyncState(
  database: Db, repo: string, jobType: SyncState['jobType'],
): Promise<SyncState | null> {
  return collections(database).syncState.findOne({ repo, jobType });
}

export async function saveSyncState(database: Db, state: Omit<SyncState, '_id'>): Promise<void> {
  await collections(database).syncState.replaceOne(
    { repo: state.repo, jobType: state.jobType },
    { ...state },
    { upsert: true },
  );
}
