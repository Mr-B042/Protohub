/**
 * A tiny in-process TTL cache for near-static reads.
 *
 * Why this exists: pg_stat_statements showed 228,759 PostgREST calls a day, and
 * roughly half of them were the same handful of questions asked over and over -
 * the caller's user profile on every request, the org's branding on every
 * notification, the SMS/WhatsApp/bonus settings on every evaluation. That data
 * changes a few times a week; we were reading it a few times a second, and
 * paying Supabase egress for every answer.
 *
 * Deliberately in-process and unbounded-by-time-only:
 *  - The runtime is single-process (the WhatsApp socket already assumes this),
 *    so a shared cache would add a dependency for no benefit.
 *  - Keys are org ids and user ids, so the map is bounded by the org's size,
 *    not by traffic. There is no eviction beyond expiry because there is
 *    nothing here that grows.
 *
 * Anything cached MUST be safe to serve up to `ttlMs` stale, or must call
 * invalidate() on write. Never cache a permission decision - cache the row the
 * decision is made from, and drop it the moment that row is written.
 */
type Entry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(private readonly ttlMs: number) {}

  /**
   * Returns the cached value, or loads it. Concurrent misses for the same key
   * share one load - without this, a burst of requests on a cold key would each
   * fire their own query and we would have replaced a steady drip with a spike.
   */
  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const pending = load()
      .then((value) => {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, pending);
    return pending;
  }

  /** Drop one key - call this on any write to the row it came from. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Drop everything - for writes whose blast radius is not a single key. */
  clear(): void {
    this.store.clear();
  }

  /** Exposed for the /health endpoint so cache size is observable, not assumed. */
  get size(): number {
    return this.store.size;
  }
}
