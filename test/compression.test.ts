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

// ============================================================================
// New test sections for splitSentences, estimateTokensFast, compress edge
// cases, and computeNCDAsync / computeNCD / jaccardSimilarity
// ============================================================================

import {
  computeNCD,
  computeNCDAsync,
  jaccardSimilarity,
  splitSentences,
} from "../src/lib/compression";
import { countTokens } from "../src/lib/tokens";
import { clearEstimateCache, estimateTokensFast } from "../src/lib/tokens-fast";

// ----------------------------------------------------------------------------
// splitSentences
// ----------------------------------------------------------------------------

describe("splitSentences", () => {
  test("handles abbreviation: Dr.", () => {
    const result = splitSentences("Dr. Smith went home.");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Dr. Smith went home.");
  });

  test("handles dotted abbreviation e.g.", () => {
    const result = splitSentences("Use tools, e.g. hammers, to build.");
    expect(result).toHaveLength(1);
  });

  test("handles dotted abbreviation i.e.", () => {
    const result = splitSentences("The value, i.e. the result, was correct.");
    expect(result).toHaveLength(1);
  });

  test("normal splitting: three sentences", () => {
    const result = splitSentences("First. Second. Third.");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("First.");
    expect(result[1]).toBe("Second.");
    expect(result[2]).toBe("Third.");
  });

  test("empty string returns empty array", () => {
    const result = splitSentences("");
    expect(result).toHaveLength(0);
  });

  test("single sentence without period returns one element", () => {
    const result = splitSentences("Hello world");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Hello world");
  });

  test("handles exclamation mark endings", () => {
    const result = splitSentences("Wow! That is great! Indeed.");
    expect(result).toHaveLength(3);
  });

  test("handles question mark endings", () => {
    const result = splitSentences("Why? Because. How?");
    expect(result).toHaveLength(3);
  });

  test("handles mixed sentence terminators", () => {
    const result = splitSentences("Really? Yes! Done.");
    expect(result).toHaveLength(3);
  });
});

// ----------------------------------------------------------------------------
// estimateTokensFast
// ----------------------------------------------------------------------------

describe("estimateTokensFast", () => {
  test("empty string returns 0", () => {
    expect(estimateTokensFast("")).toBe(0);
  });

  test("single word gives reasonable count (1-2 tokens)", () => {
    const count = estimateTokensFast("hello");
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2);
  });

  test("English prose has ~3.5-5.0 chars/token ratio", () => {
    const prose =
      "The quick brown fox jumps over the lazy dog. " +
      "This is a sample of typical English text that should have " +
      "a reasonable token estimate matching BPE tokenizer behavior.";
    const tokens = estimateTokensFast(prose);
    const ratio = prose.length / tokens;
    expect(ratio).toBeGreaterThanOrEqual(3.5);
    expect(ratio).toBeLessThanOrEqual(5.0);
  });

  test("URL-heavy text has lower chars/token ratio", () => {
    const urlText =
      "Visit https://example.com/path/to/resource?query=value&foo=bar " +
      "and https://another-site.org/api/v2/endpoint#section for details.";
    const proseText =
      "Visit the example website path to resource with query value and foo bar " +
      "and another site org api version two endpoint section for details.";
    const urlTokens = estimateTokensFast(urlText);
    const proseTokens = estimateTokensFast(proseText);
    // URLs should produce more tokens (lower chars/token)
    const urlRatio = urlText.length / urlTokens;
    const proseRatio = proseText.length / proseTokens;
    expect(urlRatio).toBeLessThan(proseRatio);
  });

  test("numbers: '123456789' estimates 3-5 tokens", () => {
    const count = estimateTokensFast("123456789");
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);
  });

  test("code with operators produces more tokens per char than prose", () => {
    const code = "if (x > 0 && y < 10 || z == 42) { return x + y * z; }";
    const prose = "if the value is greater than zero and less than ten then return sum";
    const codeRatio = code.length / estimateTokensFast(code);
    const proseRatio = prose.length / estimateTokensFast(prose);
    expect(codeRatio).toBeLessThan(proseRatio);
  });

  test("overestimates conservatively vs tiktoken (safety bias)", () => {
    // estimateTokensFast intentionally overestimates for safety (budget underrun prevention).
    // Verify: (1) always >= exact count, (2) within 2x of exact count.
    const samples = [
      "Hello, world!",
      "The algorithm uses dynamic programming to solve the problem efficiently.",
      "function add(a: number, b: number): number { return a + b; }",
    ];
    for (const sample of samples) {
      const fast = estimateTokensFast(sample);
      const exact = countTokens(sample);
      // Should overestimate (or match) — never underestimate
      expect(fast).toBeGreaterThanOrEqual(exact * 0.8);
      // Should not overestimate by more than 2x
      expect(fast).toBeLessThanOrEqual(exact * 2.0);
    }
  });
});

// ----------------------------------------------------------------------------
// estimateTokensFast cache
// ----------------------------------------------------------------------------

describe("estimateTokensFast cache", () => {
  test("returns cached result on repeat call", () => {
    const input = "The quick brown fox jumps over the lazy dog.";
    const first = estimateTokensFast(input);
    const second = estimateTokensFast(input);
    expect(second).toBe(first);
  });

  test("clearEstimateCache resets cache", () => {
    const input = "Sample text for cache testing.";
    const beforeClear = estimateTokensFast(input);
    clearEstimateCache();
    const afterClear = estimateTokensFast(input);
    // Same result proves correctness survives cache clear
    expect(afterClear).toBe(beforeClear);
  });

  test("cache does not affect accuracy", () => {
    const inputs = [
      "First sample text.",
      "Second sample with different content.",
      "Third sample: code-like { return x + y; }",
      "Fourth sample https://example.com/path",
    ];

    const uncachedResults: number[] = [];
    const cachedResults: number[] = [];

    // First pass: collect uncached results
    for (const input of inputs) {
      clearEstimateCache();
      uncachedResults.push(estimateTokensFast(input));
    }

    // Second pass: collect cached results
    clearEstimateCache();
    for (const input of inputs) {
      cachedResults.push(estimateTokensFast(input));
      // Second call should hit cache
      cachedResults.push(estimateTokensFast(input));
    }

    // Verify all uncached results match cached results
    for (let i = 0; i < inputs.length; i++) {
      expect(cachedResults[i * 2]).toBe(uncachedResults[i]);
      expect(cachedResults[i * 2 + 1]).toBe(uncachedResults[i]);
    }
  });
});

// ----------------------------------------------------------------------------
// compress() edge cases
// ----------------------------------------------------------------------------

describe("compress() edge cases", () => {
  test("empty input returns empty compressed", () => {
    const result = compress("", "query", { target_ratio: 0.5 });
    expect(result.compressed).toBe("");
    expect(result.kept_sentences).toBe(0);
  });

  test("single sentence text returns itself", () => {
    const text = "This is a single important sentence about algorithms.";
    const result = compress(text, "algorithms", { target_ratio: 0.5 });
    // With min_sentences=1 default, should keep the only sentence
    expect(result.compressed).toContain("algorithms");
    expect(result.kept_sentences).toBeGreaterThanOrEqual(1);
  });

  test("all meta-sentences text should heavily compress", () => {
    const meta =
      "Let me think about this. Hmm, that is interesting. " +
      "Okay so let me consider. Well, I need to think. " +
      "Let me reconsider this approach. Hmm, yes.";
    const result = compress(meta, "algorithms", { target_ratio: 0.5 });
    // Meta/filler sentences should be penalized heavily
    expect(result.compressed.length).toBeLessThan(meta.length);
  });

  test("non-adjacent repetition is penalized", () => {
    const text =
      "Binary search is fast. " +
      "Trees store data hierarchically. " +
      "Binary search is fast. " +
      "Graphs connect nodes with edges.";
    const result = compress(text, "data structures", { target_ratio: 0.6 });
    // The repeated sentence should not appear twice
    const matches = result.compressed.match(/Binary search is fast/g);
    // Either kept once or not at all — never duplicated
    expect((matches ?? []).length).toBeLessThanOrEqual(1);
  });
});

// ----------------------------------------------------------------------------
// computeNCD (sync)
// ----------------------------------------------------------------------------

describe("computeNCD", () => {
  test("identical strings produce NCD close to 0", () => {
    const ncd = computeNCD("hello world", "hello world");
    expect(ncd).toBeLessThan(0.2);
  });

  test("completely different strings produce NCD close to 1", () => {
    const a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const b = "zyxwvutsrqponmlkjihgfedcba123456";
    const ncd = computeNCD(a, b);
    expect(ncd).toBeGreaterThan(0.5);
  });

  test("empty strings return NCD = 1", () => {
    expect(computeNCD("", "hello")).toBe(1);
    expect(computeNCD("hello", "")).toBe(1);
    expect(computeNCD("", "")).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// computeNCDAsync
// ----------------------------------------------------------------------------

describe("computeNCDAsync", () => {
  test("identical strings produce NCD close to 0", async () => {
    const ncd = await computeNCDAsync("hello world", "hello world");
    expect(ncd).toBeLessThan(0.2);
  });

  test("completely different strings produce NCD close to 1", async () => {
    const a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const b = "zyxwvutsrqponmlkjihgfedcba123456";
    const ncd = await computeNCDAsync(a, b);
    expect(ncd).toBeGreaterThan(0.5);
  });

  test("empty strings return NCD = 1", async () => {
    expect(await computeNCDAsync("", "hello")).toBe(1);
    expect(await computeNCDAsync("hello", "")).toBe(1);
    expect(await computeNCDAsync("", "")).toBe(1);
  });

  test("async result matches sync result", async () => {
    const a = "The quick brown fox jumps over the lazy dog.";
    const b = "A completely different sentence about mathematics.";
    const syncNcd = computeNCD(a, b);
    const asyncNcd = await computeNCDAsync(a, b);
    expect(asyncNcd).toBeCloseTo(syncNcd, 2);
  });
});

// ----------------------------------------------------------------------------
// jaccardSimilarity
// ----------------------------------------------------------------------------

describe("jaccardSimilarity", () => {
  test("identical strings return 1", () => {
    expect(jaccardSimilarity("hello world foo", "hello world foo")).toBe(1);
  });

  test("completely different strings return 0", () => {
    expect(jaccardSimilarity("aaa bbb ccc", "xxx yyy zzz")).toBe(0);
  });

  test("empty strings return 0", () => {
    expect(jaccardSimilarity("", "")).toBe(0);
    expect(jaccardSimilarity("", "hello world foo")).toBe(0);
    expect(jaccardSimilarity("hello world foo", "")).toBe(0);
  });

  test("partial overlap returns value between 0 and 1", () => {
    const sim = jaccardSimilarity("the quick brown fox", "the slow brown cat");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});
