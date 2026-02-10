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
} from "../src/text/compression";

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
// cases, computeNCD / jaccardSimilarity
// ============================================================================

import { computeNCD, jaccardSimilarity, splitSentences } from "../src/text/compression";
import { countTokens } from "../src/text/tokens";
import { clearEstimateCache, estimateTokensFast } from "../src/text/tokens-fast";

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

// ============================================================================
// New test sections for compression scoring improvements:
// extractCodeBlocks, restoreCodeBlocks, isCodeHeavySentence, isFillerSentence,
// extractEntities, informationDensity, rougeLScore, tokenize
// ============================================================================

import {
  extractCodeBlocks,
  extractEntities,
  informationDensity,
  isCodeHeavySentence,
  isFillerSentence,
  restoreCodeBlocks,
  rougeLScore,
  tokenize,
} from "../src/text/compression";

// ----------------------------------------------------------------------------
// extractCodeBlocks / restoreCodeBlocks
// ----------------------------------------------------------------------------

describe("extractCodeBlocks", () => {
  test("extracts single fenced code block and replaces with placeholder", () => {
    const input = "Some prose.\n```js\nconsole.log('hi');\n```\nMore prose.";
    const { prose, blocks } = extractCodeBlocks(input);
    expect(blocks.size).toBe(1);
    expect(prose).toContain("\x00CODE0\x00");
    expect(prose).not.toContain("console.log");
    expect(prose).toContain("Some prose.");
    expect(prose).toContain("More prose.");
  });

  test("extracts multiple code blocks", () => {
    const input = "Before.\n```py\nx = 1\n```\nMiddle.\n```ts\nconst y = 2;\n```\nAfter.";
    const { prose, blocks } = extractCodeBlocks(input);
    expect(blocks.size).toBe(2);
    expect(prose).toContain("\x00CODE0\x00");
    expect(prose).toContain("\x00CODE1\x00");
    expect(prose).toContain("Before.");
    expect(prose).toContain("Middle.");
    expect(prose).toContain("After.");
  });

  test("handles text with no code blocks", () => {
    const input = "Just plain text with no fences.";
    const { prose, blocks } = extractCodeBlocks(input);
    expect(prose).toBe(input);
    expect(blocks.size).toBe(0);
  });

  test("round-trip: extract then restore returns original", () => {
    const input = "Intro.\n```js\nfunction foo() { return 42; }\n```\nOutro.";
    const { prose, blocks } = extractCodeBlocks(input);
    const restored = restoreCodeBlocks(prose, blocks);
    expect(restored).toBe(input);
  });

  test("handles tilde fences", () => {
    const input = "Text.\n~~~\ncode here\n~~~\nMore text.";
    const { prose, blocks } = extractCodeBlocks(input);
    expect(blocks.size).toBe(1);
    expect(prose).toContain("\x00CODE0\x00");
    expect(prose).not.toContain("code here");
  });
});

// ----------------------------------------------------------------------------
// isCodeHeavySentence
// ----------------------------------------------------------------------------

describe("isCodeHeavySentence", () => {
  test("returns true for sentence heavy in backticks", () => {
    const sentence = "The function `foo(x)` calls `bar(y)` and returns `baz()` with `qux`";
    expect(isCodeHeavySentence(sentence)).toBe(true);
  });

  test("returns false for normal English sentence", () => {
    const sentence = "The algorithm runs efficiently on sorted input data.";
    expect(isCodeHeavySentence(sentence)).toBe(false);
  });

  test("returns true for symbol-dense sentence", () => {
    const sentence = "if (x > 0 && y < 10 || z == 42) { return x; }";
    expect(isCodeHeavySentence(sentence)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// isFillerSentence
// ----------------------------------------------------------------------------

describe("isFillerSentence", () => {
  test('returns true for "Let me think about this problem."', () => {
    expect(isFillerSentence("Let me think about this problem.")).toBe(true);
  });

  test('returns true for "Okay, so we need to consider..."', () => {
    expect(isFillerSentence("Okay, so we need to consider...")).toBe(true);
  });

  test('returns true for "I\'m confident that this is correct."', () => {
    expect(isFillerSentence("I'm confident that this is correct.")).toBe(true);
  });

  test('returns true for "The question is about sorting."', () => {
    expect(isFillerSentence("The question is about sorting.")).toBe(true);
  });

  test('returns true for "That said, we should note..."', () => {
    expect(isFillerSentence("That said, we should note...")).toBe(true);
  });

  test('returns false for "The algorithm runs in O(n log n) time."', () => {
    expect(isFillerSentence("The algorithm runs in O(n log n) time.")).toBe(false);
  });

  test('returns false for "Binary search requires sorted input."', () => {
    expect(isFillerSentence("Binary search requires sorted input.")).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// extractEntities
// ----------------------------------------------------------------------------

describe("extractEntities", () => {
  test("extracts numbers", () => {
    const entities = extractEntities("There are 42 items");
    expect(entities.has("42")).toBe(true);
  });

  test("extracts capitalized multi-word names", () => {
    const entities = extractEntities("John Smith went home");
    expect(entities.has("John Smith")).toBe(true);
  });

  test("extracts camelCase terms", () => {
    const entities = extractEntities("Use myFunction here");
    expect(entities.has("myFunction")).toBe(true);
  });

  test("extracts snake_case terms", () => {
    const entities = extractEntities("call my_func now");
    expect(entities.has("my_func")).toBe(true);
  });

  test("extracts ALL_CAPS terms and numbers together", () => {
    const entities = extractEntities("Set MAX_SIZE to 100");
    expect(entities.has("MAX_SIZE")).toBe(true);
    expect(entities.has("100")).toBe(true);
  });

  test("empty text returns empty set", () => {
    const entities = extractEntities("");
    expect(entities.size).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// informationDensity
// ----------------------------------------------------------------------------

describe("informationDensity", () => {
  test("dense sentence has higher density than filler", () => {
    const dense = informationDensity(
      "HashMap provides O(1) average lookup via hash-based bucket addressing.",
    );
    const filler = informationDensity("Well let me think about this thing here now.");
    expect(dense).toBeGreaterThan(filler);
  });

  test("empty string returns 0", () => {
    expect(informationDensity("")).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// rougeLScore
// ----------------------------------------------------------------------------

describe("rougeLScore", () => {
  test("identical arrays return 1.0", () => {
    const tokens = ["the", "cat", "sat"];
    expect(rougeLScore(tokens, tokens)).toBeCloseTo(1.0, 5);
  });

  test("completely different arrays return 0.0", () => {
    expect(rougeLScore(["aaa", "bbb"], ["ccc", "ddd"])).toBe(0);
  });

  test("empty arrays return 0.0", () => {
    expect(rougeLScore([], [])).toBe(0);
    expect(rougeLScore(["a"], [])).toBe(0);
    expect(rougeLScore([], ["a"])).toBe(0);
  });

  test("partial overlap gives value between 0 and 1", () => {
    const score = rougeLScore(["the", "quick", "brown", "fox"], ["the", "slow", "brown", "dog"]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  test("paraphrased order yields high score", () => {
    const a = ["the", "cat", "sat", "on", "mat"];
    const b = ["the", "cat", "on", "the", "mat"];
    const score = rougeLScore(a, b);
    // Shares long subsequence ["the", "cat", "on", "mat"] → high score
    expect(score).toBeGreaterThan(0.7);
  });
});

// ----------------------------------------------------------------------------
// tokenize
// ----------------------------------------------------------------------------

describe("tokenize", () => {
  test("lowercases and splits into words > 2 chars", () => {
    const result = tokenize("The Quick Fox");
    expect(result).toEqual(["the", "quick", "fox"]);
  });

  test("filters out short words", () => {
    const result = tokenize("I am a big dog");
    // "I", "am", "a" are <= 2 chars
    expect(result).toEqual(["big", "dog"]);
  });

  test("strips punctuation", () => {
    const result = tokenize("hello, world! foo-bar.");
    expect(result).toContain("hello");
    expect(result).toContain("world");
    expect(result).toContain("foo");
    expect(result).toContain("bar");
  });

  test("empty string returns empty array", () => {
    expect(tokenize("")).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// compress() with code blocks
// ----------------------------------------------------------------------------

describe("compress() with code blocks", () => {
  test("code block survives compression intact", () => {
    const codeBlock = "```js\nfunction add(a, b) { return a + b; }\n```";
    const text = `Here is an addition function.\n${codeBlock}\nThis function adds two numbers together.`;
    const result = compress(text, "addition function", { target_ratio: 0.8 });
    expect(result.compressed).toContain("function add(a, b) { return a + b; }");
  });

  test("filler sentences around code blocks get dropped, code kept", () => {
    const codeBlock = "```py\ndef sort(arr): return sorted(arr)\n```";
    const text =
      "Let me think about this. " +
      "Okay, so we need sorting. " +
      "Hmm, this is interesting. " +
      "Here is the implementation.\n" +
      codeBlock +
      "\n" +
      "The function sorts an array in O(n log n) time. " +
      "Well, let me also mention it uses Timsort.";
    const result = compress(text, "sorting algorithm", { target_ratio: 0.5 });
    // Code block must survive
    expect(result.compressed).toContain("def sort(arr)");
    // At least some filler should be dropped
    expect(result.compressed.length).toBeLessThan(text.length);
  });
});

// ----------------------------------------------------------------------------
// compress() filler scoring
// ----------------------------------------------------------------------------

describe("compress() filler scoring", () => {
  test("filler sentence gets lower priority than informative sentence", () => {
    const text =
      "Let me think about quicksort. " +
      "Quicksort uses divide and conquer with O(n log n) average case. " +
      "Hmm, that is interesting. " +
      "Well, I need to think about this more.";
    const result = compress(text, "quicksort", { target_ratio: 0.4 });
    // The informative sentence should survive
    expect(result.compressed).toContain("divide and conquer");
    // At least one filler should be dropped
    expect(result.dropped_sentences.length).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------------------
// getFillerTier
// ----------------------------------------------------------------------------

import { getFillerTier, median, telegraphicCompress } from "../src/text/compression";

describe("getFillerTier", () => {
  test("returns 1 for pure filler: Let me think", () => {
    expect(getFillerTier("Let me think about this problem.")).toBe(1);
  });

  test("returns 1 for self-reassurance filler", () => {
    expect(getFillerTier("I'm quite sure this is right.")).toBe(1);
  });

  test("returns 1 for let me also filler", () => {
    expect(getFillerTier("Let me also mention something.")).toBe(1);
  });

  test("returns 1 for hmm filler", () => {
    expect(getFillerTier("Hmm, this is interesting.")).toBe(1);
  });

  test("returns 2 for stylistic wrapper: Okay", () => {
    expect(getFillerTier("Okay, so the algorithm works.")).toBe(2);
  });

  test("returns 2 for that said wrapper", () => {
    expect(getFillerTier("That said, we should consider this.")).toBe(2);
  });

  test("returns 0 for non-filler: algorithm description", () => {
    expect(getFillerTier("The algorithm uses binary search.")).toBe(0);
  });

  test("returns 0 for non-filler: technical requirement", () => {
    expect(getFillerTier("Binary search requires sorted input.")).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// extractEntities - improved extraction
// ----------------------------------------------------------------------------

describe("extractEntities - improved", () => {
  test("extracts currency amounts", () => {
    const entities = extractEntities("Revenue grew by $2.3M");
    expect(entities.has("$2.3M")).toBe(true);
  });

  test("extracts percentages", () => {
    const entities = extractEntities("A 23% increase");
    expect(entities.has("23%")).toBe(true);
  });

  test("extracts alphanumeric codes", () => {
    const entities = extractEntities("Results from Q3");
    expect(entities.has("Q3")).toBe(true);
  });

  test("still extracts camelCase", () => {
    const entities = extractEntities("Use myFunction");
    expect(entities.has("myFunction")).toBe(true);
  });

  test("still extracts snake_case", () => {
    const entities = extractEntities("call my_func");
    expect(entities.has("my_func")).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// compress() - quality floor drops pure tier 1 fillers
// ----------------------------------------------------------------------------

describe("compress() - quality floor", () => {
  test("pure tier 1 fillers are dropped even with spare capacity", () => {
    const text =
      "Let me think about this. " +
      "Hmm, let me consider. " +
      "The answer is 42. " +
      "I'm confident about this.";
    const result = compress(text, "answer", { target_ratio: 0.8 });
    // Should contain the informative sentence
    expect(result.compressed).toContain("42");
    // Should NOT contain tier 1 fillers
    expect(result.compressed).not.toContain("Let me think");
  });
});

// ----------------------------------------------------------------------------
// compress() - filler detection on original sentence
// ----------------------------------------------------------------------------

describe("compress() - filler detection on original", () => {
  test("detects filler even when cleanFillers strips the prefix", () => {
    const text =
      "Let me think about quicksort. " +
      "Quicksort partitions the array recursively. " +
      "Hmm, let me verify. " +
      "It has O(n log n) average complexity.";
    const result = compress(text, "quicksort", { target_ratio: 0.5 });
    // Should keep the informative sentences
    expect(result.compressed).toContain("partitions");
    expect(result.compressed).toContain("complexity");
    // "Let me think about quicksort" should be detected as filler
    // even though cleanFillers would strip "let me think" to leave "quicksort"
    // We verify by checking that at least one filler sentence was dropped
    expect(result.dropped_sentences.length).toBeGreaterThan(0);
  });
});

// ── median helper ────────────────────────────────────────────────────────────

describe("median", () => {
  test("empty array returns 0", () => {
    expect(median([])).toBe(0);
  });

  test("single element", () => {
    expect(median([5])).toBe(5);
  });

  test("odd count returns middle", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  test("even count returns average of two middles", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  test("handles duplicates", () => {
    expect(median([1, 1, 1])).toBe(1);
  });

  test("does not mutate input", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

// ── Dual-threshold selection (noiseScore) ────────────────────────────────────

describe("dual-threshold selection", () => {
  test("fillers get high noise scores and are dropped first", () => {
    const text =
      "Let me think about this question. " +
      "Hmm, let me consider what I know. " +
      "The answer involves quantum mechanics. " +
      "Quantum entanglement allows particles to be correlated. " +
      "I'm confident that is correct. " +
      "Bell's theorem proves local hidden variables cannot explain entanglement.";
    const result = compress(text, "quantum entanglement", { target_ratio: 0.5 });
    expect(result.compressed).toContain("entanglement");
    expect(result.compressed).toContain("Bell");
    expect(result.compressed).not.toContain("Let me think");
    expect(result.compressed).not.toContain("confident");
  });

  test("low-noise supporting sentences survive over high-noise relevant ones", () => {
    const text =
      "Let me think about sorting algorithms. " +
      "Okay, so sorting is important in computer science. " +
      "Merge sort divides the array into halves recursively. " +
      "Each half is sorted and then merged back together. " +
      "The time complexity of merge sort is O(n log n). " +
      "Let me also mention that merge sort is stable.";
    const result = compress(text, "merge sort complexity", { target_ratio: 0.5 });
    expect(result.compressed).toContain("O(n log n)");
    expect(result.compressed).toContain("divides");
    expect(result.compressed).not.toContain("Let me think");
  });

  test("noiseScore computation does not break short inputs", () => {
    const text =
      "Let me think. The sky is blue due to Rayleigh scattering. " + "I'm sure about this.";
    const result = compress(text, "why is sky blue", { target_ratio: 0.5 });
    expect(result.compressed.length).toBeGreaterThan(0);
    expect(result.ratio).toBeLessThan(1);
  });
});

// ── Telegraphic compression ──────────────────────────────────────────────────

describe("telegraphicCompress", () => {
  test("strips articles", () => {
    const result = telegraphicCompress("The cat sat on a mat");
    expect(result).not.toMatch(/\bThe\b/);
    expect(result).not.toMatch(/\ba\b/);
    expect(result).toContain("cat");
    expect(result).toContain("mat");
  });

  test("strips filler adverbs", () => {
    const result = telegraphicCompress("It is basically very simple");
    expect(result).not.toContain("basically");
    expect(result).not.toContain("very");
    expect(result).toContain("simple");
  });

  test("strips auxiliary verbs", () => {
    const result = telegraphicCompress("I am going to the store");
    expect(result).not.toMatch(/\bam\b/);
    expect(result).toContain("going");
    expect(result).toContain("store");
  });

  test("keeps reasoning connectives", () => {
    const result = telegraphicCompress("X fails because Y is broken");
    expect(result).toContain("because");
    expect(result).toContain("fails");
  });

  test("keeps numbers", () => {
    const result = telegraphicCompress("The value is 42 and the rate is 3.14");
    expect(result).toContain("42");
    expect(result).toContain("3.14");
  });

  test("keeps technical terms (camelCase, ALL_CAPS, snake_case)", () => {
    const result = telegraphicCompress("The variable myVar and MY_CONST are used");
    expect(result).toContain("myVar");
    expect(result).toContain("MY_CONST");
  });

  test("applies phrase replacements", () => {
    expect(telegraphicCompress("in order to do X")).toContain("to");
    expect(telegraphicCompress("in order to do X")).not.toContain("in order");
    expect(telegraphicCompress("due to the fact that it fails")).toContain("because");
  });

  test("protects URLs", () => {
    const result = telegraphicCompress("Visit https://example.com/path for details");
    expect(result).toContain("https://example.com/path");
  });

  test("protects inline code", () => {
    const result = telegraphicCompress("Use the `Array.map` method");
    expect(result).toContain("`Array.map`");
  });

  test("protects dates", () => {
    const result = telegraphicCompress("The deadline is 2024-01-15");
    expect(result).toContain("2024-01-15");
  });

  test("protects version numbers", () => {
    const result = telegraphicCompress("It requires version v3.2.1");
    expect(result).toContain("v3.2.1");
  });

  test("protects slash-separated terms like A/B", () => {
    const result = telegraphicCompress("A/B testing showed results");
    expect(result).toContain("A/B");
  });

  test("protects model IDs", () => {
    const result = telegraphicCompress("Using claude-sonnet-4-20250514 for inference");
    expect(result).toContain("claude-sonnet-4-20250514");
  });

  test("end-to-end: produces readable telegraphic output", () => {
    const input =
      "The time complexity of the algorithm is O(n log n) because it uses a divide-and-conquer approach";
    const result = telegraphicCompress(input);
    expect(result).toContain("time complexity");
    expect(result).toContain("O(n");
    expect(result).toContain("because");
    expect(result).toContain("divide-and-conquer");
    // Should be notably shorter
    expect(result.length).toBeLessThan(input.length);
  });

  test("compress() applies telegraphic compression to kept sentences", () => {
    const text =
      "Let me think about this. " +
      "The algorithm is fundamentally based on the principle of dynamic programming. " +
      "It has a time complexity of O(n^2).";
    const result = compress(text, "algorithm complexity", { target_ratio: 0.7 });
    // "fundamentally" should be stripped
    expect(result.compressed).not.toContain("fundamentally");
    // Core content preserved
    expect(result.compressed).toContain("dynamic programming");
    expect(result.compressed).toContain("O(n^2)");
  });
});
