/**
 * Small TTL cache in front of the materialised metrics document.
 *
 * Deliberately in-process rather than Redis: the API reads one pre-computed
 * document per (repo, window), so a shared cache would add a network hop and
 * a failure mode to save a single indexed lookup. Redis stays where it earns
 * its keep — the ingest job queue.
 */
export class TTLCache<T> {
  private readonly store = new Map<string, { value: T; expires: number }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 32) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) { this.store.delete(key); return undefined; }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  clear(): void { this.store.clear(); }
}
