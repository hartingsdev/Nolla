/** Fixed-window in-memory limiter; enough for one API instance. Behind an interface so a shared store can replace it. */
export interface RateLimiter {
  /** true = allowed */
  hit(key: string): boolean;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}
  hit(key: string): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) { this.windows.set(key, { start: t, count: 1 }); return true; }
    w.count += 1;
    return w.count <= this.limit;
  }
}
