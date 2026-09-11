import { logger } from './logger.js';
import { TokenPool } from './token-pool.js';

export interface RateLimitBlock {
  limit: number; cost: number; remaining: number; resetAt: string; nodeCount?: number;
}

export interface GraphQLResponse<T> {
  data?: T & { rateLimit?: RateLimitBlock };
  errors?: Array<{ message: string; type?: string }>;
}

export interface ClientOptions {
  tokens: string[];
  endpoint?: string;
  concurrency?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  rateLimitBuffer?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter — avoids thundering-herd retries. */
const jitteredBackoff = (attempt: number, base: number) =>
  Math.random() * Math.min(base * 2 ** attempt, 60_000);

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) { this.active += 1; return () => this.release(); }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    return () => this.release();
  }
  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * Cost-aware GitHub GraphQL client.
 *
 * Reads `rateLimit { cost remaining resetAt }` off every response and lets the
 * pool schedule against real cost rather than guessing. Caps concurrency to
 * respect GitHub's *secondary* (concurrent-request) limit, which is separate
 * from the documented points budget and is the usual cause of mystery 403s.
 */
export class GitHubGraphQLClient {
  private readonly pool: TokenPool;
  private readonly endpoint: string;
  private readonly sem: Semaphore;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  public totalCost = 0;
  public totalRequests = 0;

  constructor(opts: ClientOptions) {
    this.pool = new TokenPool(opts.tokens, opts.rateLimitBuffer ?? 500);
    this.endpoint = opts.endpoint ?? 'https://api.github.com/graphql';
    this.sem = new Semaphore(Math.min(opts.concurrency ?? 6, 8));
    this.maxRetries = opts.maxRetries ?? 5;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1000;
  }

  get poolSize(): number { return this.pool.size; }
  poolSnapshot() { return this.pool.snapshot(); }

  async query<T>(query: string, variables: Record<string, unknown>): Promise<T & { rateLimit?: RateLimitBlock }> {
    const release = await this.sem.acquire();
    try {
      return await this.execute<T>(query, variables);
    } finally {
      release();
    }
  }

  private async execute<T>(query: string, variables: Record<string, unknown>, attempt = 0): Promise<T & { rateLimit?: RateLimitBlock }> {
    const state = this.pool.acquire();
    if (!state) {
      const wait = this.pool.msUntilAnyReset();
      logger.warn({ waitMs: wait }, 'All tokens exhausted — sleeping until reset');
      await sleep(wait);
      return this.execute<T>(query, variables, attempt);
    }

    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'GitWeave/1.0',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      this.pool.penalise(state);
      if (attempt >= this.maxRetries) throw err;
      await sleep(jitteredBackoff(attempt, this.backoffBaseMs));
      return this.execute<T>(query, variables, attempt + 1);
    }

    // Secondary rate limit / abuse detection.
    if (res.status === 403 || res.status === 429) {
      this.pool.penalise(state);
      const retryAfter = Number(res.headers.get('retry-after') ?? 0);
      const wait = retryAfter > 0 ? retryAfter * 1000 : jitteredBackoff(attempt, this.backoffBaseMs);
      logger.warn({ status: res.status, waitMs: Math.round(wait), attempt }, 'Secondary rate limit — backing off');
      if (attempt >= this.maxRetries) throw new Error(`GitHub rate limited after ${attempt} retries`);
      await sleep(wait);
      return this.execute<T>(query, variables, attempt + 1);
    }

    if (res.status >= 500) {
      this.pool.penalise(state);
      if (attempt >= this.maxRetries) throw new Error(`GitHub ${res.status} after ${attempt} retries`);
      await sleep(jitteredBackoff(attempt, this.backoffBaseMs));
      return this.execute<T>(query, variables, attempt + 1);
    }

    if (!res.ok) {
      this.pool.penalise(state);
      throw new Error(`GitHub GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }

    const body = (await res.json()) as GraphQLResponse<T>;
    const rateLimit = body.data?.rateLimit;
    this.pool.release(state, rateLimit);
    this.totalRequests += 1;
    if (rateLimit) this.totalCost += rateLimit.cost;

    if (body.errors?.length) {
      const messages = body.errors.map((e) => e.message).join('; ');
      // Partial data with only RATE_LIMITED/timeout errors → retry.
      const retryable = body.errors.some((e) =>
        e.type === 'RATE_LIMITED' || /timeout|temporar/i.test(e.message));
      if (retryable && attempt < this.maxRetries) {
        logger.warn({ messages, attempt }, 'Retryable GraphQL error');
        await sleep(jitteredBackoff(attempt, this.backoffBaseMs));
        return this.execute<T>(query, variables, attempt + 1);
      }
      if (!body.data) throw new Error(`GitHub GraphQL error: ${messages}`);
      logger.warn({ messages }, 'GraphQL returned partial data with errors — continuing');
    }

    if (!body.data) throw new Error('GitHub GraphQL returned no data');
    return body.data as T & { rateLimit?: RateLimitBlock };
  }
}
