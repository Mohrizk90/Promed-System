/**
 * Simple per-chatId token bucket.
 * - capacity = RATE_LIMIT_PER_MIN
 * - refill rate = 1 token / (60_000 / capacity) ms  (so the bucket fully refills in 1 minute)
 */

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;

  constructor(perMinute: number, private readonly clock: () => number = Date.now) {
    this.capacity = perMinute;
    this.tokens = perMinute;
    this.lastRefill = this.clock();
    this.refillPerMs = perMinute / 60_000;
  }

  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = this.clock();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const add = elapsed * this.refillPerMs;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefill = now;
  }
}

export class RateLimiter {
  private readonly buckets = new Map<number, TokenBucket>();

  constructor(private readonly perMinute: number) {}

  allow(chatId: number): boolean {
    let b = this.buckets.get(chatId);
    if (!b) {
      b = new TokenBucket(this.perMinute);
      this.buckets.set(chatId, b);
    }
    return b.tryConsume();
  }
}
