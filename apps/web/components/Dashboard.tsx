'use client';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Header, HeaderName, HeaderGlobalBar, HeaderGlobalAction, Theme,
  Dropdown, Tag, Button, ActionableNotification,
} from '@carbon/react';
import { Settings, Information, Asleep, Light, Restart, ChartTreemap } from '@carbon/icons-react';
import { DEFAULT_WEIGHTS, type DashboardPayload, type Weights } from '@gitweave/types';
import { rescoreLocal } from '../lib/score';
import { relativeTime, num } from '../lib/format';
import { RankCard } from './RankCard';
import { CohortStrips } from './CohortStrips';
import { CutLine } from './CutLine';
import { InsightStrip } from './InsightStrip';
import { WorkProfile } from './WorkProfile';
import { Decomposition } from './Decomposition';
import { EvidenceRail } from './EvidenceRail';
import { AgentPanel } from './AgentPanel';
import { WeightsPanel } from './WeightsPanel';
import { MethodologyModal } from './MethodologyModal';
import { BusFactorModal } from './BusFactorModal';

const WINDOWS = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: '180', label: 'Last 180 days' },
];

const TOP_N = 5;

export function Dashboard({ payload, windowDays }: { payload: DashboardPayload; windowDays: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [busOpen, setBusOpen] = useState(false);
  const [theme, setTheme] = useState<'g100' | 'white'>('g100');
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Default is the Cut Line: the centre panel's job is to INTERROGATE the
  // ranking, not re-render the five percentiles the right-hand panel already
  // shows with raw facts attached.
  /**
   * Relative time is computed AFTER mount.
   *
   * Rendering it during SSR produced a hydration mismatch (React #418): the
   * server said "3m ago" and the client, a beat later, said "4m ago". The
   * absolute timestamp is the stable value both sides agree on; the friendly
   * one is a client-only enhancement.
   */
  const [computedAgo, setComputedAgo] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setComputedAgo(relativeTime(cohort.computedAt));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [payload.cohort.computedAt]);

  const [view, setView] = useState<'cut' | 'strips'>('cut');

  const dirty = useMemo(
    () => Object.keys(DEFAULT_WEIGHTS).some(
      (k) => Math.abs(weights[k as keyof Weights] - DEFAULT_WEIGHTS[k as keyof Weights]) > 0.001),
    [weights],
  );

  // Re-ranking is a multiply-and-sort over pre-computed percentiles: no
  // round-trip, no recompute, so the sliders feel instantaneous.
  const ranked = useMemo(
    () => (dirty ? rescoreLocal(payload.engineers, weights) : payload.engineers),
    [payload.engineers, weights, dirty],
  );

  const visible = showAll ? ranked.slice(0, 40) : ranked.slice(0, TOP_N);
  const active = useMemo(
    () => ranked.find((e) => e.login === selected) ?? ranked[0],
    [ranked, selected],
  );

  const changeWindow = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('window', id);
    startTransition(() => router.push(`/?${params.toString()}`, { scroll: false }));
  }, [router, searchParams]);

  const { cohort } = payload;

  return (
    <Theme theme={theme}>
      <div className="gw-shell">
        <Header aria-label="GitWeave">
          <HeaderName prefix="">
            <strong style={{ letterSpacing: '-.01em' }}>GitWeave</strong>
          </HeaderName>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', paddingLeft: '.5rem', minWidth: 0 }}>
            <Tag type="outline" size="sm">{cohort.repo}</Tag>
            <span className="gw-headmeta" style={{ fontSize: '.75rem', color: 'var(--cds-text-helper)', whiteSpace: 'nowrap' }}>
              {num(cohort.totalMergedPRs)} merged PRs ·{' '}
              {num(cohort.activeEngineers)} engineers ·{' '}
              {cohort.botsExcluded.length} bots excluded ·{' '}
              computed{' '}
              <span suppressHydrationWarning>
                {computedAgo ?? new Date(cohort.computedAt).toISOString().slice(11, 16) + ' UTC'}
              </span>
            </span>
          </div>
          <HeaderGlobalBar>
            <div style={{ width: '11rem', alignSelf: 'center' }}>
              <Dropdown
                id="window-select"
                size="sm"
                label="Window"
                titleText=""
                hideLabel
                items={WINDOWS}
                itemToString={(i) => i?.label ?? ''}
                selectedItem={WINDOWS.find((w) => w.id === String(windowDays)) ?? WINDOWS[1]}
                onChange={({ selectedItem }) => selectedItem && changeWindow(selectedItem.id)}
                disabled={pending}
              />
            </div>
            <HeaderGlobalAction aria-label="Adjust weights" onClick={() => setWeightsOpen(true)} tooltipAlignment="end">
              <Settings size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction aria-label="Bus factor by product surface" onClick={() => setBusOpen(true)} tooltipAlignment="end">
              <ChartTreemap size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction aria-label="Methodology and limitations" onClick={() => setMethodOpen(true)} tooltipAlignment="end">
              <Information size={20} />
            </HeaderGlobalAction>
            <HeaderGlobalAction
              aria-label={theme === 'g100' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme((t) => (t === 'g100' ? 'white' : 'g100'))}
              tooltipAlignment="end"
            >
              {theme === 'g100' ? <Light size={20} /> : <Asleep size={20} />}
            </HeaderGlobalAction>
          </HeaderGlobalBar>
        </Header>

        {dirty && (
          <ActionableNotification
            kind="info"
            lowContrast
            inline
            hideCloseButton
            title="Custom weights"
            subtitle="Ranking reflects your definition of impact, not GitWeave's defaults."
            actionButtonLabel="Reset to defaults"
            onActionButtonClick={() => setWeights(DEFAULT_WEIGHTS)}
            style={{ maxWidth: '100%', margin: 0 }}
          />
        )}

        <InsightStrip top={ranked.slice(0, TOP_N)} cohort={cohort} />

        <div className="gw-main">
          {/* ── Column 1: the answer ─────────────────────────────────── */}
          <section className="gw-panel gw-area--ranks" aria-label="Most impactful engineers">
            <div className="gw-panel__head">
              <span className="gw-panel__title">
                {showAll ? `Top ${Math.min(40, ranked.length)} by impact` : 'Top 5 by impact'}
              </span>
              <span className="gw-panel__meta">of {cohort.activeEngineers} active</span>
            </div>
            <div className="gw-panel__body">
              {visible.map((e, i) => (
                <RankCard
                  key={e.login}
                  engineer={e}
                  position={i + 1}
                  active={active?.login === e.login}
                  onSelect={setSelected}
                />
              ))}
              <div style={{ padding: '.75rem 1rem' }}>
                <Button kind="ghost" size="sm" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? 'Show top 5 only' : 'Show full leaderboard'}
                </Button>
                {dirty && (
                  <Button kind="ghost" size="sm" renderIcon={Restart} onClick={() => setWeights(DEFAULT_WEIGHTS)}>
                    Reset weights
                  </Button>
                )}
              </div>
            </div>
          </section>

          {/* ── Column 2: the shape ──────────────────────────────────── */}
          <section className="gw-panel gw-area--fingerprint" aria-label="Evidence for the ranking">
            <div className="gw-panel__head">
              <span className="gw-panel__title">
                {view === 'cut'
                  ? 'How firm is this top 5?'
                  : 'Where they beat the room'}
              </span>
              <span className="gw-panel__meta">
                {view === 'cut'
                  ? `${num(cohort.stabilityDraws ?? 2000)} random weightings`
                  : `${active?.login ?? ''} against all ${cohort.activeEngineers} engineers`}
              </span>
            </div>
            <div className="gw-views" role="tablist" aria-label="Centre panel view">
              <button type="button" role="tab" aria-selected={view === 'cut'}
                className={`gw-views__tab${view === 'cut' ? ' gw-views__tab--active' : ''}`}
                onClick={() => setView('cut')}>
                Rank stability
              </button>
              <button type="button" role="tab" aria-selected={view === 'strips'}
                className={`gw-views__tab${view === 'strips' ? ' gw-views__tab--active' : ''}`}
                onClick={() => setView('strips')}>
                Cohort distribution
              </button>
            </div>
            <div className="gw-panel__body">
              {!active && <div className="gw-empty">No engineers in this window.</div>}
              {active && view === 'strips' && (
                <CohortStrips
                  engineer={active}
                  peers={ranked.slice(0, TOP_N).filter((e) => e.login !== active.login)}
                  cohort={cohort}
                  compact={false}
                />
              )}
              {active && view === 'cut' && (
                <CutLine engineers={ranked} selected={active} cohort={cohort} onSelect={setSelected} />
              )}
            </div>
          </section>

          {/* ── Column 3: the receipts ───────────────────────────────── */}
          <section className="gw-panel gw-area--decomposition" aria-label="Score decomposition">
            <div className="gw-panel__head">
              <span className="gw-panel__title">How this score is built</span>
              <span className="gw-panel__meta">{active ? active.impactScore.toFixed(1) : ''}</span>
            </div>
            <div className="gw-panel__body">
              {active && (
                <>
                  <Decomposition engineer={active} weights={weights} />
                  <AgentPanel engineer={active} />
                </>
              )}
            </div>
          </section>

          {/* ── Row 2: drill-through ─────────────────────────────────── */}
          <section className="gw-panel gw-area--evidence" aria-label="What they worked on">
            <div className="gw-panel__head">
              <span className="gw-panel__title">
                What {active?.login ?? 'they'} worked on
              </span>
              <span className="gw-panel__meta">
                highest-weighted contributions · click any row to open it on GitHub
              </span>
            </div>
            {active && <WorkProfile engineer={active} />}
            <div className="gw-panel__body">
              {active && <EvidenceRail engineer={active} />}
            </div>
          </section>
        </div>

        <WeightsPanel
          open={weightsOpen}
          weights={weights}
          dirty={dirty}
          onChange={setWeights}
          onClose={() => setWeightsOpen(false)}
          onReset={() => setWeights(DEFAULT_WEIGHTS)}
        />
        <MethodologyModal open={methodOpen} onClose={() => setMethodOpen(false)} cohort={cohort} />
        <BusFactorModal open={busOpen} onClose={() => setBusOpen(false)} engineers={ranked} theme={theme} />
      </div>
    </Theme>
  );
}
