/**
 * LRU Cache with TTL - O(1) operations, O(n) TTL cleanup
 *
 * Features:
 * - O(1) get/set/delete via Map + doubly-linked list
 * - O(1) LRU eviction (oldest first)
 * - O(n) TTL cleanup (scans from oldest, stops at first non-expired)
 * - Batched cleanup to amortize overhead
 * - Configurable max size and TTL
 *
 * Performance characteristics:
 * - get(): O(1) - Map lookup + LRU update
 * - set(): O(1) - Map insert + LRU append
 * - delete(): O(1) - Map delete + LRU remove
 * - cleanup(): O(k) where k = expired entries (stops early)
 * - Amortized: O(1) per operation with batched cleanup
 */

interface LRUNode<K> {
  key: K;
  expiresAt: number;
  prev: LRUNode<K> | null;
  next: LRUNode<K> | null;
}

export interface LRUCacheConfig {
  /** Maximum number of entries (triggers LRU eviction) */
  maxSize: number;
  /** Time-to-live in milliseconds (0 = no expiration) */
  ttlMs: number;
  /** Cleanup interval in milliseconds (0 = manual only) */
  cleanupIntervalMs: number;
  /** Number of operations between cleanup checks */
  cleanupBatchSize: number;
  /** Callback when entry is evicted */
  onEvict?: (key: string, value: unknown) => void;
}

export class LRUCache<K extends string, V> {
  private cache = new Map<K, V>();
  private lruNodes = new Map<K, LRUNode<K>>();

  // Doubly-linked list: head = oldest, tail = newest
  private lruHead: LRUNode<K> | null = null;
  private lruTail: LRUNode<K> | null = null;

  private config: LRUCacheConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private opsSinceCleanup = 0;

  constructor(config: Partial<LRUCacheConfig> = {}) {
    this.config = {
      maxSize: config.maxSize ?? 100,
      ttlMs: config.ttlMs ?? 30 * 60 * 1000, // 30 min default
      cleanupIntervalMs: config.cleanupIntervalMs ?? 5 * 60 * 1000, // 5 min
      cleanupBatchSize: config.cleanupBatchSize ?? 10,
      onEvict: config.onEvict,
    };

    if (this.config.cleanupIntervalMs > 0) {
      this.startCleanup();
    }
  }

  /**
   * Get value by key. Returns undefined if expired or missing.
   * O(1) operation.
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value === undefined) {
      return undefined;
    }

    const node = this.lruNodes.get(key);
    if (!node) {
      // Shouldn't happen, but handle gracefully
      this.cache.delete(key);
      return undefined;
    }

    // Check expiration
    if (this.config.ttlMs > 0 && node.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }

    // Move to tail (mark as recently used)
    this.touch(key);

    // Batched cleanup
    this.batchedCleanup();

    return value;
  }

  /**
   * Set value with key. Evicts LRU if at capacity.
   * O(1) operation.
   */
  set(key: K, value: V): void {
    const expiresAt =
      this.config.ttlMs > 0 ? Date.now() + this.config.ttlMs : Number.MAX_SAFE_INTEGER;

    // Update existing entry
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      this.touchWithExpiry(key, expiresAt);
      this.batchedCleanup();
      return;
    }

    // Enforce max size - evict LRU (oldest)
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }

    // Insert new entry
    this.cache.set(key, value);
    this.addLRUNode(key, expiresAt);

    // Batched cleanup
    this.batchedCleanup();
  }

  /**
   * Check if key exists and is not expired.
   * O(1) operation.
   */
  has(key: K): boolean {
    if (!this.cache.has(key)) {
      return false;
    }

    const node = this.lruNodes.get(key);
    if (!node) {
      return false;
    }

    // Check expiration
    if (this.config.ttlMs > 0 && node.expiresAt <= Date.now()) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete entry by key.
   * O(1) operation.
   */
  delete(key: K): boolean {
    const value = this.cache.get(key);
    const existed = this.cache.delete(key);

    if (existed) {
      const node = this.lruNodes.get(key);
      if (node) {
        this.removeLRUNode(node);
        this.lruNodes.delete(key);
      }

      if (this.config.onEvict) {
        this.config.onEvict(key, value);
      }
    }

    return existed;
  }

  /**
   * Clear all entries.
   * O(n) operation.
   */
  clear(): void {
    if (this.config.onEvict) {
      for (const [key, value] of this.cache.entries()) {
        this.config.onEvict(key, value);
      }
    }

    this.cache.clear();
    this.lruNodes.clear();
    this.lruHead = null;
    this.lruTail = null;
  }

  /**
   * Get cache size.
   * O(1) operation.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys (not ordered).
   * O(n) operation.
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all values (not ordered).
   * O(n) operation.
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Get all entries (not ordered).
   * O(n) operation.
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * Touch key to mark as recently used.
   * O(1) operation.
   */
  touch(key: K): boolean {
    const node = this.lruNodes.get(key);
    if (!node) {
      return false;
    }

    // Move to tail (most recent)
    this.removeLRUNode(node);
    this.appendLRUNode(node);

    // Update expiration
    if (this.config.ttlMs > 0) {
      node.expiresAt = Date.now() + this.config.ttlMs;
    }

    return true;
  }

  /**
   * Touch key and update expiration time.
   * O(1) operation (internal use).
   */
  private touchWithExpiry(key: K, expiresAt: number): void {
    const node = this.lruNodes.get(key);
    if (!node) {
      return;
    }

    node.expiresAt = expiresAt;
    this.removeLRUNode(node);
    this.appendLRUNode(node);
  }

  /**
   * Evict least recently used entry.
   * O(1) operation.
   */
  private evictLRU(): void {
    if (!this.lruHead) {
      return;
    }

    const key = this.lruHead.key;
    this.delete(key);
  }

  /**
   * Add new LRU node at tail (most recent).
   * O(1) operation.
   */
  private addLRUNode(key: K, expiresAt: number): void {
    const node: LRUNode<K> = {
      key,
      expiresAt,
      prev: null,
      next: null,
    };

    this.lruNodes.set(key, node);
    this.appendLRUNode(node);
  }

  /**
   * Append node to tail of LRU list.
   * O(1) operation.
   */
  private appendLRUNode(node: LRUNode<K>): void {
    node.prev = this.lruTail;
    node.next = null;

    if (this.lruTail) {
      this.lruTail.next = node;
    } else {
      // List was empty
      this.lruHead = node;
    }

    this.lruTail = node;
  }

  /**
   * Remove node from LRU linked list.
   * O(1) operation.
   */
  private removeLRUNode(node: LRUNode<K>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      // Was head
      this.lruHead = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      // Was tail
      this.lruTail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * O(n) TTL cleanup - scans from oldest until non-expired.
   * Amortized O(1) since each entry cleaned at most once.
   */
  cleanup(): number {
    if (this.config.ttlMs === 0) {
      return 0; // No TTL configured
    }

    const now = Date.now();
    let cleanedCount = 0;

    // Walk from head (oldest) to tail (newest)
    let node = this.lruHead;
    while (node && node.expiresAt <= now) {
      const key = node.key;
      const nextNode = node.next; // Save before deletion

      this.delete(key);
      cleanedCount++;

      node = nextNode;
    }

    return cleanedCount;
  }

  /**
   * Batched cleanup - only runs every N operations.
   */
  private batchedCleanup(): void {
    this.opsSinceCleanup++;
    if (this.opsSinceCleanup >= this.config.cleanupBatchSize) {
      this.opsSinceCleanup = 0;
      this.cleanup();
    }
  }

  /**
   * Start automatic cleanup timer.
   */
  private startCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      const cleaned = this.cleanup();
      if (cleaned > 0) {
        // Optional: log or emit event
        // console.log(`[LRUCache] Cleaned ${cleaned} expired entries`);
      }
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Stop automatic cleanup timer.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Destroy cache and cleanup timer.
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
  }

  /**
   * Get stats for monitoring.
   */
  getStats(): {
    size: number;
    maxSize: number;
    oldestExpiresAt: number | null;
    newestExpiresAt: number | null;
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      oldestExpiresAt: this.lruHead?.expiresAt ?? null,
      newestExpiresAt: this.lruTail?.expiresAt ?? null,
    };
  }
}
