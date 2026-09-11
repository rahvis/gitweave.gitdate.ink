import { describe, expect, it } from 'vitest';
import { classifyTitle, plainTitle, describeWork } from '../src/work-profile.js';
import { computeImpact } from '../src/engine.js';
import { makePR, ENGINE_OPTS } from './fixtures.js';

describe('conventional-commit classification', () => {
  // Measured on the live repo: 14,838 of 14,846 merged PRs carry a prefix,
  // so this needs no fuzzy matching.
  it('reads type and scope from real PostHog titles', () => {
    expect(classifyTitle('feat(cohorts): filter cohorts and flags on person.created_at'))
      .toEqual({ type: 'feat', scope: 'cohorts' });
    expect(classifyTitle('fix(desktop): name the project timezone on scout cadences'))
      .toEqual({ type: 'fix', scope: 'desktop' });
    expect(classifyTitle('chore: bump deps')).toEqual({ type: 'chore', scope: null });
    expect(classifyTitle('perf(hogql): faster planner').type).toBe('perf');
  });

  it('handles breaking-change markers', () => {
    expect(classifyTitle('feat(api)!: drop v1 endpoints').type).toBe('feat');
  });

  it('normalises synonyms', () => {
    expect(classifyTitle('bugfix: x').type).toBe('fix');
    expect(classifyTitle('feature: y').type).toBe('feat');
  });

  it('falls back gracefully on an unprefixed title', () => {
    expect(classifyTitle('Just some work').type).toBe('other');
  });

  it('strips the prefix so a title reads as plain English', () => {
    expect(plainTitle('feat(cohorts): filter cohorts and flags'))
      .toBe('Filter cohorts and flags');
    expect(plainTitle('Already plain')).toBe('Already plain');
  });
});

describe('work profile answers "what does this person do?"', () => {
  const prs = [
    ...Array.from({ length: 8 }, (_, i) => makePR({
      authorLogin: 'dana', mergedByLogin: 'dana',
      title: `feat(feature_flags): flag capability ${i}`,
      mergedAt: `2026-07-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
      commits: [{ oid: `f${i}`, authorLogin: 'dana', committedAt: `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00Z`, message: 'x' }],
      files: [{ path: `products/feature_flags/f${i}.py`, additions: 200, deletions: 20 }],
    })),
    ...Array.from({ length: 5 }, (_, i) => makePR({
      authorLogin: 'dana', mergedByLogin: 'dana',
      title: `fix(feature_flags): correct edge case ${i}`,
      mergedAt: `2026-07-${String(i + 10).padStart(2, '0')}T12:00:00Z`,
      commits: [{ oid: `x${i}`, authorLogin: 'dana', committedAt: `2026-07-${String(i + 10).padStart(2, '0')}T10:00:00Z`, message: 'x' }],
      files: [{ path: `products/feature_flags/f${i}.py`, additions: 12, deletions: 4 }],
    })),
    makePR({
      authorLogin: 'dana', mergedByLogin: 'dana', title: 'chore: bump deps',
      mergedAt: '2026-07-20T12:00:00Z',
      commits: [{ oid: 'c1', authorLogin: 'dana', committedAt: '2026-07-20T10:00:00Z', message: 'x' }],
      files: [{ path: 'pnpm-lock.yaml', additions: 900, deletions: 800 }],
    }),
  ];

  const dana = computeImpact(prs, ENGINE_OPTS).engineers.find((e) => e.login === 'dana')!;

  it('counts work by type', () => {
    const byType = Object.fromEntries(dana.work.byType.map((t) => [t.type, t.count]));
    expect(byType.feat).toBe(8);
    expect(byType.fix).toBe(5);
    expect(byType.chore).toBe(1);
    expect(dana.work.totalMerged).toBe(14);
  });

  it('names the surface they actually work in', () => {
    expect(dana.work.primarySurfaces[0]).toBe('feature_flags');
  });

  it('surfaces signature work as FEATURES, not patches', () => {
    expect(dana.work.signatureWork.length).toBeGreaterThan(0);
    for (const s of dana.work.signatureWork) {
      expect(s.title).not.toMatch(/^(feat|fix|chore)\(/);   // prefix stripped
      expect(s.title).toMatch(/^Flag capability/);          // a feature, not a fix
      expect(s.url).toMatch(/^https:\/\/github\.com\//);
    }
  });

  it('produces a sentence a leader can read without opening a PR', () => {
    expect(dana.workSentence).toContain('feature_flags');
    expect(dana.workSentence).toContain('8 feat');
    expect(dana.workSentence).toContain('14 merged PRs');
    expect(dana.workSentence).not.toMatch(/undefined|NaN/);
  });

  it('says so plainly when someone only reviews', () => {
    expect(describeWork({
      byType: [], primarySurfaces: [], signatureWork: [], totalMerged: 0, featureShare: 0,
    })).toContain('contributes through review');
  });
});
