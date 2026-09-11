import type { PullRequestRecord, StackZone } from '@gitweave/types';
import type { BotClassifier } from './attribution/bots.js';
import type { AgentAttributor } from './attribution/agents.js';
import { PathClassifier, resolveProductArea, resolveStackZone, resolveTeams } from './paths.js';
import type { FileCentrality } from '@gitweave/types';
import { log1p } from './stats.js';

export interface ConsequentialThread {
  reviewer: string;
  path: string | null;
  createdAt: string | null;
  reason: 'outdated' | 'resolved-with-push';
}

export interface PRContext {
  pr: PullRequestRecord;
  /** Humans credited as authors (handles agent PRs — see attribution/agents.ts) */
  authors: string[];
  authorSet: Set<string>;
  isAgentPR: boolean;
  steward: string | null;
  productAreas: string[];
  /**
   * Area → share of this PR's files that live there, summing to 1.
   *
   * Presence is fractional on purpose. A repo-wide lint sweep touching 75
   * areas is not the same as working in 75 areas, but a set of touched areas
   * cannot tell the difference — on live data that made a sweep read as
   * extraordinary breadth. Weighting by file share makes a sweep contribute
   * ~0.01 per area instead of a full point.
   */
  areaShares: Map<string, number>;
  stacks: StackZone[];
  teams: string[];
  /** centrality × blast-radius × log-size, summed over files */
  prWeight: number;
  touchesCritical: boolean;
  filesCreatedHere: number;
  problemQuality: number;
  hasProblemStatement: boolean;
  consequentialThreads: ConsequentialThread[];
  rubberStamps: string[];
  /** reviewer → hours from request to their first substantive review */
  unblockLatency: Array<{ reviewer: string; hours: number }>;
  substantiveReviewers: Set<string>;
  isRevert: boolean;
  revertedTitle: string | null;
  mergedAtMs: number;
  ownCommitCount: Map<string, number>;
}

export interface ContextDeps {
  bots: BotClassifier;
  agents: AgentAttributor;
  paths: PathClassifier;
  centrality: Map<string, FileCentrality>;
  fileOrigins: Map<string, { prNumber: number; created: boolean }>;
  blastHighMultiplier: number;
  blastLowMultiplier: number;
}

const REVERT_RE = /^\s*revert\s+"(.+)"\s*$/i;
/**
 * Matches a problem-section heading on its own line, in markdown (`## Problem`),
 * bold (`**Problem**`) or plain (`Problem`) form. The plain form matters
 * because some sources hand us markdown-stripped text; requiring the line to
 * contain nothing else keeps prose from false-positiving.
 */
const PROBLEM_HEADING_RE =
  /^[ \t]{0,3}(?:#{1,4}[ \t]*|\*\*[ \t]*)?(problem|why|context|background|motivation)\b[ \t]*:?[ \t]*\*{0,2}[ \t]*$/im;

/**
 * Scores how well a PR states the problem it solves.
 *
 * PostHog's PR template has a `## Problem` section; a PR that fills it in
 * properly is doing product work, not just code work. Deterministic heuristic
 * by design — reproducible, auditable, zero-latency, and no data leaves the
 * deployment. LLM scoring is available behind a flag but is not the default.
 */
export function scoreProblemStatement(bodyMarkdown: string): { has: boolean; quality: number } {
  const body = bodyMarkdown ?? '';
  if (body.trim().length === 0) return { has: false, quality: 0 };
  const has = PROBLEM_HEADING_RE.test(body);
  if (!has) return { has: false, quality: 0 };

  const match = PROBLEM_HEADING_RE.exec(body);
  const start = match ? match.index + match[0].length : 0;
  const nextHeading = body.slice(start).search(/\n[ \t]{0,3}(?:#{1,4}[ \t]|\*\*[A-Z])/);
  const section = nextHeading === -1 ? body.slice(start) : body.slice(start, start + nextHeading);
  const text = section.trim();

  let q = 0;
  q += Math.min(0.45, text.length / 700);              // substance
  if (/^\s*[-*]\s/m.test(text)) q += 0.15;              // structured
  if (/\|.*\|/.test(text)) q += 0.15;                   // before/after table
  if (/https?:\/\//.test(text) || /#\d{3,}/.test(text)) q += 0.15; // evidence links
  if (/\b(because|so that|which means|impact|user|customer)\b/i.test(text)) q += 0.10; // reasoning
  return { has: true, quality: Math.min(1, q) };
}

export function buildPRContext(pr: PullRequestRecord, deps: ContextDeps): PRContext {
  const { bots, agents, paths, centrality, fileOrigins } = deps;

  const authors = agents.authorsFor(pr, bots);
  const authorSet = new Set(authors);
  const attribution = agents.attribute(pr, bots);

  const areaCounts = new Map<string, number>();
  const stackSet = new Set<StackZone>();
  let prWeight = 0;
  let touchesCritical = false;
  let filesCreatedHere = 0;

  for (const f of pr.files) {
    const area = resolveProductArea(f.path);
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
    stackSet.add(resolveStackZone(f.path));

    const c = centrality.get(f.path)?.centrality ?? 0;
    const mul = paths.multiplier(f.path, deps.blastHighMultiplier, deps.blastLowMultiplier);
    if (paths.blastRadius(f.path) === 'high') touchesCritical = true;
    // Size is a WEAK tiebreaker, never the driver. A raw log1p(lines) term
    // gives a 1,800-line docs change a 2.7x edge over a 16-line planner fix,
    // which swamps centrality and blast radius and quietly rebuilds the
    // lines-of-code metric we exist to replace. Dividing by 6 caps the whole
    // size range at roughly 1.0x-2.6x so `where` dominates `how much`.
    const sizeFactor = 1 + log1p(f.additions + f.deletions) / 6;
    prWeight += c * mul * sizeFactor;

    const origin = fileOrigins.get(f.path);
    if (origin && origin.prNumber === pr.number && origin.created) filesCreatedHere += 1;
  }

  // ── Consequential review detection ──────────────────────────────────────
  // A review only counts if it changed the outcome. `isOutdated` is GitHub's
  // own marker that the diff hunk the comment anchored to was subsequently
  // changed. Approvals score exactly zero: on PostHog the approve-to-
  // request-changes ratio is ~30:1, which proves approval is a formality.
  const mergedAtMs = pr.mergedAt ? new Date(pr.mergedAt).getTime() : Number.POSITIVE_INFINITY;
  const commitTimes = pr.commits
    .map((c) => new Date(c.committedAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const consequentialThreads: ConsequentialThread[] = [];
  for (const t of pr.reviewThreads) {
    const reviewer = t.authorLogin;
    if (!reviewer || bots.isBot(reviewer) || authorSet.has(reviewer)) continue;
    const createdMs = t.createdAt ? new Date(t.createdAt).getTime() : null;
    const pushedAfter = createdMs !== null
      && commitTimes.some((ct) => ct > createdMs && ct <= mergedAtMs);
    if (t.isOutdated) {
      consequentialThreads.push({ reviewer, path: t.path, createdAt: t.createdAt, reason: 'outdated' });
    } else if (t.isResolved && pushedAfter) {
      consequentialThreads.push({ reviewer, path: t.path, createdAt: t.createdAt, reason: 'resolved-with-push' });
    }
  }

  const threadReviewers = new Set(consequentialThreads.map((t) => t.reviewer));
  const substantiveReviewers = new Set<string>();
  const rubberStamps: string[] = [];
  for (const r of pr.reviews) {
    const login = r.reviewerLogin;
    if (!login || bots.isBot(login) || authorSet.has(login)) continue;
    const substantive = r.bodyLength >= 30 || threadReviewers.has(login);
    if (substantive) substantiveReviewers.add(login);
    else if (r.state === 'APPROVED') rubberStamps.push(login);
  }

  // ── Unblock latency: request → first substantive review ────────────────
  const unblockLatency: Array<{ reviewer: string; hours: number }> = [];
  for (const req of pr.reviewRequests) {
    const who = req.requestedLogin;
    if (!who || bots.isBot(who) || authorSet.has(who)) continue;
    const reqMs = new Date(req.createdAt).getTime();
    const first = pr.reviews
      .filter((r) => r.reviewerLogin === who && r.submittedAt
        && new Date(r.submittedAt).getTime() > reqMs
        && (r.bodyLength >= 30 || threadReviewers.has(who)))
      .map((r) => new Date(r.submittedAt!).getTime())
      .sort((a, b) => a - b)[0];
    if (first !== undefined) {
      unblockLatency.push({ reviewer: who, hours: (first - reqMs) / 3_600_000 });
    }
  }

  const revertMatch = REVERT_RE.exec(pr.title);
  const problem = scoreProblemStatement(pr.body);

  const ownCommitCount = new Map<string, number>();
  for (const c of pr.commits) {
    if (!c.authorLogin || bots.isBot(c.authorLogin)) continue;
    ownCommitCount.set(c.authorLogin, (ownCommitCount.get(c.authorLogin) ?? 0) + 1);
  }

  const totalFiles = pr.files.length || 1;
  const areaShares = new Map<string, number>();
  for (const [area, count] of areaCounts) areaShares.set(area, count / totalFiles);

  return {
    pr,
    authors,
    authorSet,
    isAgentPR: attribution.isAgentPR,
    steward: attribution.isAgentPR ? attribution.steward : (pr.mergedByLogin && !bots.isBot(pr.mergedByLogin) ? pr.mergedByLogin : null),
    productAreas: [...areaCounts.keys()],
    areaShares,
    stacks: [...stackSet],
    teams: resolveTeams(pr.labels),
    prWeight,
    touchesCritical,
    filesCreatedHere,
    problemQuality: problem.quality,
    hasProblemStatement: problem.has,
    consequentialThreads,
    rubberStamps,
    unblockLatency,
    substantiveReviewers,
    isRevert: Boolean(revertMatch),
    revertedTitle: revertMatch?.[1] ?? null,
    mergedAtMs,
    ownCommitCount,
  };
}
