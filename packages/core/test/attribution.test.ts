import { describe, expect, it } from 'vitest';
import { BotClassifier } from '../src/attribution/bots.js';
import { AgentAttributor } from '../src/attribution/agents.js';
import { makePR, ENGINE_OPTS } from './fixtures.js';

describe('BotClassifier', () => {
  const bots = new BotClassifier(ENGINE_OPTS.botDenylist);

  it('excludes the five bots that would otherwise top PostHog\'s reviewer leaderboard', () => {
    // Observed live: stamphog 105, posthog[bot] 68, greptile-apps 58,
    // veria-ai 29, copilot-pull-request-reviewer 20 reviews in a 100-PR sample.
    for (const bot of ['stamphog', 'greptile-apps', 'veria-ai', 'copilot-pull-request-reviewer', 'posthog[bot]']) {
      expect(bots.isBot(bot), bot).toBe(true);
    }
  });

  it('keeps real humans', () => {
    for (const human of ['Gilbert09', 'haacked', 'charlesvien', 'danielcarletti']) {
      expect(bots.isBot(human), human).toBe(false);
    }
  });

  it('detects bots by GraphQL __typename even when not on the denylist', () => {
    expect(bots.isBot('some-new-ai-reviewer', true)).toBe(true);
  });

  it('detects the [bot] login suffix', () => {
    expect(bots.isBot('brand-new-thing[bot]')).toBe(true);
  });

  it('treats deleted/ghost accounts as non-human', () => {
    expect(bots.isBot(null)).toBe(true);
  });

  it('reports which bots it actually excluded, for auditability', () => {
    const b = new BotClassifier(ENGINE_OPTS.botDenylist);
    b.isBot('stamphog'); b.isBot('Gilbert09'); b.isBot('greptile-apps');
    expect(b.excluded()).toEqual(['greptile-apps', 'stamphog']);
  });
});

describe('AgentAttributor — PostHog PR #98640 regression', () => {
  const bots = new BotClassifier(ENGINE_OPTS.botDenylist);
  const agents = new AgentAttributor(ENGINE_OPTS.agentAuthors, ENGINE_OPTS.agentBranchPrefixes);

  /**
   * Real PR: posthog[bot] opened it on a posthog-self-driving/* branch,
   * then charlesvien pushed 3 commits and merged it.
   * Crediting the bot is wrong; dropping the PR erases charlesvien's work.
   */
  const pr98640 = makePR({
    number: 98640,
    title: 'fix(desktop): name the project timezone on scout cadences',
    authorLogin: 'posthog',
    authorIsBot: true,
    headRefName: 'posthog-self-driving/fixdesktop-show-the-project-timezone-on-9c7158',
    mergedByLogin: 'charlesvien',
    commits: [
      { oid: 'c0', authorLogin: 'posthog', committedAt: '2026-08-01T10:10:00Z', message: 'fix(desktop): name the project timezone' },
      { oid: 'c1', authorLogin: 'charlesvien', committedAt: '2026-08-01T11:00:00Z', message: 'fix(desktop): stepped-hour cron cadences' },
      { oid: 'c2', authorLogin: 'charlesvien', committedAt: '2026-08-01T12:00:00Z', message: 'Merge branch master' },
      { oid: 'c3', authorLogin: 'charlesvien', committedAt: '2026-08-01T13:00:00Z', message: 'chore(desktop): cut narration' },
    ],
  });

  it('recognises the PR as agent-authored', () => {
    expect(agents.isAgentAuthored(pr98640)).toBe(true);
  });

  it('credits the human who pushed commits, not the bot', () => {
    expect(agents.authorsFor(pr98640, bots)).toEqual(['charlesvien']);
  });

  it('records the human merger as steward', () => {
    expect(agents.attribute(pr98640, bots).steward).toBe('charlesvien');
  });

  it('falls back to the steward when no human pushed commits', () => {
    const untouched = makePR({
      authorLogin: 'posthog', authorIsBot: true,
      headRefName: 'posthog-self-driving/auto-123',
      mergedByLogin: 'haacked',
      commits: [{ oid: 'x', authorLogin: 'posthog', committedAt: '2026-08-01T10:10:00Z', message: 'auto' }],
    });
    expect(agents.authorsFor(untouched, bots)).toEqual(['haacked']);
  });

  it('detects agent PRs by branch prefix even when the author looks human', () => {
    const branchOnly = makePR({ authorLogin: 'alice', headRefName: 'posthog-self-driving/x' });
    expect(agents.isAgentAuthored(branchOnly)).toBe(true);
  });

  it('leaves ordinary human PRs alone', () => {
    const human = makePR({ authorLogin: 'alice' });
    expect(agents.attribute(human, bots).isAgentPR).toBe(false);
    expect(agents.authorsFor(human, bots)).toEqual(['alice']);
  });
});
