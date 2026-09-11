'use client';
import type { EngineerMetrics } from '@gitweave/types';
import { Explain } from './Explain';

/**
 * Agent Leverage — reported, never scored.
 *
 * PostHog's self-driving agent opens PRs that humans then commit into and
 * merge. We credit the human (commit- and steward-level attribution) and show
 * the share as a neutral statistic. We do not have the outcome data to judge
 * whether high agent leverage is good or bad, and pretending otherwise would
 * be exactly the overreach this product exists to avoid.
 */
export function AgentPanel({ engineer }: { engineer: EngineerMetrics }) {
  const share = engineer.agent.agentSharePct;
  return (
    <div className="gw-agent">
      <div className="gw-kv" style={{ marginBottom: '.375rem' }}>
        <Explain
          label={<span className="gw-panel__title">Agent leverage</span>}
          detail="Share of this engineer's merged output that began as an agent-opened PR they committed into, reviewed, or merged. Neutral statistic — it is not scored up or down."
        />
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{share.toFixed(0)}%</strong>
      </div>
      <div className="gw-bar">
        <div className="gw-bar__fill" style={{ width: `${Math.min(100, share)}%`, background: '#a56eff' }} />
      </div>
      <p className="gw-note" style={{ marginTop: '.375rem' }}>
        {engineer.agent.agentStewardedMerges} of {engineer.agent.agentStewardedMerges + engineer.agent.humanAuthoredMerges} merges
        were agent-opened and human-driven
        {engineer.agent.commitsIntoAgentPRs > 0 && ` (${engineer.agent.commitsIntoAgentPRs} of their own commits inside them)`}.
      </p>
    </div>
  );
}
