import { logger } from './logger.js';

interface TokenState {
  token: string;
  label: string;
  remaining: number;
  resetAt: number;
  inFlight: number;
  consecutiveFailures: number;
}

/**
 * N credentials → N × 5,000 points/hr. On the PostHog dataset this is the
 * difference between a ~3h backfill and a <45min one, for ~60 lines of code.
 */
export class TokenPool {
  private readonly states: TokenState[];
  private readonly buffer: number;

  constructor(tokens: string[], buffer = 500) {
    if (tokens.length === 0) throw new Error('TokenPool requires at least one GitHub token');
    this.buffer = buffer;
    this.states = tokens.map((token, i) => ({
      token,
      label: `token-${i + 1}(…${token.slice(-4)})`,
      remaining: 5000,
      resetAt: 0,
      inFlight: 0,
      consecutiveFailures: 0,
    }));
    logger.info({ tokens: this.states.length }, 'GitHub token pool initialised');
  }

  get size(): number { return this.states.length; }

  /** Least-loaded token with budget left; null if every token is exhausted. */
  acquire(): TokenState | null {
    const now = Date.now();
    for (const s of this.states) {
      if (s.resetAt !== 0 && now >= s.resetAt) {
        s.remaining = 5000;
        s.resetAt = 0;
        s.consecutiveFailures = 0;
      }
    }
    const usable = this.states
      .filter((s) => s.remaining > this.buffer)
      .sort((a, b) => (a.inFlight - b.inFlight) || (b.remaining - a.remaining));
    const chosen = usable[0];
    if (!chosen) return null;
    chosen.inFlight += 1;
    return chosen;
  }

  release(state: TokenState, rateLimit?: { remaining: number; resetAt: string; cost: number }): void {
    state.inFlight = Math.max(0, state.inFlight - 1);
    if (rateLimit) {
      state.remaining = rateLimit.remaining;
      state.resetAt = new Date(rateLimit.resetAt).getTime();
      state.consecutiveFailures = 0;
    } else {
      // No rate-limit block came back (error path) — assume worst case.
      state.remaining = Math.max(0, state.remaining - 1);
    }
  }

  penalise(state: TokenState): void {
    state.inFlight = Math.max(0, state.inFlight - 1);
    state.consecutiveFailures += 1;
  }

  /** ms until the earliest token resets — how long a caller should sleep. */
  msUntilAnyReset(): number {
    const now = Date.now();
    const resets = this.states.map((s) => (s.resetAt > now ? s.resetAt - now : 0));
    const positive = resets.filter((r) => r > 0);
    if (positive.length === 0) return 60_000;
    return Math.min(...positive) + 1_000;
  }

  snapshot() {
    return this.states.map((s) => ({
      label: s.label, remaining: s.remaining, inFlight: s.inFlight,
      resetAt: s.resetAt ? new Date(s.resetAt).toISOString() : null,
    }));
  }
}
export type { TokenState };
