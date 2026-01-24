/**
 * Token counting with tiktoken (o200k_base encoding)
 * Features:
 * - Real token counts using OpenAI's tiktoken library
 * - LRU cache for repeat text (O(1) lookups)
 * - Embedded token tracking in Session (no WeakMap indirection)
 * - Automatic cache warming for common patterns
 */

import { encoding_for_model, type Tiktoken } from "tiktoken";
import { LRUCache } from "./LRUCache.ts";

// ============================================================================
// TIKTOKEN SINGLETON
// ============================================================================

let tiktoken: Tiktoken | null = null;

/**
 * Get or initialize the tiktoken encoder (o200k_base for GPT-4o, o1, etc.)
 * Lazy initialization to avoid startup cost.
 */
function getTiktoken(): Tiktoken {
  if (!tiktoken) {
    // o200k_base is used by: gpt-4o, gpt-4o-mini, o1-preview, o1-mini, o3-mini
    tiktoken = encoding_for_model("gpt-4o");
  }
  return tiktoken!; // Non-null assertion safe after assignment
}

/**
 * Free tiktoken resources (call on server shutdown)
 */
export function closeTiktoken(): void {
  if (tiktoken) {
    tiktoken.free();
    tiktoken = null;
  }
}

// ============================================================================
// TOKEN COUNT CACHE (LRU with 10k entries, 30 min TTL)
// ============================================================================

const tokenCache = new LRUCache<string, number>({
  maxSize: 10000, // Cache up to 10k unique strings
  ttlMs: 30 * 60 * 1000, // 30 minute TTL
  cleanupIntervalMs: 5 * 60 * 1000, // Cleanup every 5 min
  cleanupBatchSize: 50, // Check cleanup every 50 operations
});

/**
 * Count tokens with caching.
 * Uses tiktoken o200k_base encoding for accurate counts.
 * O(1) for cached strings, O(n) for new strings (where n = text length).
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  // Check cache first
  const cached = tokenCache.get(text);
  if (cached !== undefined) {
    return cached;
  }

  // Count with tiktoken
  const encoder = getTiktoken();
  const tokens = encoder.encode(text);
  const count = tokens.length;

  // Cache result
  tokenCache.set(text, count);

  return count;
}

/**
 * Count tokens for a JSON-serializable object
 */
export function countObjectTokens(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  const json = JSON.stringify(obj);
  return countTokens(json);
}

/**
 * Get cache stats for monitoring
 */
export function getTokenCacheStats() {
  return tokenCache.getStats();
}

/**
 * Clear token count cache (useful for testing)
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}

// ============================================================================
// TOKEN USAGE TRACKING (embedded in Session)
// ============================================================================

/**
 * Cumulative token usage for a session.
 * This is now embedded directly in Session interface.
 */
export interface TokenUsage {
  /** Total input tokens across all operations */
  input: number;
  /** Total output tokens across all operations */
  output: number;
  /** Total cached tokens (from prompt caching, if supported) */
  cached?: number;
  /** Number of operations tracked */
  operations: number;
}

/**
 * Token usage metadata for tool responses
 */
export interface TokenUsageMetadata {
  /** Tokens in the tool input */
  input_tokens: number;
  /** Tokens in the tool output */
  output_tokens: number;
  /** Total tokens */
  total_tokens: number;
}

/**
 * Calculate token usage for a tool call
 */
export function calculateTokenUsage(input: unknown, output: unknown): TokenUsageMetadata {
  const inputTokens = countObjectTokens(input);
  const outputTokens = countObjectTokens(output);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

// ============================================================================
// LEGACY COMPATIBILITY (for gradual migration)
// ============================================================================

/**
 * @deprecated Use countTokens() instead. Kept for backward compatibility.
 */
export function estimateTokens(text: string, _model?: string): number {
  return countTokens(text);
}

/**
 * @deprecated Use countObjectTokens() instead. Kept for backward compatibility.
 */
export function estimateObjectTokens(obj: unknown, _model?: string): number {
  return countObjectTokens(obj);
}

// Note: Session token tracking functions (trackSessionTokens, getSessionTokens, etc.)
// are removed. Token usage is now embedded in Session.tokenUsage field.
// Migration guide:
// - Old: trackSessionTokens(sessionId, usage)
// - New: session.tokenUsage.input += usage.input_tokens
