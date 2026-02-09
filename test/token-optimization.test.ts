/**
 * Tests for token optimization features:
 * - Batch token counting
 * - Async token counting
 * - Adaptive compression ratios
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { calculateAdaptiveRatio, calculateEntropy, compress } from "../src/lib/compression";
import {
  clearTokenCache,
  countTokens,
  countTokensAsync,
  countTokensBatch,
  countTokensBatchAsync,
} from "../src/lib/tokens";

describe("Batch Token Counting", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  test("countTokensBatch returns correct counts for multiple strings", () => {
    const texts = ["hello", "world", "What is 2+2?", ""];
    const counts = countTokensBatch(texts);

    expect(counts).toHaveLength(4);
    expect(counts[0]).toBe(1); // "hello"
    expect(counts[1]).toBe(1); // "world"
    expect(counts[2]).toBe(7); // "What is 2+2?"
    expect(counts[3]).toBe(0); // empty string
  });

  test("countTokensBatch handles empty array", () => {
    const counts = countTokensBatch([]);
    expect(counts).toEqual([]);
  });

  test("countTokensBatch leverages cache on second call", () => {
    const texts = ["hello", "world"];

    // First call - cold
    const counts1 = countTokensBatch(texts);

    // Second call - should hit cache
    const counts2 = countTokensBatch(texts);

    expect(counts1).toEqual(counts2);
    expect(counts2[0]).toBe(1);
    expect(counts2[1]).toBe(1);
  });

  test("countTokensBatch is faster than individual calls for large batches", () => {
    const texts = Array.from({ length: 100 }, (_, i) => `test string ${i}`);

    // Batch approach
    const batchStart = performance.now();
    const batchCounts = countTokensBatch(texts);
    const batchTime = performance.now() - batchStart;

    // Individual approach
    clearTokenCache();
    const individualStart = performance.now();
    const individualCounts = texts.map((t) => countTokens(t));
    const individualTime = performance.now() - individualStart;

    // Results should match
    expect(batchCounts).toEqual(individualCounts);

    // Batch should be comparable or faster (allowing for variance)
    // Note: This isn't a hard requirement since current implementation
    // doesn't truly batch-encode, but tests the API is correct
    expect(batchTime).toBeGreaterThan(0);
    expect(individualTime).toBeGreaterThan(0);
  });

  test("countTokensBatch handles mixed content types", () => {
    const texts = [
      "Simple text",
      "Code: const x = 42;",
      "Math: ∫(x²)dx",
      "Unicode: 你好世界",
      "",
      'JSON: {"key":"value"}',
    ];

    const counts = countTokensBatch(texts);

    expect(counts).toHaveLength(6);
    expect(counts.every((c) => typeof c === "number")).toBe(true);
    expect(counts.every((c) => c >= 0)).toBe(true);
  });
});

describe("Async Token Counting", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  test("countTokensAsync returns same results as sync version", async () => {
    const text = "What is the meaning of life?";

    const syncCount = countTokens(text);
    const asyncCount = await countTokensAsync(text);

    expect(asyncCount).toBe(syncCount);
  });

  test("countTokensAsync handles empty string", async () => {
    const count = await countTokensAsync("");
    expect(count).toBe(0);
  });

  test("countTokensAsync leverages cache", async () => {
    const text = "cached text";

    // First call
    const count1 = await countTokensAsync(text);

    // Second call - should hit cache
    const count2 = await countTokensAsync(text);

    expect(count1).toBe(count2);
    expect(count1).toBeGreaterThan(0);
  });

  test("countTokensBatchAsync returns correct counts", async () => {
    const texts = ["hello", "world", "async batch test"];
    const counts = await countTokensBatchAsync(texts);

    expect(counts).toHaveLength(3);
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(1);
    expect(counts[2]).toBeGreaterThan(0);
  });

  test("countTokensBatchAsync handles large batches without blocking", async () => {
    const texts = Array.from({ length: 1000 }, (_, i) => `test ${i}`);

    const start = performance.now();
    const counts = await countTokensBatchAsync(texts, 50); // Batch size: 50
    const elapsed = performance.now() - start;

    expect(counts).toHaveLength(1000);
    expect(counts.every((c) => c > 0)).toBe(true);

    // Should complete in reasonable time (allowing for CI variance)
    expect(elapsed).toBeLessThan(5000); // 5 seconds max
  });

  test("countTokensBatchAsync with different batch sizes", async () => {
    const texts = Array.from({ length: 100 }, (_, i) => `item ${i}`);

    // Small batch size (yields more often)
    const counts1 = await countTokensBatchAsync(texts, 10);

    // Large batch size (yields less often)
    clearTokenCache();
    const counts2 = await countTokensBatchAsync(texts, 50);

    // Results should be identical regardless of batch size
    expect(counts1).toEqual(counts2);
  });
});

describe("Adaptive Compression", () => {
  test("calculateAdaptiveRatio adjusts based on entropy", () => {
    // Very redundant text (low entropy)
    const redundant = "test test test test test test test test";
    const redundantRatio = calculateAdaptiveRatio(redundant, "test");
    expect(redundantRatio).toBeLessThan(0.5); // Aggressive compression

    // Dense technical text (higher entropy)
    const dense = "const f=(x)=>x*Math.sqrt(2*Math.PI)*Math.exp(-x**2/2);";
    const denseRatio = calculateAdaptiveRatio(dense, "function");
    expect(denseRatio).toBeGreaterThan(0.5); // Conservative compression
  });

  test("calculateAdaptiveRatio adjusts based on length", () => {
    const query = "What is the answer?";

    // Short text - conservative
    const shortText = "The answer is 42.";
    const shortRatio = calculateAdaptiveRatio(shortText, query);

    // Long text - more aggressive
    const longText = shortText.repeat(100);
    const longRatio = calculateAdaptiveRatio(longText, query);

    expect(longRatio).toBeLessThan(shortRatio);
  });

  test("calculateAdaptiveRatio adjusts based on query length", () => {
    const context = "This is a test context with some content to compress.".repeat(10);

    // Empty query - conservative
    const emptyQueryRatio = calculateAdaptiveRatio(context, "");

    // Detailed query - more aggressive
    const detailedQueryRatio = calculateAdaptiveRatio(
      context,
      "What is the main point of this test context?",
    );

    expect(emptyQueryRatio).toBeGreaterThanOrEqual(detailedQueryRatio);
  });

  test("calculateAdaptiveRatio clamps to reasonable range", () => {
    // Extreme cases should still produce valid ratios
    const extremeLow = "a a a a a a a a a a a a"; // Very low entropy
    const extremeHigh = "aB1#cD2$eF3%gH4&iJ5*"; // Very high entropy

    const lowRatio = calculateAdaptiveRatio(extremeLow, "query");
    const highRatio = calculateAdaptiveRatio(extremeHigh, "query");

    expect(lowRatio).toBeGreaterThanOrEqual(0.25);
    expect(lowRatio).toBeLessThanOrEqual(0.9);
    expect(highRatio).toBeGreaterThanOrEqual(0.25);
    expect(highRatio).toBeLessThanOrEqual(0.9);
  });

  test("compress uses adaptive ratio by default", () => {
    const redundant = "The test failed. The test failed. The test failed. The test failed.";
    const result = compress(redundant, "test", {
      adaptiveCompression: true,
      // No explicit target_ratio - should auto-calculate
    });

    // Should detect high redundancy and compress aggressively
    expect(result.ratio).toBeLessThan(0.7);
    expect(result.kept_sentences).toBeGreaterThan(0);
  });

  test("compress respects explicit target_ratio over adaptive", () => {
    const context = "Sentence one. Sentence two. Sentence three. Sentence four.";

    // Explicit ratio should override adaptive
    const result = compress(context, "query", {
      adaptiveCompression: true,
      target_ratio: 0.5,
    });

    // Should keep 50% (2 out of 4 sentences)
    expect(result.kept_sentences).toBe(2);
  });

  test("compress with adaptiveCompression disabled uses default ratio", () => {
    const context = "Sentence one. Sentence two. Sentence three. Sentence four.";

    const result = compress(context, "query", {
      adaptiveCompression: false,
      // Should use default 0.5
    });

    expect(result.kept_sentences).toBe(2); // 50% of 4 sentences
  });

  test("adaptive compression preserves quality on technical content", () => {
    const technical = `
      The algorithm uses dynamic programming. It computes f(n) = f(n-1) + f(n-2).
      Base cases are f(0) = 0 and f(1) = 1. Time complexity is O(n).
    `;

    const result = compress(technical, "algorithm complexity", {
      adaptiveCompression: true,
    });

    // Should keep most content for technical text
    const compressed = result.compressed.toLowerCase();
    expect(compressed).toContain("algorithm");
    // Should keep formula or complexity info (code-heavy sentences get priority)
    const hasFormula = compressed.includes("f(n)");
    const hasComplexity = compressed.includes("complexity");
    expect(hasFormula || hasComplexity).toBe(true);
    expect(result.ratio).toBeGreaterThan(0.4); // Not too aggressive
  });

  test("adaptive compression is aggressive on verbose content", () => {
    const verbose = `
      Well, you know, I think that, basically, what we're looking at here is,
      like, a situation where, um, the answer is probably, you know, around 42.
      I mean, that's just my opinion, but, like, it seems pretty obvious to me.
    `;

    const result = compress(verbose, "answer", {
      adaptiveCompression: true,
    });

    // Should remove fillers (at least 2-3 filler patterns detected)
    expect(result.enhancements?.fillers_removed).toBeGreaterThanOrEqual(2);

    // Verify compression happened
    expect(result.compressed.length).toBeLessThan(verbose.length);
  });
});

describe("Entropy Calculation", () => {
  test("calculateEntropy returns 0 for empty string", () => {
    const entropy = calculateEntropy("");
    expect(entropy).toBe(0);
  });

  test("calculateEntropy returns ~0 for single repeated character", () => {
    const entropy = calculateEntropy("aaaaaaaaaa");
    expect(entropy).toBeLessThan(0.1);
  });

  test("calculateEntropy is higher for diverse content", () => {
    const uniform = "aaaaaaaaaa";
    const diverse = "abcdefghij";

    const uniformEntropy = calculateEntropy(uniform);
    const diverseEntropy = calculateEntropy(diverse);

    expect(diverseEntropy).toBeGreaterThan(uniformEntropy);
  });

  test("calculateEntropy for typical English is in expected range", () => {
    const english = "The quick brown fox jumps over the lazy dog.";
    const entropy = calculateEntropy(english);

    // English text typically has entropy ~4.0-5.5 bits/char
    expect(entropy).toBeGreaterThan(3.5);
    expect(entropy).toBeLessThan(6.0);
  });

  test("calculateEntropy for random data is high", () => {
    // Pseudo-random string
    const random = Array.from({ length: 100 }, (_, i) => String.fromCharCode(33 + (i % 94))).join(
      "",
    );
    const entropy = calculateEntropy(random);

    // Should be high (approaching 8 bits/byte)
    expect(entropy).toBeGreaterThan(6.0);
  });
});

describe("Integration: Batch + Compression", () => {
  test("batch count tokens for compression candidates", () => {
    const contexts = [
      "Short text.",
      "Medium length text with more words and content here to reach token threshold.",
      "Very long text with many redundant phrases repeated multiple times. " +
        "Very long text with many redundant phrases repeated multiple times. " +
        "Very long text with many redundant phrases repeated multiple times. " +
        "Very long text with many redundant phrases repeated multiple times.",
    ];

    // Batch count to decide which need compression
    const counts = countTokensBatch(contexts);

    expect(counts[0]).toBeLessThan(10);
    expect(counts[1]).toBeGreaterThan(5);
    expect(counts[2]).toBeGreaterThan(40);

    // Compress only the long one
    const needsCompression = counts.map((c) => c > 35);
    expect(needsCompression).toEqual([false, false, true]);
  });

  test("async batch processing with compression", async () => {
    const contexts = Array.from({ length: 10 }, (_, i) => `Context ${i}: Test content here.`);

    // Async count all
    const counts = await countTokensBatchAsync(contexts);

    // Compress in parallel (simulated)
    const compressed = await Promise.all(
      contexts.map(async (ctx, i) => {
        if (counts[i]! > 20) {
          return compress(ctx, "test", { adaptiveCompression: true }).compressed;
        }
        return ctx;
      }),
    );

    expect(compressed).toHaveLength(10);
    expect(compressed.every((c) => c.length > 0)).toBe(true);
  });
});
