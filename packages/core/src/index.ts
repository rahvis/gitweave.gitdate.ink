export { computeImpact, rescore } from './engine.js';
export type { EngineOptions } from './engine.js';
export { BotClassifier } from './attribution/bots.js';
export { AgentAttributor } from './attribution/agents.js';
export type { AgentAttribution } from './attribution/agents.js';
export {
  PathClassifier, resolveProductArea, resolveStackZone, resolveTeams,
  DEFAULT_CRITICAL_PATTERNS, DEFAULT_LOW_RISK_PATTERNS,
} from './paths.js';
export { computeFileCentrality, computeFileOrigins } from './centrality.js';
export { buildPRContext, scoreProblemStatement } from './context.js';
export type { PRContext, ContextDeps, ConsequentialThread } from './context.js';
export { deriveArchetype, deriveConfidence, buildWhySentence, selectEvidence } from './explain.js';
export {
  median, quantile, percentileRank, effectiveCount, clamp, log1p, isoWeek, hoursBetween,
} from './stats.js';
export { buildOwnershipTreemap, buildCollaborationEdges } from './views.js';
export {
  computeRankStability, computeFactDistributions, computeVolumeBenchmark,
  FACT_SPEC, STABILITY_DRAWS,
} from './stability.js';
export type { RankStability, FactDistribution } from './stability.js';
export { buildWorkProfile, describeWork, classifyTitle, plainTitle } from './work-profile.js';
export type { WorkProfile, WorkType } from './work-profile.js';
