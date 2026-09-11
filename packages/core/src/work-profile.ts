import type { PRContext } from './context.js';

/**
 * What did this person actually BUILD?
 *
 * The brief is explicit that the reader "isn't in the weeds enough to read
 * every line of code or PR description". Everything else in this product
 * answers *how much* and *how load-bearing*; none of it answers *what*. A
 * leader reading "879 review threads and 42% of feature_flags" still has to
 * open a list of PR titles to learn what the person does for a living — which
 * is precisely the weeds the brief rules out.
 *
 * PostHog uses conventional commit prefixes on 100% of merged PRs (measured:
 * 14,838 of 14,846), so the work can be classified with no heuristics and no
 * LLM: feat / fix / perf / refactor / chore. That turns a metric profile into
 * a sentence a leader can repeat.
 */

const TYPE_RE = /^\s*([a-z]+)\s*(?:\(([^)]*)\))?\s*!?\s*:/i;

export type WorkType = 'feat' | 'fix' | 'perf' | 'refactor' | 'chore' | 'docs' | 'test' | 'ci' | 'revert' | 'other';

const KNOWN: Record<string, WorkType> = {
  feat: 'feat', feature: 'feat',
  fix: 'fix', bugfix: 'fix', hotfix: 'fix',
  perf: 'perf',
  refactor: 'refactor',
  chore: 'chore', build: 'chore', style: 'chore', deps: 'chore',
  docs: 'docs', doc: 'docs',
  test: 'test', tests: 'test',
  ci: 'ci',
  revert: 'revert',
};

export function classifyTitle(title: string): { type: WorkType; scope: string | null } {
  const m = TYPE_RE.exec(title ?? '');
  if (!m) return { type: 'other', scope: null };
  const type = KNOWN[(m[1] ?? '').toLowerCase()] ?? 'other';
  const scope = (m[2] ?? '').trim() || null;
  return { type, scope };
}

/** Strip the `feat(scope):` prefix so a title reads as a plain description. */
export function plainTitle(title: string): string {
  const stripped = (title ?? '').replace(TYPE_RE, '').trim();
  const out = stripped.length > 0 ? stripped : (title ?? '').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export interface WorkProfile {
  /** Merged PRs by conventional-commit type, most common first. */
  byType: Array<{ type: WorkType; count: number }>;
  /** The product surfaces they actually work in, by share of their own work. */
  primarySurfaces: string[];
  /**
   * The two or three features that best represent what they shipped — chosen
   * by the same weighting the score uses, restricted to `feat` so the answer
   * is "what they built", not "what they patched".
   */
  signatureWork: Array<{ number: number; title: string; url: string; area: string | null }>;
  totalMerged: number;
  featureShare: number;
}

export function buildWorkProfile(
  login: string,
  contexts: PRContext[],
  topAreas: Array<{ area: string; prCount: number }>,
): WorkProfile {
  const counts = new Map<WorkType, number>();
  for (const ctx of contexts) {
    const { type } = classifyTitle(ctx.pr.title);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const features = contexts
    .filter((c) => classifyTitle(c.pr.title).type === 'feat')
    .map((c) => ({
      ctx: c,
      weight: c.prWeight + (c.touchesCritical ? 6 : 0) + 2 * c.filesCreatedHere + 4 * c.problemQuality,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const featCount = counts.get('feat') ?? 0;

  return {
    byType,
    primarySurfaces: topAreas.slice(0, 2).map((a) => a.area),
    signatureWork: features.map(({ ctx }) => ({
      number: ctx.pr.number,
      title: plainTitle(ctx.pr.title),
      url: ctx.pr.url,
      area: classifyTitle(ctx.pr.title).scope ?? ctx.productAreas[0] ?? null,
    })),
    totalMerged: contexts.length,
    featureShare: contexts.length > 0 ? featCount / contexts.length : 0,
  };
}

/**
 * One plain sentence naming what this person works on and in what proportion.
 * Deterministic: no model, no hand-written copy, reproducible from the data.
 */
export function describeWork(p: WorkProfile): string {
  if (p.totalMerged === 0) return 'No authored PRs in this window — contributes through review.';
  const where = p.primarySurfaces.length > 0
    ? `Works mainly in ${p.primarySurfaces.map((s) => `\`${s}\``).join(' and ')}`
    : 'Works across the repo';
  const mix = p.byType
    .filter((t) => t.count > 0 && !['other', 'ci', 'test'].includes(t.type))
    .slice(0, 3)
    .map((t) => `${t.count} ${t.type}`)
    .join(' · ');
  return `${where} — ${mix} across ${p.totalMerged} merged PRs.`;
}
