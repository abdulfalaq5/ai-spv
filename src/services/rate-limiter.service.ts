// =============================================================================
// RateLimiterService — in-memory sliding window rate limiter
// 10 requests per 60 seconds per user_id
// =============================================================================

interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiterService {
  private readonly store = new Map<string | number, RateLimitEntry>();

  /**
   * @param userId   - Telegram user_id (or any string key)
   * @param limit    - max requests allowed in the window (default: 10)
   * @param windowMs - window duration in ms (default: 60_000 = 1 minute)
   */
  isAllowed(userId: string | number, limit = 10, windowMs = 60_000): boolean {
    const now = Date.now();
    const entry = this.store.get(userId) ?? { timestamps: [] };

    // Evict timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= limit) {
      this.store.set(userId, entry);
      return false;
    }

    entry.timestamps.push(now);
    this.store.set(userId, entry);
    return true;
  }

  /** Returns how many seconds until the oldest entry in window expires */
  retryAfterSeconds(userId: string | number, windowMs = 60_000): number {
    const entry = this.store.get(userId);
    if (!entry || entry.timestamps.length === 0) return 0;
    const oldest = entry.timestamps[0];
    const remaining = windowMs - (Date.now() - oldest);
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  /** Periodic cleanup to free memory for idle users */
  startCleanup(intervalMs = 5 * 60_000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (entry.timestamps.every((t) => now - t >= 60_000)) {
          this.store.delete(key);
        }
      }
    }, intervalMs);
  }
}

export const rateLimiterService = new RateLimiterService();
// Start periodic cleanup on module load
rateLimiterService.startCleanup();
