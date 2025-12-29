/**
 * LRU Cache for computed results
 */

import type { CacheEntry, CacheStats, ComputeResult } from "./types.ts";

export class ComputeCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 1000, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  private normalize(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
  }

  get(text: string): ComputeResult | null {
    const key = this.normalize(text);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.result;
  }

  set(text: string, result: ComputeResult): void {
    const key = this.normalize(text);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// Global cache instance
export const computeCache = new ComputeCache();

/** Get cache statistics */
export function getCacheStats(): CacheStats {
  return computeCache.stats();
}

/** Clear the compute cache */
export function clearCache(): void {
  computeCache.clear();
}
