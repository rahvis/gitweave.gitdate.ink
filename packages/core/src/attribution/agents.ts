import type { PullRequestRecord } from '@gitweave/types';
import type { BotClassifier } from './bots.js';

/**
 * Agent-era attribution.
 *
 * 954 of PostHog's merged PRs in a 90-day window are opened by `posthog[bot]`
 * on `posthog-self-driving/*` branches. We verified PR #98640: the bot filed
 * it, then a human (charlesvien) pushed 3 commits, resolved the discussion and
 * merged it.
 *
 * Both naive handlings are wrong:
 *   A) Credit the bot   → the #1 "engineer" is a robot.
 *   B) Drop bot PRs     → that human's 3 commits, review and merge vanish.
 *
 * So we attribute agent PRs to humans by the role they actually played.
 */

export interface AgentAttribution {
  isAgentPR: boolean;
  /** Humans who pushed commits into the branch — full author credit. */
  coAuthors: string[];
  /** Human who merged it — accountable for it landing. */
  steward: string | null;
}

export class AgentAttributor {
  private readonly agentLogins: Set<string>;
  private readonly branchPrefixes: string[];

  constructor(agentAuthors: string[], branchPrefixes: string[]) {
    this.agentLogins = new Set(agentAuthors.map((a) => a.toLowerCase().replace(/\[bot\]$/, '')));
    this.branchPrefixes = branchPrefixes;
  }

  isAgentAuthored(pr: PullRequestRecord): boolean {
    const login = pr.authorLogin?.toLowerCase().replace(/\[bot\]$/, '') ?? '';
    if (this.agentLogins.has(login)) return true;
    return this.branchPrefixes.some((p) => pr.headRefName.startsWith(p));
  }

  attribute(pr: PullRequestRecord, bots: BotClassifier): AgentAttribution {
    const isAgentPR = this.isAgentAuthored(pr);
    if (!isAgentPR) return { isAgentPR: false, coAuthors: [], steward: null };

    const coAuthors = [...new Set(
      pr.commits
        .map((c) => c.authorLogin)
        .filter((l): l is string => l !== null && !bots.isBot(l) && !this.agentLogins.has(l.toLowerCase())),
    )];
    const steward = pr.mergedByLogin && !bots.isBot(pr.mergedByLogin) ? pr.mergedByLogin : null;
    return { isAgentPR: true, coAuthors, steward };
  }

  /**
   * Which humans get *author* credit for this PR.
   * - Human PR  → the author (plus any co-committers).
   * - Agent PR  → everyone who pushed commits; if nobody did, the merger
   *               (they reviewed and took responsibility for it landing).
   */
  authorsFor(pr: PullRequestRecord, bots: BotClassifier): string[] {
    const attribution = this.attribute(pr, bots);
    if (!attribution.isAgentPR) {
      const primary = pr.authorLogin && !bots.isBot(pr.authorLogin, pr.authorIsBot) ? [pr.authorLogin] : [];
      const committers = pr.commits
        .map((c) => c.authorLogin)
        .filter((l): l is string => Boolean(l) && !bots.isBot(l));
      return [...new Set([...primary, ...committers])];
    }
    if (attribution.coAuthors.length > 0) return attribution.coAuthors;
    return attribution.steward ? [attribution.steward] : [];
  }
}
