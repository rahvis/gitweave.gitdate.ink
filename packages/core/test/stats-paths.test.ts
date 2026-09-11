import { describe, expect, it } from 'vitest';
import { effectiveCount, median, percentileRank, quantile, clamp, isoWeek } from '../src/stats.js';
import { PathClassifier, resolveProductArea, resolveStackZone, resolveTeams } from '../src/paths.js';
import { computeFileCentrality } from '../src/centrality.js';
import { BotClassifier } from '../src/attribution/bots.js';
import { makePR, ENGINE_OPTS } from './fixtures.js';

describe('effectiveCount — why breadth means spread, not a long tail', () => {
  it('gives 5 evenly-spread areas an effective count of 5', () => {
    expect(effectiveCount([20, 20, 20, 20, 20])).toBeCloseTo(5, 5);
  });

  it('gives 96/1/1/1/1 an effective count near 1 despite also touching 5 areas', () => {
    const eff = effectiveCount([96, 1, 1, 1, 1]);
    expect(eff).toBeGreaterThan(1);
    expect(eff).toBeLessThan(1.5);
  });

  it('is zero for no activity', () => {
    expect(effectiveCount([])).toBe(0);
    expect(effectiveCount([0, 0])).toBe(0);
  });
});

describe('percentileRank', () => {
  const cohort = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  it('puts the maximum near 100', () => expect(percentileRank(10, cohort)).toBe(95));
  it('puts the minimum near 0', () => expect(percentileRank(1, cohort)).toBe(5));
  it('puts the middle near 50', () => expect(percentileRank(5, cohort)).toBe(45));
  it('shares rank fairly across ties', () => {
    expect(percentileRank(1, [1, 1, 1, 1])).toBe(50);
  });
  it('returns 50 for a cohort of one', () => expect(percentileRank(7, [7])).toBe(50));
  it('returns 0 for an empty cohort', () => expect(percentileRank(7, [])).toBe(0));
});

describe('median / quantile / clamp / isoWeek', () => {
  it('medians an even-length list', () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it('medians an odd-length list', () => expect(median([3, 1, 2])).toBe(2));
  it('returns 0 for an empty list', () => expect(median([])).toBe(0));
  it('interpolates quantiles', () => expect(quantile([0, 10], 0.5)).toBe(5));
  it('clamps', () => { expect(clamp(5, 0, 1)).toBe(1); expect(clamp(-5, 0, 1)).toBe(0); });
  it('computes ISO weeks', () => expect(isoWeek('2026-08-01T00:00:00Z')).toMatch(/^2026-W\d{2}$/));
});

describe('PathClassifier — blast radius', () => {
  const p = new PathClassifier();
  it('flags PostHog CODEOWNERS-protected paths as high risk', () => {
    expect(p.blastRadius('posthog/hogql/printer.py')).toBe('high');
    expect(p.blastRadius('posthog/clickhouse/migrations/0099_x.py')).toBe('high');
    expect(p.blastRadius('.github/workflows/ci-security.yaml')).toBe('high');
  });
  it('flags migrations and infra anywhere in the tree', () => {
    expect(p.blastRadius('products/cdp/migrations/0001_initial.py')).toBe('high');
    expect(p.blastRadius('rust/capture/src/main.rs')).toBe('high');
  });
  it('downweights docs, snapshots and lockfiles', () => {
    expect(p.blastRadius('docs/intro.md')).toBe('low');
    expect(p.blastRadius('posthog/hogql/test/__snapshots__/test_database.ambr')).toBe('low');
    expect(p.blastRadius('pnpm-lock.yaml')).toBe('low');
  });
  it('lets low-risk win ties — a snapshot inside rust/ is still a snapshot', () => {
    expect(p.blastRadius('rust/x/__snapshots__/a.snap')).toBe('low');
  });
  it('treats ordinary product code as normal', () => {
    expect(p.blastRadius('products/error_tracking/frontend/App.tsx')).toBe('normal');
  });
  it('applies the configured multipliers', () => {
    expect(p.multiplier('posthog/hogql/x.py', 1.6, 0.4)).toBe(1.6);
    expect(p.multiplier('docs/x.md', 1.6, 0.4)).toBe(0.4);
    expect(p.multiplier('products/cdp/x.py', 1.6, 0.4)).toBe(1);
  });
});

describe('taxonomy resolution from the repo\'s own structure', () => {
  it('reads product areas out of products/*', () => {
    expect(resolveProductArea('products/error_tracking/backend/api.py')).toBe('error_tracking');
    expect(resolveProductArea('products/cdp/frontend/X.tsx')).toBe('cdp');
  });
  it('namespaces core and rust subsystems', () => {
    expect(resolveProductArea('posthog/hogql/printer.py')).toBe('core/hogql');
    expect(resolveProductArea('rust/capture/src/main.rs')).toBe('rust/capture');
  });
  it('classifies stack zones by extension, not directory guesswork', () => {
    expect(resolveStackZone('products/cdp/backend/x.py')).toBe('backend');
    expect(resolveStackZone('products/cdp/frontend/X.tsx')).toBe('frontend');
    expect(resolveStackZone('rust/capture/src/main.rs')).toBe('rust');
    expect(resolveStackZone('.github/workflows/ci.yaml')).toBe('infra');
    expect(resolveStackZone('README.md')).toBe('docs');
  });
  it('reads teams from the repo\'s 37 team/* labels', () => {
    expect(resolveTeams(['team/feature-flags', 'feature/desktop', 'team/infra']))
      .toEqual(['feature-flags', 'infra']);
  });
});

describe('file centrality — computed from OTHER people\'s behaviour', () => {
  const bots = new BotClassifier(ENGINE_OPTS.botDenylist);
  it('ranks a widely-shared file above a private corner', () => {
    const shared = 'products/cdp/shared.py';
    const corner = 'products/cdp/corner.py';
    const prs = [
      ...['alice', 'bob', 'carol', 'dave', 'erin'].map((a) =>
        makePR({ authorLogin: a, files: [{ path: shared, additions: 10, deletions: 1 }] })),
      makePR({ authorLogin: 'alice', files: [{ path: corner, additions: 500, deletions: 0 }] }),
    ];
    const c = computeFileCentrality(prs, bots, (pr) => (pr.authorLogin ? [pr.authorLogin] : []));
    // The 500-line private file loses to the 10-line file five people depend on.
    expect(c.get(shared)!.centrality).toBeGreaterThan(c.get(corner)!.centrality);
    expect(c.get(shared)!.distinctAuthors).toBe(5);
  });

  it('excludes bot authors from the centrality denominator', () => {
    const prs = [
      makePR({ authorLogin: 'stamphog', files: [{ path: 'a.py', additions: 1, deletions: 0 }] }),
    ];
    const c = computeFileCentrality(prs, bots, (pr) => (pr.authorLogin ? [pr.authorLogin] : []));
    expect(c.size).toBe(0);
  });
});
