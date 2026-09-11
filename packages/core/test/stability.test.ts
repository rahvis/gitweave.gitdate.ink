import { describe, expect, it } from 'vitest';
import { computeImpact } from '../src/engine.js';
import {
  computeRankStability, computeFactDistributions, computeVolumeBenchmark, FACT_SPEC,
} from '../src/stability.js';
import { makePR, ENGINE_OPTS } from './fixtures.js';
import type { PullRequestRecord } from '@gitweave/types';

const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}T12:00:00Z`;

function cohort(): PullRequestRecord[] {
  const prs: PullRequestRecord[] = [];
  // A dominant all-rounder who should be rank-stable.
  for (let i = 0; i < 20; i += 1) {
    prs.push(makePR({
      authorLogin: 'dominant', mergedByLogin: 'dominant', mergedAt: day((i % 28) + 1),
      // makePR's default commit is authored by 'alice'; the engine credits
      // co-committers, so leaving it would hand alice every PR in the fixture.
      commits: [{ oid: `d${i}`, authorLogin: 'dominant', committedAt: day((i % 28) + 1), message: 'work' }],
      body: '## Problem\n\n- A real problem, explained at length so the quality heuristic fires.\n- See https://example.com/1\n',
      files: [
        { path: `products/area${i % 6}/f${i}.py`, additions: 60, deletions: 10 },
        { path: 'posthog/hogql/printer.py', additions: 20, deletions: 5 },
      ],
    }));
  }
  // Someone who only reviews — strong on one axis, weak elsewhere.
  for (let i = 0; i < 12; i += 1) {
    prs.push(makePR({
      authorLogin: `author${i}`, mergedByLogin: `author${i}`, mergedAt: day((i % 28) + 1),
      files: [{ path: `products/area${i % 6}/g${i}.py`, additions: 40, deletions: 5 }],
      commits: [
        { oid: `c${i}a`, authorLogin: `author${i}`, committedAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T09:00:00Z`, message: 'x' },
        { oid: `c${i}b`, authorLogin: `author${i}`, committedAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T13:00:00Z`, message: 'fix review' },
      ],
      reviewThreads: [{
        id: `t${i}`, authorLogin: 'reviewer', path: `products/area${i % 6}/g${i}.py`,
        createdAt: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        isResolved: true, isOutdated: true, commentCount: 2,
      }],
    }));
  }
  // A high-volume, low-leverage engineer: the counting champion.
  for (let i = 0; i < 60; i += 1) {
    prs.push(makePR({
      authorLogin: 'volume', mergedByLogin: 'volume', mergedAt: day((i % 28) + 1),
      commits: [{ oid: `v${i}`, authorLogin: 'volume', committedAt: day((i % 28) + 1), message: 'docs' }],
      files: [{ path: `docs/page${i}.md`, additions: 400, deletions: 100 }],
    }));
  }
  return prs;
}

const payload = computeImpact(cohort(), ENGINE_OPTS);

describe('rank stability', () => {
  it('is deterministic — the same input always yields the same bands', () => {
    const a = computeRankStability(payload.engineers, 300);
    const b = computeRankStability(payload.engineers, 300);
    for (const [login, s] of a) {
      expect(b.get(login)).toEqual(s);
    }
  });

  it('produces a band that contains the median rank', () => {
    for (const e of payload.engineers) {
      const s = e.stability;
      expect(s.bandLow).toBeLessThanOrEqual(s.medianRank);
      expect(s.medianRank).toBeLessThanOrEqual(s.bandHigh);
      expect(s.bandLow).toBeGreaterThanOrEqual(1);
      expect(s.bandHigh).toBeLessThanOrEqual(payload.engineers.length);
    }
  });

  it('keeps probabilities in [0,1]', () => {
    for (const e of payload.engineers) {
      expect(e.stability.topFiveProbability).toBeGreaterThanOrEqual(0);
      expect(e.stability.topFiveProbability).toBeLessThanOrEqual(1);
    }
  });

  it('rates a dominant all-rounder as more rank-stable than a one-axis specialist', () => {
    const dominant = payload.engineers.find((e) => e.login === 'dominant')!;
    const volume = payload.engineers.find((e) => e.login === 'volume')!;
    expect(dominant.stability.topFiveProbability).toBeGreaterThan(volume.stability.topFiveProbability);
    // A stable name has a narrow band; an unstable one swings.
    expect(dominant.stability.bandHigh - dominant.stability.bandLow)
      .toBeLessThanOrEqual(volume.stability.bandHigh - volume.stability.bandLow);
  });

  it('handles an empty cohort', () => {
    expect(computeRankStability([]).size).toBe(0);
  });
});

describe('fact distributions', () => {
  const dists = computeFactDistributions(payload.engineers);

  it('emits one row per dimension', () => {
    expect(dists).toHaveLength(FACT_SPEC.length);
  });

  it('sorts values ascending and orders the quantiles', () => {
    for (const d of dists) {
      expect(d.values).toEqual([...d.values].sort((a, b) => a - b));
      expect(d.median).toBeLessThanOrEqual(d.p90);
      expect(d.p90).toBeLessThanOrEqual(d.p95);
      expect(d.p95).toBeLessThanOrEqual(d.max);
    }
  });

  it('counts the zero pile rather than letting it render as a blob', () => {
    for (const d of dists) {
      expect(d.zeroCount).toBe(d.values.filter((v) => v <= 0).length);
    }
  });

  it('names the field leader and their impact rank', () => {
    for (const d of dists) {
      expect(d.leaderLogin).toBeTruthy();
      expect(d.leaderImpactRank).toBeGreaterThan(0);
      expect(d.leaderValue).toBe(d.max);
    }
  });

  /**
   * Guards the three fields rejected during design because they carry no
   * information on real data: problemStatementRate and followThrough are
   * constant, and filesCreated tracks raw output volume.
   */
  it('plots no metric that is a raw-volume proxy or a constant', () => {
    const keys = FACT_SPEC.map((f) => f.label.toLowerCase());
    expect(keys.some((k) => k.includes('new files'))).toBe(false);
    expect(keys.some((k) => k.includes('state the problem'))).toBe(false);
  });
});

describe('volume benchmark', () => {
  it('identifies the highest-volume engineer and their impact rank', () => {
    const b = computeVolumeBenchmark(payload.engineers);
    expect(b).not.toBeNull();
    expect(b!.login).toBe('volume');
    expect(b!.mergedPRs).toBe(60);
  });

  it('shows the counting champion is NOT the most impactful — the whole argument', () => {
    const b = computeVolumeBenchmark(payload.engineers)!;
    expect(b.impactRank).toBeGreaterThan(1);
    expect(payload.engineers[0]!.login).not.toBe('volume');
  });

  it('returns null for an empty cohort', () => {
    expect(computeVolumeBenchmark([])).toBeNull();
  });
});
