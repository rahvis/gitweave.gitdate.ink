import { getEnv, scoringConfig, type Env } from '@gitweave/config';
import { computeImpact } from '@gitweave/core';
import { connect, loadPullRequests, saveMetrics } from '@gitweave/db';
import { logger } from '@gitweave/github';
import { windowStartISO } from './sync.js';

/**
 * Materialisation stage.
 *
 * The API must never score at request time: at PostHog's volume that would
 * blow the <2s first-paint budget on every load. Scores are computed here and
 * `$merge`d into `engineer_metrics`, so a dashboard request is a single
 * indexed document read.
 */
export async function materialise(
  env: Env = getEnv(),
  windows: number[] = [30, 90, 180],
): Promise<void> {
  const cfg = scoringConfig(env);
  const repo = `${env.TARGET_REPO_OWNER}/${env.TARGET_REPO_NAME}`;
  const db = await connect(env.MONGODB_URI, env.MONGODB_DB_NAME);

  const widest = Math.max(...windows);
  const allPRs = await loadPullRequests(db, repo, windowStartISO(widest));
  logger.info({ repo, prs: allPRs.length, windows }, 'Materialising metrics');

  if (allPRs.length === 0) {
    logger.warn('No pull requests in store — run a sync first');
    return;
  }

  for (const windowDays of windows) {
    const started = Date.now();
    const windowStart = windowStartISO(windowDays);
    const { cohort, engineers } = computeImpact(allPRs, {
      repo,
      windowDays,
      windowStart,
      windowEnd: new Date().toISOString(),
      botDenylist: cfg.botDenylist,
      agentAuthors: cfg.agentAuthors,
      agentBranchPrefixes: cfg.agentBranchPrefixes,
      blastHighMultiplier: cfg.blastRadiusMultiplier,
      blastLowMultiplier: cfg.lowRiskPathMultiplier,
      minPRsForRanking: cfg.minPRsForRanking,
      reliability: cfg.reliability,
      weights: cfg.weights,
    });
    await saveMetrics(db, repo, windowDays, cohort, engineers);
    logger.info(
      {
        windowDays, engineers: engineers.length, prs: cohort.totalMergedPRs,
        agentPRs: cohort.agentMergedPRs, botsExcluded: cohort.botsExcluded.length,
        ms: Date.now() - started,
      },
      'Window materialised',
    );
  }
}
