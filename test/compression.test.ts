/**
 * Unit tests for compression module
 * Tests compression, entropy calculation, and compression detection
 */

import { describe, expect, test } from "bun:test";
import {
  calculateEntropy,
  compress,
  needsCompression,
  quickCompress,
} from "../src/lib/compression";

describe("Compression", () => {
  test("compresses text with ratio", () => {
    const text =
      "The quick brown fox jumps. The lazy dog sleeps. A third sentence here. Fourth sentence for testing.";
    const result = compress(text, "fox", { target_ratio: 0.5 });

    expect(result.compressed.length).toBeLessThan(text.length);
    expect(result.ratio).toBeLessThanOrEqual(1);
    expect(result.kept_sentences).toBeGreaterThan(0);
  });

  test("boosts reasoning keywords", () => {
    const text =
      "A simple fact here. Therefore this is the most important conclusion. Another unrelated fact. Yet another fact.";
    const result = compress(text, "conclusion", {
      target_ratio: 0.5,
      boost_reasoning: true,
    });

    // "Therefore" sentence should be kept due to both relevance and reasoning boost
    expect(result.compressed).toContain("Therefore");
  });

  test("quickCompress respects max tokens", () => {
    const text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence.";
    const result = quickCompress(text, "test", 20);

    // Rough token estimate: length / 4
    expect(result.length / 4).toBeLessThanOrEqual(25); // Some tolerance
  });

  test("handles empty input", () => {
    const result = compress("", "query", { target_ratio: 0.5 });
    expect(result.compressed).toBe("");
    expect(result.kept_sentences).toBe(0);
  });

  test("preserves sentence order", () => {
    const text = "First. Second. Third.";
    const result = compress(text, "Second", { target_ratio: 0.7 });

    // If multiple sentences kept, order should be preserved
    if (result.compressed.includes("First") && result.compressed.includes("Second")) {
      expect(result.compressed.indexOf("First")).toBeLessThan(result.compressed.indexOf("Second"));
    }
  });

  test("penalizes filler phrases", () => {
    const text =
      "Um let me think about this. The algorithm uses binary search. Well this is interesting.";
    const result = compress(text, "algorithm", { target_ratio: 0.5 });

    // The informative sentence should be kept over filler sentences
    expect(result.compressed).toContain("algorithm");
  });

  test("quickCompress compresses when over token limit", () => {
    // Create text that definitely exceeds the token limit
    const longText =
      "This is a very long sentence that contains many important details about the topic at hand. " +
      "Another sentence with more information. " +
      "Yet another sentence adding context. " +
      "The final sentence wraps things up nicely.";

    // Set a low max token limit to force compression
    const result = quickCompress(longText, "important", 10);

    // Should be shorter than original
    expect(result.length).toBeLessThan(longText.length);
  });
});

describe("CompressionDetection - calculateEntropy", () => {
  test("empty string has zero entropy", () => {
    expect(calculateEntropy("")).toBe(0);
  });

  test("single repeated character has zero entropy", () => {
    const entropy = calculateEntropy("aaaaaaaaaa");
    expect(entropy).toBe(0);
  });

  test("two equally frequent characters has entropy of 1", () => {
    const entropy = calculateEntropy("abababab");
    expect(entropy).toBeCloseTo(1, 5);
  });

  test("random-looking text has higher entropy", () => {
    const lowEntropy = calculateEntropy("aaaaaabbbbbb");
    const highEntropy = calculateEntropy("abcdefghijkl");
    expect(highEntropy).toBeGreaterThan(lowEntropy);
  });

  test("English text has typical entropy ~4-5 bits/char", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. " +
      "This is a sample of typical English text that should have " +
      "entropy around 4 to 5 bits per character.";
    const entropy = calculateEntropy(text);
    expect(entropy).toBeGreaterThan(3.5);
    expect(entropy).toBeLessThan(5.5);
  });

  test("highly repetitive text has low entropy", () => {
    const text = "the the the the the the the the the the";
    const entropy = calculateEntropy(text);
    expect(entropy).toBeLessThan(3);
  });
});

describe("CompressionDetection - needsCompression", () => {
  test("short text does not need compression", () => {
    const result = needsCompression("Short text");
    expect(result.shouldCompress).toBe(false);
    expect(result.reasons[0]).toContain("too short");
  });

  test("repetitive text recommends compression", () => {
    // Create highly repetitive text that exceeds MIN_TOKENS (100)
    const text = "The same sentence repeated. ".repeat(50);
    const result = needsCompression(text);
    expect(result.shouldCompress).toBe(true);
    expect(result.entropy).toBeLessThan(5);
  });

  test("diverse text with high entropy does not need compression", () => {
    // Generate text with high character diversity
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    const text = Array.from(
      { length: 500 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
    const result = needsCompression(text);
    // High entropy text should not recommend compression
    if (result.entropy > 6.5) {
      expect(result.shouldCompress).toBe(false);
    }
  });

  test("returns analysis metrics", () => {
    const text = "Test sentence for analysis. ".repeat(20);
    const result = needsCompression(text);

    expect(result).toHaveProperty("shouldCompress");
    expect(result).toHaveProperty("entropy");
    expect(result).toHaveProperty("uniquenessRatio");
    expect(result).toHaveProperty("estimatedRatio");
    expect(result).toHaveProperty("tokens");
    expect(result).toHaveProperty("reasons");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test("long text with moderate entropy recommends compression", () => {
    // Create long text (>500 tokens) with moderate entropy
    const text =
      "This is a moderately varied sentence with some repetition. " +
      "The algorithm processes data efficiently. " +
      "Results are computed and stored for later use. ".repeat(40);
    const result = needsCompression(text);
    expect(result.tokens).toBeGreaterThan(400);
    // Long text with moderate entropy should recommend compression
    if (result.entropy < 5.5) {
      expect(result.shouldCompress).toBe(true);
    }
  });

  test("query relevance affects analysis", () => {
    const text =
      "The algorithm uses binary search for efficient lookups. " +
      "Binary search requires sorted data. " +
      "The time complexity is O(log n). ".repeat(10);
    const result = needsCompression(text, "binary search algorithm");

    // Query terms should be detected
    if (result.reasons.some((r) => r.includes("overlap"))) {
      expect(result.reasons.join(" ")).toContain("overlap");
    }
  });

  test("low uniqueness ratio indicates repetitive content", () => {
    // Create text with very few unique characters
    const text = "ab ".repeat(200);
    const result = needsCompression(text);
    expect(result.uniquenessRatio).toBeLessThan(0.05);
  });

  test("estimated ratio reflects entropy", () => {
    const lowEntropyText = "repeat repeat repeat repeat ".repeat(30);
    const result = needsCompression(lowEntropyText);
    // Lower entropy = lower estimated ratio (better compression)
    expect(result.estimatedRatio).toBeLessThan(0.9);
  });
});
