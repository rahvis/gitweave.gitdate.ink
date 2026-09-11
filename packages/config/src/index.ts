import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Walk up for the nearest .env so `pnpm --filter <app> ...` works from any
 * workspace directory, not only the repo root. In containers the env is
 * injected directly and no file is found, which is fine.
 */
function loadNearestDotenv(): void {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) { loadDotenv({ path: candidate }); return; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}

loadNearestDotenv();

const csv = (fallback: string[] = []) =>
  z.string().optional().transform((v) =>
    v && v.trim().length > 0 ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback,
  );

const bool = (fallback: boolean) =>
  z.string().optional().transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const num = (fallback: number) =>
  z.string().optional().transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().finite());

/**
 * Fail fast, fail loud. The process refuses to boot on a malformed env
 * rather than dying three layers deep on the first API call.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  GITHUB_AUTH_MODE: z.enum(['pat', 'app']).default('pat'),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_TOKENS: csv([]),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_GRAPHQL_URL: z.string().default('https://api.github.com/graphql'),
  GITHUB_API_URL: z.string().default('https://api.github.com'),

  TARGET_REPO_OWNER: z.string().default('PostHog'),
  TARGET_REPO_NAME: z.string().default('posthog'),
  ANALYSIS_WINDOW_DAYS: num(90),
  BACKFILL_MAX_DAYS: num(365),
  BACKFILL_MAX_PRS: num(0), // 0 = unlimited

  MONGODB_URI: z.string().default('mongodb://localhost:27017/gitweave'),
  MONGODB_DB_NAME: z.string().default('gitweave'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_CACHE_TTL_SECONDS: num(300),

  INGEST_CONCURRENCY: num(6),
  INGEST_PAGE_SIZE: num(50),
  INGEST_RATE_LIMIT_BUFFER: num(500),
  INGEST_MAX_RETRIES: num(5),
  INGEST_BACKOFF_BASE_MS: num(1000),
  SYNC_CRON: z.string().default('*/15 * * * *'),
  BACKFILL_ON_BOOT: bool(false),

  BOT_DENYLIST: csv([
    'stamphog', 'greptile-apps', 'veria-ai', 'coderabbitai',
    'copilot-pull-request-reviewer', 'dependabot', 'dependabot-preview',
    'scheduled-actions-posthog', 'github-actions', 'renovate', 'sentry-io',
    'codecov', 'posthog-bot', 'inkeep',
  ]),
  AGENT_AUTHORS: csv(['posthog']),
  AGENT_BRANCH_PREFIXES: csv(['posthog-self-driving/']),
  ATTRIBUTE_AGENT_PRS_TO_HUMANS: bool(true),

  WEIGHT_OWNERSHIP: num(0.28),
  WEIGHT_LEVERAGE: num(0.30),
  WEIGHT_REACH: num(0.18),
  WEIGHT_INITIATIVE: num(0.14),
  WEIGHT_PROBLEM_SHAPING: num(0.10),
  RELIABILITY_MODIFIER_MIN: num(0.85),
  RELIABILITY_MODIFIER_MAX: num(1.10),
  RELIABILITY_PENALTY_FACTOR: num(1.2),
  MIN_PRS_FOR_RANKING: num(5),
  BLAST_RADIUS_MULTIPLIER: num(1.6),
  LOW_RISK_PATH_MULTIPLIER: num(0.4),

  API_PORT: num(4000),
  WEB_PORT: num(3000),
  NEXT_PUBLIC_API_URL: z.string().default('http://localhost:4000'),

  FEATURE_LLM_SUMMARIES: bool(false),
  FEATURE_AGENT_LEVERAGE_PANEL: bool(true),
  FEATURE_TEAM_ROLLUP: bool(true),
  FEATURE_EXPORT: bool(true),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Every credential available for rate-limit pooling. */
export function resolveTokens(env: Env = getEnv()): string[] {
  const pool = [...env.GITHUB_TOKENS];
  if (env.GITHUB_TOKEN && !pool.includes(env.GITHUB_TOKEN)) pool.unshift(env.GITHUB_TOKEN);
  return pool.filter(Boolean);
}

export function scoringConfig(env: Env = getEnv()) {
  return {
    weights: {
      ownership: env.WEIGHT_OWNERSHIP,
      leverage: env.WEIGHT_LEVERAGE,
      reach: env.WEIGHT_REACH,
      initiative: env.WEIGHT_INITIATIVE,
      problemShaping: env.WEIGHT_PROBLEM_SHAPING,
    },
    reliability: {
      min: env.RELIABILITY_MODIFIER_MIN,
      max: env.RELIABILITY_MODIFIER_MAX,
      penaltyFactor: env.RELIABILITY_PENALTY_FACTOR,
    },
    minPRsForRanking: env.MIN_PRS_FOR_RANKING,
    blastRadiusMultiplier: env.BLAST_RADIUS_MULTIPLIER,
    lowRiskPathMultiplier: env.LOW_RISK_PATH_MULTIPLIER,
    botDenylist: env.BOT_DENYLIST,
    agentAuthors: env.AGENT_AUTHORS,
    agentBranchPrefixes: env.AGENT_BRANCH_PREFIXES,
    attributeAgentPRs: env.ATTRIBUTE_AGENT_PRS_TO_HUMANS,
  };
}
export type ScoringConfig = ReturnType<typeof scoringConfig>;
