import type { CollaborationEdge, EngineerMetrics, OwnershipTreemapNode } from '@gitweave/types';

/**
 * Bus-factor view. A product surface where one person authored ≥60% of the
 * changes is a key-person risk — the point is to fund a second owner *before*
 * the resignation, not after.
 */
export function buildOwnershipTreemap(engineers: EngineerMetrics[]): OwnershipTreemapNode[] {
  const byArea = new Map<string, Map<string, number>>();
  for (const e of engineers) {
    for (const a of e.topAreas) {
      let owners = byArea.get(a.area);
      if (!owners) { owners = new Map(); byArea.set(a.area, owners); }
      owners.set(e.login, (owners.get(e.login) ?? 0) + a.prCount);
    }
  }

  const nodes: OwnershipTreemapNode[] = [];
  for (const [area, owners] of byArea) {
    const total = [...owners.values()].reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const [topOwner, topCount] = [...owners.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const share = topCount / total;
    nodes.push({
      area,
      prCount: total,
      topOwner,
      topOwnerShare: share,
      distinctOwners: owners.size,
      busFactorRisk: owners.size === 1 || share >= 0.75 ? 'high' : share >= 0.5 ? 'medium' : 'low',
    });
  }
  return nodes.sort((a, b) => b.prCount - a.prCount);
}

/** Reviewer → author flows: the de-facto org chart, as opposed to the formal one. */
export function buildCollaborationEdges(
  engineers: EngineerMetrics[],
  edges: Map<string, Map<string, number>>,
  limit = 40,
): CollaborationEdge[] {
  const known = new Set(engineers.map((e) => e.login));
  const out: CollaborationEdge[] = [];
  for (const [reviewer, targets] of edges) {
    if (!known.has(reviewer)) continue;
    for (const [author, n] of targets) {
      if (!known.has(author) || reviewer === author) continue;
      out.push({ reviewer, author, consequentialThreads: n });
    }
  }
  return out.sort((a, b) => b.consequentialThreads - a.consequentialThreads).slice(0, limit);
}
