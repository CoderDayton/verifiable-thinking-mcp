import { describe, expect, test } from "bun:test";
import { LRUCache } from "../src/infra/lru-cache.ts";

describe("LRUCache Performance", () => {
  test("O(1) get/set operations", () => {
    const cache = new LRUCache<string, string>({
      maxSize: 10000,
      ttlMs: 60000,
      cleanupIntervalMs: 0, // Manual cleanup for testing
      cleanupBatchSize: 100,
    });

    // Warm up
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, `value${i}`);
    }

    // Measure set() operations
    const setIterations = 10000;
    const setStart = performance.now();
    for (let i = 0; i < setIterations; i++) {
      cache.set(`key${i}`, `value${i}`);
    }
    const setDuration = performance.now() - setStart;
    const avgSet = setDuration / setIterations;

    // Measure get() operations
    const getIterations = 10000;
    const getStart = performance.now();
    for (let i = 0; i < getIterations; i++) {
      cache.get(`key${i % 1000}`);
    }
    const getDuration = performance.now() - getStart;
    const avgGet = getDuration / getIterations;

    console.log(`Average set(): ${avgSet.toFixed(6)}ms`);
    console.log(`Average get(): ${avgGet.toFixed(6)}ms`);

    // O(1) operations should be < 0.01ms each
    expect(avgSet).toBeLessThan(0.01);
    expect(avgGet).toBeLessThan(0.01);

    cache.destroy();
  });

  test("LRU eviction performance", () => {
    const evicted: string[] = [];
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      ttlMs: 60000,
      cleanupIntervalMs: 0,
      cleanupBatchSize: 10,
      onEvict: (key) => evicted.push(key),
    });

    // Fill cache to capacity
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, `value${i}`);
    }

    // Add one more - should evict LRU (key0)
    const evictStart = performance.now();
    cache.set("key100", "value100");
    const evictDuration = performance.now() - evictStart;

    console.log(`LRU eviction took ${evictDuration.toFixed(6)}ms`);

    // Should evict oldest entry
    expect(evicted).toContain("key0");
    expect(cache.size).toBe(100);
    // Eviction should be O(1)
    expect(evictDuration).toBeLessThan(0.1);

    cache.destroy();
  });

  test("Batch cleanup performance", () => {
    const cache = new LRUCache<string, string>({
      maxSize: 10000,
      ttlMs: 50, // Very short TTL
      cleanupIntervalMs: 0, // Manual
      cleanupBatchSize: 10, // Cleanup every 10 ops
    });

    // Create 1000 entries
    for (let i = 0; i < 1000; i++) {
      cache.set(`key${i}`, `value${i}`);
    }

    // Wait for all to expire
    Bun.sleepSync(100);

    // Trigger manual cleanup since batched cleanup won't happen if we don't call get/set
    const accessStart = performance.now();
    const cleaned = cache.cleanup();
    const accessDuration = performance.now() - accessStart;

    console.log(`Manual cleanup of 1000 expired entries: ${accessDuration.toFixed(3)}ms`);
    console.log(`Cleaned: ${cleaned}, Final cache size: ${cache.size}`);

    // All 1000 entries should be cleaned up
    expect(cleaned).toBe(1000);
    expect(cache.size).toBe(0);
    // Cleanup should be fast
    expect(accessDuration).toBeLessThan(50);

    cache.destroy();
  });

  test("Memory recycling - session pool", () => {
    const cache = new LRUCache<string, { data: number[] }>({
      maxSize: 100,
      ttlMs: 100,
      cleanupIntervalMs: 0,
      cleanupBatchSize: 10,
    });

    // Create large objects
    for (let i = 0; i < 100; i++) {
      cache.set(`key${i}`, { data: new Array(1000).fill(i) });
    }

    // Wait for expiration
    Bun.sleepSync(150);

    // Cleanup
    const cleanupStart = performance.now();
    const cleaned = cache.cleanup();
    const cleanupDuration = performance.now() - cleanupStart;

    console.log(`Cleaned ${cleaned} large objects in ${cleanupDuration.toFixed(3)}ms`);

    expect(cleaned).toBe(100);
    expect(cache.size).toBe(0);
    // Even with large objects, cleanup should be fast (O(n) iteration only)
    expect(cleanupDuration).toBeLessThan(20);

    cache.destroy();
  });

  test("Stats tracking", () => {
    const cache = new LRUCache<string, string>({
      maxSize: 10,
      ttlMs: 1000,
      cleanupIntervalMs: 0,
      cleanupBatchSize: 5,
    });

    // Add entries at different times
    cache.set("key1", "value1");
    Bun.sleepSync(10);
    cache.set("key2", "value2");
    Bun.sleepSync(10);
    cache.set("key3", "value3");

    const stats = cache.getStats();

    console.log("Cache stats:", stats);

    expect(stats.size).toBe(3);
    expect(stats.maxSize).toBe(10);
    expect(stats.oldestExpiresAt).toBeLessThan(stats.newestExpiresAt!);

    cache.destroy();
  });
});
