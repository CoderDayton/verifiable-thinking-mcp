/**
 * Verification Cache - Content-hash based caching for verification results
 * Skips re-verification of identical thoughts across sessions
 * Includes rate limiting to prevent memory exhaustion under high load
 */

import type { VerificationDomain, VerificationResult } from "./verification.ts";

interface CacheEntry {
  result: VerificationResult;
  timestamp: number;
  hits: number;
}

interface RateLimitWindow {
  count: number;
  window_start: number;
}

interface CacheConfig {
  max_entries: number;
  ttl_ms: number;
  // Rate limiting
  rate_limit_ops: number; // Max operations per window
  rate_limit_window_ms: number; // Window size in ms
}

const DEFAULT_CONFIG: CacheConfig = {
  max_entries: 1000,
  ttl_ms: 60 * 60 * 1000, // 1 hour
  rate_limit_ops: 100, // 100 ops per second
  rate_limit_window_ms: 1000, // 1 second window
};

export interface CacheStats {
  size: number;
  max: number;
  hit_rate: number;
  hits: number;
  misses: number;
  rate_limited: number;
  ops_in_window: number;
}

class VerificationCacheImpl {
  private cache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;

  // Rate limiting state
  private rateLimit: RateLimitWindow = { count: 0, window_start: Date.now() };
  private rateLimitedCount = 0;

  // Stats
  private totalHits = 0;
  private totalMisses = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check and update rate limit. Returns true if operation is allowed.
   */
  private checkRateLimit(): boolean {
    const now = Date.now();

    // Reset window if expired
    if (now - this.rateLimit.window_start >= this.config.rate_limit_window_ms) {
      this.rateLimit = { count: 0, window_start: now };
    }

    // Check if under limit
    if (this.rateLimit.count >= this.config.rate_limit_ops) {
      this.rateLimitedCount++;
      return false;
    }

    this.rateLimit.count++;
    return true;
  }

  /**
   * Generate cache key from thought content, domain, and context hash
   */
  private generateKey(thought: string, domain: VerificationDomain, context: string[]): string {
    const contextHash = this.hashString(context.join("|"));
    const thoughtHash = this.hashString(thought);
    return `${domain}:${thoughtHash}:${contextHash}`;
  }

  /**
   * Simple string hash (djb2 algorithm)
   */
  private hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Get cached verification result if exists and not expired
   * Returns null if rate limited or cache miss
   */
  get(thought: string, domain: VerificationDomain, context: string[]): VerificationResult | null {
    // Rate limit check
    if (!this.checkRateLimit()) {
      return null;
    }

    const key = this.generateKey(thought, domain, context);
    const entry = this.cache.get(key);

    if (!entry) {
      this.totalMisses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttl_ms) {
      this.cache.delete(key);
      this.totalMisses++;
      return null;
    }

    // Update hit count
    entry.hits++;
    this.totalHits++;
    return entry.result;
  }

  /**
   * Store verification result in cache
   * Respects rate limiting - silently drops if rate limited
   */
  set(
    thought: string,
    domain: VerificationDomain,
    context: string[],
    result: VerificationResult,
  ): boolean {
    // Rate limit check
    if (!this.checkRateLimit()) {
      return false;
    }

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.config.max_entries) {
      this.evictOldest();
    }

    const key = this.generateKey(thought, domain, context);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      hits: 0,
    });
    return true;
  }

  /**
   * Evict oldest/least-hit entries
   */
  private evictOldest(): void {
    // Remove entries that are expired first
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.config.ttl_ms) {
        this.cache.delete(key);
      }
    }

    // If still over limit, remove lowest hit count entries
    if (this.cache.size >= this.config.max_entries) {
      const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].hits - b[1].hits);

      const toRemove = Math.ceil(this.config.max_entries * 0.1); // Remove 10%
      for (let i = 0; i < toRemove && i < entries.length; i++) {
        const entry = entries[i];
        if (entry) this.cache.delete(entry[0]);
      }
    }
  }

  /**
   * Get cache statistics including rate limiting info
   */
  getStats(): CacheStats {
    let _entryHits = 0;
    for (const entry of this.cache.values()) {
      _entryHits += entry.hits;
    }

    return {
      size: this.cache.size,
      max: this.config.max_entries,
      hit_rate:
        this.totalHits + this.totalMisses > 0
          ? this.totalHits / (this.totalHits + this.totalMisses)
          : 0,
      hits: this.totalHits,
      misses: this.totalMisses,
      rate_limited: this.rateLimitedCount,
      ops_in_window: this.rateLimit.count,
    };
  }

  /**
   * Check if currently rate limited
   */
  isRateLimited(): boolean {
    const now = Date.now();
    if (now - this.rateLimit.window_start >= this.config.rate_limit_window_ms) {
      return false;
    }
    return this.rateLimit.count >= this.config.rate_limit_ops;
  }

  /**
   * Clear all cached entries and reset stats
   */
  clear(): number {
    const count = this.cache.size;
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
    this.rateLimitedCount = 0;
    this.rateLimit = { count: 0, window_start: Date.now() };
    return count;
  }

  /**
   * Update configuration (useful for testing)
   */
  configure(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance
export const verificationCache = new VerificationCacheImpl();

// Export class for testing with custom config
export { VerificationCacheImpl as VerificationCache };
