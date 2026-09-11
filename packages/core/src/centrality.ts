import type { FileCentrality, PullRequestRecord } from '@gitweave/types';
import { log1p, quantile } from './stats.js';
import type { BotClassifier } from './attribution/bots.js';

/**
 * File centrality — the antidote to "lines changed".
 *
 * A file that 40 engineers depend on is high-leverage; a private corner is
 * not. Centrality is computed from *other people's* behaviour, which is what
 * makes it hard to game: you cannot make a file important by editing it more,
 * because that raises the denominator too.
 *
 *   centrality = log1p(distinct human authors) × log1p(total changes)
 *
 * Normalised against the repo's p95 (not max) so a single pathological file —
 * a lockfile, a generated schema — cannot flatten everything else to zero.
 */
export function computeFileCentrality(
  prs: PullRequestRecord[],
  bots: BotClassifier,
  authorsFor: (pr: PullRequestRecord) => string[],
): Map<string, FileCentrality> {
  const authorsByPath = new Map<string, Set<string>>();
  const changesByPath = new Map<string, number>();

  for (const pr of prs) {
    const authors = authorsFor(pr).filter((a) => !bots.isBot(a));
    if (authors.length === 0) continue;
    for (const f of pr.files) {
      let set = authorsByPath.get(f.path);
      if (!set) { set = new Set(); authorsByPath.set(f.path, set); }
      for (const a of authors) set.add(a);
      changesByPath.set(f.path, (changesByPath.get(f.path) ?? 0) + 1);
    }
  }

  const rawByPath = new Map<string, number>();
  for (const [path, authors] of authorsByPath) {
    rawByPath.set(path, log1p(authors.size) * log1p(changesByPath.get(path) ?? 0));
  }

  const p95 = quantile([...rawByPath.values()], 0.95) || 1;
  const out = new Map<string, FileCentrality>();
  for (const [path, raw] of rawByPath) {
    out.set(path, {
      path,
      distinctAuthors: authorsByPath.get(path)?.size ?? 0,
      totalChanges: changesByPath.get(path) ?? 0,
      // Clamp at 1.0: beyond p95 there is no extra credit.
      centrality: Math.min(1, raw / p95),
    });
  }
  return out;
}

/**
 * First appearance of each path in the window, and whether that appearance
 * created it (pure additions). Used for the Initiative dimension — founding
 * a surface is different work from maintaining one.
 */
export function computeFileOrigins(prs: PullRequestRecord[]): Map<string, { prNumber: number; created: boolean }> {
  const origins = new Map<string, { prNumber: number; created: boolean; at: number }>();
  for (const pr of prs) {
    if (!pr.mergedAt) continue;
    const at = new Date(pr.mergedAt).getTime();
    for (const f of pr.files) {
      const prev = origins.get(f.path);
      if (!prev || at < prev.at) {
        origins.set(f.path, { prNumber: pr.number, created: f.deletions === 0 && f.additions > 0, at });
      }
    }
  }
  const out = new Map<string, { prNumber: number; created: boolean }>();
  for (const [path, v] of origins) out.set(path, { prNumber: v.prNumber, created: v.created });
  return out;
}
