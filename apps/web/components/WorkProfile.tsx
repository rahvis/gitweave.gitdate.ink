'use client';
import type { EngineerMetrics } from '@gitweave/types';
import { ArrowUpRight } from '@carbon/icons-react';

const TYPE_LABEL: Record<string, string> = {
  feat: 'features', fix: 'fixes', perf: 'perf', refactor: 'refactors',
  chore: 'chores', docs: 'docs', test: 'tests', ci: 'CI', revert: 'reverts', other: 'other',
};

/**
 * "What they worked on" — the answer to the question the metrics do not ask.
 *
 * The brief's reader "isn't in the weeds enough to read every line of code or
 * PR description", so handing them a list of PR titles to decode is exactly
 * the wrong affordance. This block says, in one line, which surfaces the
 * person works in and what mix of work they do — then names the two or three
 * features that best represent what they actually shipped.
 *
 * Entirely deterministic. PostHog uses conventional commit prefixes on 100% of
 * merged PRs, so `feat` / `fix` / `perf` classification needs no heuristic and
 * no model.
 */
export function WorkProfile({ engineer }: { engineer: EngineerMetrics }) {
  const w = engineer.work;
  if (!w || w.totalMerged === 0) {
    return (
      <p className="gw-work__line">
        No authored PRs in this window — {engineer.login} contributes through review.
      </p>
    );
  }

  const mix = w.byType
    .filter((t) => t.count > 0 && !['other', 'ci', 'test'].includes(t.type))
    .slice(0, 4);

  return (
    <div className="gw-work">
      <p className="gw-work__line">
        {w.primarySurfaces.length > 0 ? (
          <>
            Works mainly in{' '}
            {w.primarySurfaces.map((s, i) => (
              <span key={s}>
                {i > 0 && ' and '}
                <code>{s}</code>
              </span>
            ))}
          </>
        ) : (
          <>Works across the repo</>
        )}
        {' — '}
        {mix.map((t, i) => (
          <span key={t.type}>
            {i > 0 && ' · '}
            <strong>{t.count}</strong> {TYPE_LABEL[t.type] ?? t.type}
          </span>
        ))}
        {' across '}{w.totalMerged} merged PRs.
      </p>

      {w.signatureWork.length > 0 && (
        <p className="gw-work__line gw-work__shipped">
          <span className="gw-work__tag">Shipped</span>
          {w.signatureWork.map((s, i) => (
            <span key={s.number}>
              {i > 0 && <span className="gw-work__sep"> · </span>}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
                <ArrowUpRight size={11} />
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
