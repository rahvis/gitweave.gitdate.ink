import { describe, expect, it } from 'vitest';
import { computeImpact, rescore } from '../src/engine.js';
import { DEFAULT_WEIGHTS } from '@gitweave/types';
import type { PullRequestRecord } from '@gitweave/types';
import { makePR, ENGINE_OPTS } from './fixtures.js';

const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}T12:00:00Z`;

/**
 * A synthetic cohort with deliberately different *shapes* of contribution,
 * so we can assert the engine distinguishes them rather than just ranking
 * whoever typed the most.
 */
function buildCohort(): PullRequestRecord[] {
  const prs: PullRequestRecord[] = [];

  // ── volumebot: enormous, low-centrality, low-risk output (docs + snapshots)
  for (let i = 0; i < 30; i += 1) {
    prs.push(makePR({
      authorLogin: 'volumebot', mergedByLogin: 'volumebot',
      title: `docs: update page ${i}`,
      mergedAt: day((i % 28) + 1),
      additions: 2000, deletions: 500, changedFiles: 3,
      files: [
        { path: `docs/page-${i}.md`, additions: 1500, deletions: 300 },
        { path: `docs/shared.md`, additions: 500, deletions: 200 },
      ],
    }));
  }

  // ── deepowner: few PRs, but in CODEOWNERS-protected, widely-shared code
  for (let i = 0; i < 12; i += 1) {
    prs.push(makePR({
      authorLogin: 'deepowner', mergedByLogin: 'deepowner',
      title: `fix(hogql): correct planner join ordering ${i}`,
      body: `## Problem\n\n- Queries with three joins produced wrong rows because the planner reordered them.\n- This silently corrupted customer dashboards. See https://github.com/PostHog/posthog/issues/1\n\n| Case | Before | After |\n| --- | --- | --- |\n| 3-join | wrong | right |\n`,
      mergedAt: day(i + 1),
      additions: 12, deletions: 4, changedFiles: 1,
      labels: ['team/product-analytics'],
      files: [{ path: 'posthog/hogql/printer.py', additions: 12, deletions: 4 }],
    }));
  }
  // other people also touch hogql → it becomes central
  for (const who of ['alice', 'bob', 'carol', 'dave']) {
    prs.push(makePR({
      authorLogin: who, mergedByLogin: who,
      files: [{ path: 'posthog/hogql/printer.py', additions: 5, deletions: 1 }],
      mergedAt: day(20),
    }));
  }

  // ── multiplier: modest authorship, enormous consequential review across teams
  for (let i = 0; i < 6; i += 1) {
    prs.push(makePR({
      authorLogin: 'multiplier', mergedByLogin: 'multiplier',
      mergedAt: day(i + 2),
      files: [{ path: 'products/cdp/util.py', additions: 40, deletions: 10 }],
    }));
  }
  const reviewTargets = [
    ['alice', 'products/cdp/a.py'], ['bob', 'products/error_tracking/b.py'],
    ['carol', 'products/experiments/c.py'], ['dave', 'products/surveys/d.py'],
    ['erin', 'products/replay/e.py'], ['frank', 'products/web_analytics/f.py'],
    ['grace', 'products/feature_flags/g.py'], ['heidi', 'products/logs/h.py'],
  ] as const;
  reviewTargets.forEach(([author, path], i) => {
    for (let k = 0; k < 3; k += 1) {
      prs.push(makePR({
        authorLogin: author, mergedByLogin: author,
        mergedAt: day(i + 3),
        files: [{ path, additions: 60, deletions: 20 }],
        commits: [
          { oid: `${i}-${k}-a`, authorLogin: author, committedAt: `2026-07-${String(i + 3).padStart(2, '0')}T09:00:00Z`, message: 'work' },
          { oid: `${i}-${k}-b`, authorLogin: author, committedAt: `2026-07-${String(i + 3).padStart(2, '0')}T11:00:00Z`, message: 'address review' },
        ],
        reviewRequests: [{ requestedLogin: 'multiplier', createdAt: `2026-07-${String(i + 3).padStart(2, '0')}T09:30:00Z` }],
        reviews: [{ reviewerLogin: 'multiplier', state: 'COMMENTED', submittedAt: `2026-07-${String(i + 3).padStart(2, '0')}T10:00:00Z`, bodyLength: 400 }],
        reviewThreads: [{
          id: `th-${i}-${k}`, authorLogin: 'multiplier', path,
          createdAt: `2026-07-${String(i + 3).padStart(2, '0')}T10:00:00Z`,
          isResolved: true, isOutdated: true, commentCount: 3,
        }],
        // plus a bot review that must be ignored entirely
        comments: [{ authorLogin: 'greptile-apps', createdAt: day(i + 3), bodyLength: 900 }],
      }));
    }
  });

  // ── stamper: reviews constantly, but only rubber-stamp approvals
  for (let i = 0; i < 40; i += 1) {
    prs.push(makePR({
      authorLogin: 'alice', mergedByLogin: 'alice',
      mergedAt: day((i % 28) + 1),
      files: [{ path: `products/cdp/file-${i}.py`, additions: 30, deletions: 5 }],
      reviews: [{ reviewerLogin: 'stamper', state: 'APPROVED', submittedAt: day((i % 28) + 1), bodyLength: 3 }],
    }));
  }

  // ── breaker: ships a lot, gets reverted
  for (let i = 0; i < 10; i += 1) {
    prs.push(makePR({
      authorLogin: 'breaker', mergedByLogin: 'breaker',
      title: `feat(ingestion): risky change ${i}`,
      mergedAt: day(i + 1),
      files: [{ path: `products/ingestion/core-${i}.py`, additions: 300, deletions: 50 }],
    }));
    if (i < 6) {
      prs.push(makePR({
        authorLogin: 'alice', mergedByLogin: 'alice',
        title: `Revert "feat(ingestion): risky change ${i}"`,
        mergedAt: day(i + 2),
        files: [{ path: `products/ingestion/core-${i}.py`, additions: 50, deletions: 300 }],
      }));
    }
  }

  // ── bots that must never appear in the cohort
  for (let i = 0; i < 25; i += 1) {
    prs.push(makePR({
      authorLogin: 'stamphog', authorIsBot: true, mergedByLogin: 'stamphog',
      mergedAt: day((i % 28) + 1),
      files: [{ path: `products/cdp/bot-${i}.py`, additions: 200, deletions: 50 }],
    }));
  }

  return prs;
}

const payload = computeImpact(buildCohort(), ENGINE_OPTS);
const byLogin = new Map(payload.engineers.map((e) => [e.login, e]));

describe('computeImpact — cohort composition', () => {
  it('produces a ranked cohort', () => {
    expect(payload.engineers.length).toBeGreaterThan(5);
    const scores = payload.engineers.map((e) => e.impactScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('never puts a bot in the cohort', () => {
    for (const bot of ['stamphog', 'greptile-apps', 'posthog']) {
      expect(byLogin.has(bot), bot).toBe(false);
    }
  });

  it('records which bots it excluded, so the filter is auditable', () => {
    expect(payload.cohort.botsExcluded).toContain('stamphog');
  });
});

describe('the model does not reward volume', () => {
  it('ranks a 12-line fix in shared, protected code above 30 × 2,000-line doc PRs', () => {
    const deep = byLogin.get('deepowner')!;
    const vol = byLogin.get('volumebot')!;
    expect(deep.impactScore).toBeGreaterThan(vol.impactScore);
  });

  it('gives the doc author far less ownership credit despite 10× the lines', () => {
    expect(byLogin.get('deepowner')!.percentiles.ownership)
      .toBeGreaterThan(byLogin.get('volumebot')!.percentiles.ownership);
  });

  it('gives rubber-stamp approvals zero leverage', () => {
    const stamper = byLogin.get('stamper')!;
    expect(stamper.leverage.consequentialThreads).toBe(0);
    expect(stamper.leverage.rubberStampApprovals).toBe(40);
    expect(stamper.impactScore).toBeLessThan(byLogin.get('multiplier')!.impactScore);
  });
});

describe('leverage is visible', () => {
  const m = byLogin.get('multiplier')!;
  it('counts only review that changed code', () => {
    expect(m.leverage.consequentialThreads).toBe(24);
  });
  it('counts distinct authors and areas unblocked', () => {
    expect(m.leverage.distinctAuthorsReviewed).toBe(8);
    expect(m.leverage.distinctAreasReviewed).toBeGreaterThanOrEqual(8);
  });
  it('measures median unblock latency from the request event', () => {
    expect(m.leverage.medianUnblockHours).toBeCloseTo(0.5, 1);
  });
  it('labels the archetype as Multiplier', () => {
    expect(m.archetype).toBe('Multiplier');
  });
  it('ranks the multiplier above the high-volume doc author', () => {
    expect(m.impactScore).toBeGreaterThan(byLogin.get('volumebot')!.impactScore);
  });
});

describe('reliability tempers but never manufactures rank', () => {
  const breaker = byLogin.get('breaker')!;
  it('detects reverts and attributes them to the original author', () => {
    expect(breaker.reliability.reverts).toBe(6);
  });
  it('applies a penalty modifier', () => {
    expect(breaker.reliability.modifier).toBeLessThan(1.10);
  });
  it('keeps the modifier inside its configured floor and ceiling', () => {
    for (const e of payload.engineers) {
      expect(e.reliability.modifier).toBeGreaterThanOrEqual(0.85);
      expect(e.reliability.modifier).toBeLessThanOrEqual(1.0);
    }
  });

  it('never rewards — a clean record earns 1.00, not a bonus', () => {
    const clean = payload.engineers.filter(
      (e) => e.reliability.reverts === 0 && e.reliability.rapidFixFollowOns === 0,
    );
    expect(clean.length).toBeGreaterThan(0);
    for (const e of clean) expect(e.reliability.modifier).toBe(1.0);
  });
});

describe('ownership and archetypes', () => {
  it('identifies a surface the deep owner actually owns', () => {
    const deep = byLogin.get('deepowner')!;
    const owned = deep.ownership.ownedSurfaces.find((s) => s.area === 'core/hogql');
    expect(owned).toBeDefined();
    expect(owned!.share).toBeGreaterThan(0.5);
  });
  it('labels the deep specialist as a Deep Owner, not a low performer', () => {
    expect(byLogin.get('deepowner')!.archetype).toBe('Deep Owner');
  });
  it('actually detects the problem statements on their PRs', () => {
    // Guards against the field-name drift that made this assertion inert.
    const deep = byLogin.get('deepowner')!;
    expect(deep.problemShaping.problemStatementRate).toBe(1);
    expect(deep.problemShaping.avgProblemQuality).toBeGreaterThan(0.7);
  });
  it('credits blast-radius work', () => {
    expect(byLogin.get('deepowner')!.ownership.criticalPathPRs).toBe(12);
    expect(byLogin.get('volumebot')!.ownership.criticalPathPRs).toBe(0);
  });
});

describe('every score is explainable', () => {
  it('gives every engineer a why-sentence with real content', () => {
    for (const e of payload.engineers) {
      expect(e.whySentence.length).toBeGreaterThan(10);
      expect(e.whySentence).not.toMatch(/undefined|NaN|\[object/);
    }
  });
  it('gives every ranked engineer drill-through evidence', () => {
    for (const e of payload.engineers.slice(0, 5)) {
      expect(e.evidence.length).toBeGreaterThan(0);
      expect(e.evidence[0]!.url).toMatch(/^https:\/\/github\.com\//);
      expect(e.evidence[0]!.reasons.length).toBeGreaterThan(0);
    }
  });
  it('names the owned surface in the deep owner\'s why-sentence', () => {
    expect(byLogin.get('deepowner')!.whySentence).toContain('core/hogql');
  });
  /**
   * Regression: the score is presented as "out of 100", and a reader will
   * assume that. A reliability ceiling of 1.10 multiplied the top engineer's
   * 96.7 weighted percentile to 102 on live data — a number that quietly
   * contradicts the scale it is shown on.
   */
  it('never exceeds 100 — the score is presented out of 100 and must behave like it', () => {
    for (const e of payload.engineers) {
      expect(e.impactScore).toBeLessThanOrEqual(100);
      expect(e.impactScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps rescored values bounded under any weighting', () => {
    for (const w of [
      { ownership: 1, leverage: 0, reach: 0, initiative: 0, problemShaping: 0 },
      { ownership: 0, leverage: 1, reach: 0, initiative: 0, problemShaping: 0 },
      { ownership: 0.2, leverage: 0.2, reach: 0.2, initiative: 0.2, problemShaping: 0.2 },
      { ownership: 99, leverage: 1, reach: 1, initiative: 1, problemShaping: 1 },
    ]) {
      for (const e of rescore(payload.engineers, w)) {
        expect(e.impactScore).toBeLessThanOrEqual(100);
        expect(e.impactScore).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('produces finite, in-range percentiles for everyone', () => {
    for (const e of payload.engineers) {
      for (const v of Object.values(e.percentiles)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(Number.isFinite(e.impactScore)).toBe(true);
    }
  });
  it('flags low-volume contributors rather than silently burying them', () => {
    const lowVol = payload.engineers.find((e) => e.reliability.mergedPRs < 5);
    if (lowVol) expect(lowVol.confidence).toBe('low');
  });
});

describe('rescore — the weight sliders', () => {
  it('re-ranks without recomputing anything', () => {
    const leverageHeavy = rescore(payload.engineers, {
      ownership: 0.05, leverage: 0.80, reach: 0.05, initiative: 0.05, problemShaping: 0.05,
    });
    expect(leverageHeavy[0]!.login).toBe('multiplier');
  });

  it('shifts the top slot when ownership is weighted instead', () => {
    const ownershipHeavy = rescore(payload.engineers, {
      ownership: 0.80, leverage: 0.05, reach: 0.05, initiative: 0.05, problemShaping: 0.05,
    });
    expect(ownershipHeavy[0]!.login).not.toBe('multiplier');
  });

  it('normalises arbitrary weights so the score stays comparable', () => {
    const doubled = rescore(payload.engineers, {
      ownership: 0.56, leverage: 0.60, reach: 0.36, initiative: 0.28, problemShaping: 0.20,
    });
    const base = rescore(payload.engineers, DEFAULT_WEIGHTS);
    expect(doubled.map((e) => e.login)).toEqual(base.map((e) => e.login));
    expect(doubled[0]!.impactScore).toBeCloseTo(base[0]!.impactScore, 6);
  });
});

describe('cohort summary', () => {
  it('reports the window and volumes the UI shows', () => {
    expect(payload.cohort.repo).toBe('PostHog/posthog');
    expect(payload.cohort.windowDays).toBe(90);
    expect(payload.cohort.totalMergedPRs).toBeGreaterThan(100);
    expect(payload.cohort.activeEngineers).toBe(payload.engineers.length);
  });
  it('reports a median time-to-merge', () => {
    expect(payload.cohort.medianTimeToMergeHours).toBeGreaterThan(0);
  });
});

describe('agent-era attribution end to end', () => {
  it('credits the human, counts the PR, and reports agent share neutrally', () => {
    const prs = [
      ...Array.from({ length: 5 }, (_, i) => makePR({
        authorLogin: 'posthog', authorIsBot: true,
        headRefName: 'posthog-self-driving/auto',
        mergedByLogin: 'charlesvien',
        mergedAt: day(i + 1),
        files: [{ path: `products/desktop/x-${i}.tsx`, additions: 50, deletions: 5 }],
        commits: [
          { oid: `b${i}`, authorLogin: 'posthog', committedAt: day(i + 1), message: 'auto' },
          { oid: `h${i}`, authorLogin: 'charlesvien', committedAt: day(i + 1), message: 'fix it properly' },
        ],
      })),
      ...Array.from({ length: 5 }, (_, i) => makePR({
        authorLogin: 'charlesvien', mergedByLogin: 'charlesvien',
        mergedAt: day(i + 10),
        files: [{ path: `products/desktop/y-${i}.tsx`, additions: 50, deletions: 5 }],
      })),
    ];
    const out = computeImpact(prs, ENGINE_OPTS);
    const charles = out.engineers.find((e) => e.login === 'charlesvien')!;

    expect(charles).toBeDefined();
    expect(out.engineers.some((e) => e.login === 'posthog')).toBe(false);
    expect(charles.reliability.mergedPRs).toBe(10);            // nothing erased
    expect(charles.agent.agentStewardedMerges).toBe(5);
    expect(charles.agent.commitsIntoAgentPRs).toBe(5);
    expect(charles.agent.agentSharePct).toBeCloseTo(50, 5);    // reported, not scored
    expect(out.cohort.agentMergedPRs).toBe(5);
  });
});

describe('degenerate inputs', () => {
  it('handles an empty dataset without throwing', () => {
    const out = computeImpact([], ENGINE_OPTS);
    expect(out.engineers).toEqual([]);
    expect(out.cohort.activeEngineers).toBe(0);
  });
  it('handles a PR with no files', () => {
    const out = computeImpact([makePR({ files: [], changedFiles: 0 })], ENGINE_OPTS);
    expect(out.engineers).toHaveLength(1);
    expect(Number.isFinite(out.engineers[0]!.impactScore)).toBe(true);
  });
  it('ignores PRs outside the analysis window', () => {
    const out = computeImpact([makePR({ mergedAt: '2020-01-01T00:00:00Z' })], ENGINE_OPTS);
    expect(out.engineers).toEqual([]);
  });
});

describe('a repo-wide sweep is not breadth (live-data regression)', () => {
  /**
   * Observed on live data: an engineer showed "spans 75 product areas" from
   * codemod-style PRs that touched one file in each of 75 directories.
   * Counting the SET of areas touched cannot tell a sweep from real breadth;
   * weighting each area by its share of the PR's files can.
   */
  const areas = Array.from({ length: 60 }, (_, i) => `area_${i}`);

  const sweeper = Array.from({ length: 4 }, (_, k) => makePR({
    authorLogin: 'sweeper', mergedByLogin: 'sweeper', mergedAt: day(k + 1),
    title: `chore: repo-wide lint pass ${k}`,
    files: areas.map((a) => ({ path: `products/${a}/lint.py`, additions: 1, deletions: 1 })),
  }));

  const focused = Array.from({ length: 12 }, (_, k) => makePR({
    authorLogin: 'focused', mergedByLogin: 'focused', mergedAt: day(k + 1),
    files: [{ path: `products/${areas[k % 5]}/feature.py`, additions: 120, deletions: 30 }],
  }));

  const out = computeImpact([...sweeper, ...focused], ENGINE_OPTS);
  const sweep = out.engineers.find((e) => e.login === 'sweeper')!;
  const focus = out.engineers.find((e) => e.login === 'focused')!;

  it('does not credit a sweep with 60 product areas', () => {
    expect(sweep.reach.productAreas).toBeLessThan(10);
  });

  it('credits genuine multi-area work', () => {
    expect(focus.reach.productAreas).toBe(5);
  });

  it('ranks real breadth above sweep breadth', () => {
    expect(focus.percentiles.reach).toBeGreaterThan(sweep.percentiles.reach);
  });

  it('does not let a sweep claim to have founded the areas it brushed', () => {
    expect(sweep.initiative.newAreasFounded).toBe(0);
  });
});

describe('why-sentences read as English', () => {
  it('never emits a malformed clause join', () => {
    for (const e of payload.engineers) {
      expect(e.whySentence).not.toMatch(/ at unblock/);
      expect(e.whySentence).not.toMatch(/;\s*\./);
      expect(e.whySentence).not.toMatch(/,\s*\./);
      expect(e.whySentence).toMatch(/[.!]$/);
      expect(e.whySentence[0]).toBe(e.whySentence[0]!.toUpperCase());
    }
  });
  it('pluralises correctly', () => {
    const one = payload.engineers.find((e) => e.leverage.consequentialThreads === 1);
    if (one) expect(one.whySentence).not.toContain('1 review threads');
  });
});
