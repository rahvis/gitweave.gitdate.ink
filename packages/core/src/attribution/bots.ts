import type { PullRequestRecord } from '@gitweave/types';

/**
 * On PostHog, the five most prolific "reviewers" are all bots:
 *   stamphog (105), posthog[bot] (68), greptile-apps (58),
 *   veria-ai (29), copilot-pull-request-reviewer (20)
 *
 * A leaderboard without this filter tells an engineering leader that their
 * best engineers are four LLM review bots and a CI stamper. This is the most
 * common way these dashboards fail, and it is invisible until you look.
 */
export class BotClassifier {
  private readonly denylist: Set<string>;
  private readonly seenBots = new Set<string>();

  constructor(denylist: string[]) {
    this.denylist = new Set(denylist.map((d) => d.toLowerCase().replace(/\[bot\]$/, '')));
  }

  isBot(login: string | null | undefined, typenameSaysBot = false): boolean {
    if (!login) return true; // deleted/ghost accounts contribute no signal
    const norm = login.toLowerCase().replace(/\[bot\]$/, '');
    const bot = typenameSaysBot
      || login.endsWith('[bot]')
      || this.denylist.has(norm)
      || norm.endsWith('-bot')
      || norm.endsWith('[bot]');
    if (bot) this.seenBots.add(norm);
    return bot;
  }

  /** Bots actually observed in this dataset — surfaced in the UI as an audit trail. */
  excluded(): string[] { return [...this.seenBots].sort(); }

  countBotReviews(prs: PullRequestRecord[]): number {
    let n = 0;
    for (const pr of prs) {
      for (const r of pr.reviews) if (this.isBot(r.reviewerLogin)) n += 1;
    }
    return n;
  }
}
