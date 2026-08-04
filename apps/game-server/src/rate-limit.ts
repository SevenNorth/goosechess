export interface RateLimitPolicy {
  readonly capacity: number
  readonly refillWindowMs: number
}

export interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs: number
}

interface Bucket {
  tokens: number
  updatedAt: number
  lastSeenAt: number
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {
    if (!Number.isInteger(policy.capacity) || policy.capacity <= 0) {
      throw new Error('Rate limit capacity must be a positive integer.')
    }
    if (!Number.isInteger(policy.refillWindowMs) || policy.refillWindowMs <= 0) {
      throw new Error('Rate limit refillWindowMs must be a positive integer.')
    }
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('Rate limit maxEntries must be a positive integer.')
    }
  }

  consume(key: string): RateLimitResult {
    const now = this.now()
    const bucket = this.buckets.get(key) ?? {
      tokens: this.policy.capacity,
      updatedAt: now,
      lastSeenAt: now,
    }
    const elapsed = Math.max(0, now - bucket.updatedAt)
    const tokensPerMs = this.policy.capacity / this.policy.refillWindowMs
    bucket.tokens = Math.min(this.policy.capacity, bucket.tokens + elapsed * tokensPerMs)
    bucket.updatedAt = now
    bucket.lastSeenAt = now

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      this.buckets.set(key, bucket)
      this.prune()
      return { allowed: true, retryAfterMs: 0 }
    }

    this.buckets.set(key, bucket)
    this.prune()
    return {
      allowed: false,
      retryAfterMs: Math.max(1, Math.ceil((1 - bucket.tokens) / tokensPerMs)),
    }
  }

  private prune() {
    if (this.buckets.size <= this.maxEntries) return
    const overflow = this.buckets.size - this.maxEntries
    const oldest = [...this.buckets.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, overflow)
    oldest.forEach(([key]) => this.buckets.delete(key))
  }
}
