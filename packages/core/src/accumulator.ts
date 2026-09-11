import type { StackZone } from '@gitweave/types';
import type { PRContext } from './context.js';

/** Everything we know about one human, accumulated in a single pass. */
export interface EngineerRaw {
  login: string;
  // ── authored (incl. commit-credit on agent PRs) ──
  authored: PRContext[];
  weightedChangeVolume: number;
  criticalPRs: number;
  areaCounts: Map<string, number>;
  stacks: Set<StackZone>;
  teams: Set<string>;
  boundaryPRs: number;
  filesCreated: number;
  weeks: Set<string>;
  activeDays: Set<string>;
  firstSeenMs: number;
  lastSeenMs: number;
  // ── review side ──
  consequentialThreads: number;
  reviewedAuthors: Set<string>;
  reviewedAreas: Set<string>;
  mentorshipThreads: number;
  solicitedRequests: number;
  unblockHours: number[];
  rubberStampsGiven: number;
  reviewEdges: Map<string, number>;
  // ── initiative ──
  stewardedMerges: number;
  newAreasFounded: number;
  // ── problem shaping ──
  problemPRs: number;
  problemQualitySum: number;
  discussionOnOthers: number;
  // ── reliability ──
  reverts: number;
  rapidFixFollowOns: number;
  fileTouchTimes: Map<string, number[]>;
  // ── agent leverage ──
  agentStewardedMerges: number;
  humanAuthoredMerges: number;
  commitsIntoAgentPRs: number;
}

export function newEngineerRaw(login: string): EngineerRaw {
  return {
    login,
    authored: [],
    weightedChangeVolume: 0,
    criticalPRs: 0,
    areaCounts: new Map(),
    stacks: new Set(),
    teams: new Set(),
    boundaryPRs: 0,
    filesCreated: 0,
    weeks: new Set(),
    activeDays: new Set(),
    firstSeenMs: Number.POSITIVE_INFINITY,
    lastSeenMs: 0,
    consequentialThreads: 0,
    reviewedAuthors: new Set(),
    reviewedAreas: new Set(),
    mentorshipThreads: 0,
    solicitedRequests: 0,
    unblockHours: [],
    rubberStampsGiven: 0,
    reviewEdges: new Map(),
    stewardedMerges: 0,
    newAreasFounded: 0,
    problemPRs: 0,
    problemQualitySum: 0,
    discussionOnOthers: 0,
    reverts: 0,
    rapidFixFollowOns: 0,
    fileTouchTimes: new Map(),
    agentStewardedMerges: 0,
    humanAuthoredMerges: 0,
    commitsIntoAgentPRs: 0,
  };
}
