import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
 * Raw GitHub domain records (normalised out of the GraphQL payload)
 * These are the ONLY inputs the metric engine ever sees.
 * ──────────────────────────────────────────────────────────────── */

export const FileChangeSchema = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

export const CommitRecordSchema = z.object({
  oid: z.string(),
  authorLogin: z.string().nullable(),
  committedAt: z.string(),
  message: z.string(),
});
export type CommitRecord = z.infer<typeof CommitRecordSchema>;

export const ReviewStateSchema = z.enum([
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'DISMISSED',
  'PENDING',
]);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const ReviewRecordSchema = z.object({
  reviewerLogin: z.string().nullable(),
  state: ReviewStateSchema,
  submittedAt: z.string().nullable(),
  bodyLength: z.number().int().nonnegative(),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

/**
 * A review thread is the atomic unit of *consequential* review.
 * `isOutdated` is GitHub's own signal that the diff hunk the comment
 * anchored to was subsequently changed — i.e. the review moved the code.
 */
export const ReviewThreadSchema = z.object({
  id: z.string(),
  authorLogin: z.string().nullable(),
  path: z.string().nullable(),
  createdAt: z.string().nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  commentCount: z.number().int().nonnegative(),
});
export type ReviewThread = z.infer<typeof ReviewThreadSchema>;

export const ReviewRequestEventSchema = z.object({
  requestedLogin: z.string().nullable(),
  createdAt: z.string(),
});
export type ReviewRequestEvent = z.infer<typeof ReviewRequestEventSchema>;

export const IssueCommentSchema = z.object({
  authorLogin: z.string().nullable(),
  createdAt: z.string(),
  bodyLength: z.number().int().nonnegative(),
});
export type IssueComment = z.infer<typeof IssueCommentSchema>;

export const PullRequestRecordSchema = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  /** Raw markdown. NOT GraphQL `bodyText`, which strips the headings,
   *  tables and links the problem-statement heuristic depends on. */
  body: z.string(),
  url: z.string(),
  createdAt: z.string(),
  /** Drives pagination order; see the fetcher's termination rule. */
  updatedAt: z.string(),
  mergedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  authorLogin: z.string().nullable(),
  authorIsBot: z.boolean(),
  mergedByLogin: z.string().nullable(),
  headRefName: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  labels: z.array(z.string()),
  files: z.array(FileChangeSchema),
  commits: z.array(CommitRecordSchema),
  reviews: z.array(ReviewRecordSchema),
  reviewThreads: z.array(ReviewThreadSchema),
  reviewRequests: z.array(ReviewRequestEventSchema),
  comments: z.array(IssueCommentSchema),
});
export type PullRequestRecord = z.infer<typeof PullRequestRecordSchema>;

/* ────────────────────────────────────────────────────────────────
 * Path classification
 * ──────────────────────────────────────────────────────────────── */

export const BlastRadiusSchema = z.enum(['high', 'normal', 'low']);
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

export const StackZoneSchema = z.enum([
  'frontend', 'backend', 'rust', 'node-services', 'infra', 'docs', 'other',
]);
export type StackZone = z.infer<typeof StackZoneSchema>;

export interface FileCentrality {
  path: string;
  distinctAuthors: number;
  totalChanges: number;
  /** log1p(authors) * log1p(changes), normalised to 0..1 against the p95 of the repo */
  centrality: number;
}

/* ────────────────────────────────────────────────────────────────
 * Metric outputs — every sub-signal is retained so the UI can
 * explain the score. Nothing is allowed to be a naked number.
 * ──────────────────────────────────────────────────────────────── */

export interface OwnershipSignals {
  weightedChangeVolume: number;
  criticalPathPRs: number;
  ownedSurfaces: Array<{ area: string; share: number; prCount: number }>;
  sustainedWeeks: number;
  raw: number;
}

export interface LeverageSignals {
  consequentialThreads: number;
  distinctAuthorsReviewed: number;
  distinctAreasReviewed: number;
  mentorshipReviews: number;
  solicitedRequests: number;
  medianUnblockHours: number | null;
  rubberStampApprovals: number;
  raw: number;
}

export interface ReachSignals {
  productAreas: number;
  effectiveAreas: number;
  stacks: number;
  teams: number;
  boundaryPRs: number;
  raw: number;
}

export interface InitiativeSignals {
  filesCreated: number;
  newAreasFounded: number;
  stewardedMerges: number;
  followThrough: number;
  raw: number;
}

export interface ProblemShapingSignals {
  problemStatementRate: number;
  avgProblemQuality: number;
  discussionOnOthers: number;
  raw: number;
}

export interface ReliabilitySignals {
  mergedPRs: number;
  reverts: number;
  rapidFixFollowOns: number;
  selfReworkRatio: number;
  penaltyRate: number;
  modifier: number;
}

export interface AgentLeverageSignals {
  agentStewardedMerges: number;
  humanAuthoredMerges: number;
  agentSharePct: number;
  commitsIntoAgentPRs: number;
}

export const DIMENSION_KEYS = [
  'ownership', 'leverage', 'reach', 'initiative', 'problemShaping',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  ownership: 'Ownership',
  leverage: 'Leverage',
  reach: 'Reach',
  initiative: 'Initiative',
  problemShaping: 'Problem Shaping',
};

export type Archetype =
  | 'Deep Owner' | 'Multiplier' | 'Connector' | 'Builder' | 'Generalist';

export type Confidence = 'high' | 'medium' | 'low';

export interface EvidencePR {
  number: number;
  title: string;
  url: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  productAreas: string[];
  weight: number;
  reasons: string[];
  agentOpened: boolean;
  ownCommits: number;
  consequentialThreadsReceived: number;
  touchesCriticalPath: boolean;
}

export interface EngineerMetrics {
  login: string;
  avatarUrl: string | null;
  name: string | null;
  repo: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  activeDays: number;
  firstSeenAt: string;
  isNewContributor: boolean;

  ownership: OwnershipSignals;
  leverage: LeverageSignals;
  reach: ReachSignals;
  initiative: InitiativeSignals;
  problemShaping: ProblemShapingSignals;
  reliability: ReliabilitySignals;
  agent: AgentLeverageSignals;

  /** 0–100 percentile rank within the active cohort, per dimension */
  percentiles: Record<DimensionKey, number>;
  /** Score under GitWeave default weights; the UI recomputes for custom weights */
  impactScore: number;
  archetype: Archetype;
  confidence: Confidence;
  whySentence: string;
  teams: string[];
  topAreas: Array<{ area: string; prCount: number; share: number }>;
  evidence: EvidencePR[];
}

export const WeightsSchema = z.object({
  ownership: z.number().min(0).max(1),
  leverage: z.number().min(0).max(1),
  reach: z.number().min(0).max(1),
  initiative: z.number().min(0).max(1),
  problemShaping: z.number().min(0).max(1),
});
export type Weights = z.infer<typeof WeightsSchema>;

export const DEFAULT_WEIGHTS: Weights = {
  ownership: 0.28,
  leverage: 0.30,
  reach: 0.18,
  initiative: 0.14,
  problemShaping: 0.10,
};

export interface CohortSummary {
  repo: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  computedAt: string;
  activeEngineers: number;
  totalMergedPRs: number;
  humanMergedPRs: number;
  agentMergedPRs: number;
  botsExcluded: string[];
  botReviewsExcluded: number;
  medianTimeToMergeHours: number;
  medianPercentiles: Record<DimensionKey, number>;
}

export interface DashboardPayload {
  cohort: CohortSummary;
  engineers: EngineerMetrics[];
}

export interface OwnershipTreemapNode {
  area: string;
  prCount: number;
  topOwner: string;
  topOwnerShare: number;
  distinctOwners: number;
  busFactorRisk: 'high' | 'medium' | 'low';
}

export interface CollaborationEdge {
  reviewer: string;
  author: string;
  consequentialThreads: number;
}
