import type { BlastRadius, StackZone } from '@gitweave/types';

/** Minimal glob → RegExp. Supports `**`, `*` and `?`; enough for path rules. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more path segments
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else { out += '[^/]*'; }
    } else if (c === '?') { out += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) { out += `\\${c}`;
    } else { out += c; }
  }
  return new RegExp(`^${out}$`);
}

const compile = (globs: string[]) => globs.map(globToRegExp);

/**
 * High blast radius. Seeded from PostHog's own CODEOWNERS — the repo's
 * explicit declaration of "changing this is dangerous" — plus the universal
 * danger zones (schema migrations, CI, infra). We use their judgement,
 * not our guess about their codebase.
 */
export const DEFAULT_CRITICAL_PATTERNS = [
  '**/migrations/**',
  'posthog/clickhouse/**',
  'posthog/hogql/**',
  'posthog/models/**',
  'posthog/settings/**',
  '.github/workflows/**',
  '.github/actions/**',
  '.semgrep/**',
  'rust/**',
  'services/**',
  'docker/**',
  'Dockerfile*',
  'docker-compose*.yml',
  '**/*.sql',
  'bin/**',
];

/** Low blast radius: real work, but a mistake here does not page anyone. */
export const DEFAULT_LOW_RISK_PATTERNS = [
  'docs/**',
  '**/__snapshots__/**',
  '**/*.ambr',
  '**/*.snap',
  '**/*.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'requirements*.txt',
  '**/*.md',
  '**/fixtures/**',
  '**/*.svg',
  '**/*.png',
  '**/*.generated.*',
  '**/generated/**',
];

export class PathClassifier {
  private readonly critical: RegExp[];
  private readonly lowRisk: RegExp[];

  constructor(criticalPatterns = DEFAULT_CRITICAL_PATTERNS, lowRiskPatterns = DEFAULT_LOW_RISK_PATTERNS) {
    this.critical = compile(criticalPatterns);
    this.lowRisk = compile(lowRiskPatterns);
  }

  blastRadius(path: string): BlastRadius {
    // Low-risk wins ties: a snapshot inside rust/ is still a snapshot.
    if (this.lowRisk.some((r) => r.test(path))) return 'low';
    if (this.critical.some((r) => r.test(path))) return 'high';
    return 'normal';
  }

  multiplier(path: string, highMul: number, lowMul: number): number {
    const r = this.blastRadius(path);
    return r === 'high' ? highMul : r === 'low' ? lowMul : 1;
  }
}

/**
 * PostHog's monorepo self-describes its product taxonomy: 85 directories under
 * `products/`. That gives us surface-level ownership attribution for free.
 */
export function resolveProductArea(path: string): string {
  const seg = path.split('/');
  const head = seg[0] ?? '';
  if (head === 'products' && seg[1]) return seg[1];
  if (head === 'posthog' && seg[1]) return `core/${seg[1]}`;
  if (head === 'rust' && seg[1]) return `rust/${seg[1]}`;
  if (head === 'frontend') return 'frontend-shell';
  if (head === 'ee') return 'enterprise';
  if (head === '.github') return 'ci';
  if (head === 'docs') return 'docs';
  if (seg.length === 1) return 'repo-root';
  return head;
}

export function resolveStackZone(path: string): StackZone {
  const lower = path.toLowerCase();
  if (lower.endsWith('.rs') || lower.startsWith('rust/')) return 'rust';
  if (lower.endsWith('.py')) return 'backend';
  if (lower.endsWith('.md') || lower.startsWith('docs/')) return 'docs';
  if (/\.(ya?ml|tf|sh|toml|cfg|ini)$/.test(lower) || lower.startsWith('.github/') || lower.startsWith('docker')) return 'infra';
  if (/\.(tsx|jsx|scss|css|less)$/.test(lower)) return 'frontend';
  if (/\.(ts|js|mjs|cjs)$/.test(lower)) {
    if (lower.startsWith('frontend/') || lower.includes('/frontend/')) return 'frontend';
    return 'node-services';
  }
  return 'other';
}

/** Teams come straight from the repo's own `team/*` labels (37 of them). */
export function resolveTeams(labels: string[]): string[] {
  return labels.filter((l) => l.startsWith('team/')).map((l) => l.slice(5));
}
