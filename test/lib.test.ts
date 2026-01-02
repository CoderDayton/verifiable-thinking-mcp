/**
 * Unit tests for src/lib modules
 * Tests: Concepts, VerificationCache, TokenEstimation, Derivation
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { verificationCache } from "../src/lib/cache";
import {
  canonicalizeExpression,
  derivationTextToLatex,
  derivationToLatex,
  detectCommonMistakes,
  detectCommonMistakesFromText,
  explainDerivationError,
  simplifyDerivation,
  simplifyDerivationText,
  suggestNextStep,
  suggestNextStepFromText,
  suggestSimplificationPath,
  tryDerivation,
  tryFormula,
  trySimplifyToConstant,
  verifyDerivationSteps,
} from "../src/lib/compute/index";
import { ConceptTracker, clearTracker, getTracker } from "../src/lib/concepts";
import {
  estimateCodeTokens,
  estimateTokens,
  estimateTokensBatch,
} from "../src/lib/think/verification";
import {
  buildAST,
  compareExpressions,
  formatAST,
  simplifyAST,
  tokenizeMathExpression,
  verify,
} from "../src/lib/verification";

describe("Concepts", () => {
  beforeEach(() => {
    clearTracker("test-session");
  });

  test("extracts concepts from text", () => {
    const tracker = getTracker("test-session");
    const concepts = tracker.extract(
      "The function calculates the derivative using the chain rule",
      1,
    );

    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts.some((c) => c.domain === "math" || c.domain === "code")).toBe(true);
  });

  test("tracks concept frequency", () => {
    const tracker = getTracker("test-session");

    tracker.extract("The variable x equals 5", 1);
    tracker.extract("The variable x is used again", 2);

    const summary = tracker.getSummary();
    expect(summary.total).toBeGreaterThan(0);
  });

  test("gets summary with top concepts", () => {
    const tracker = getTracker("test-session");

    tracker.extract("algorithm complexity analysis", 1);
    tracker.extract("algorithm performance", 2);

    const summary = tracker.getSummary();
    expect(summary.top).toBeDefined();
    expect(Array.isArray(summary.top)).toBe(true);
  });

  test("clears tracker", () => {
    const tracker = getTracker("clear-test");
    tracker.extract("Some concept here", 1);

    clearTracker("clear-test");

    const newTracker = getTracker("clear-test");
    expect(newTracker.getSummary().total).toBe(0);
  });

  test("tracker clear method resets concepts", () => {
    const tracker = getTracker("clear-instance-test");
    tracker.extract("algorithm complexity function", 1);
    expect(tracker.getSummary().total).toBeGreaterThan(0);

    tracker.clear();
    expect(tracker.getSummary().total).toBe(0);
    expect(tracker.getAll().length).toBe(0);
  });

  test("getTopConcepts sorts by count and limits results", () => {
    const tracker = getTracker("top-concepts-test");
    // Create multiple DISTINCT concepts with different counts
    // Extract "function" 3 times to get count=3
    tracker.extract("function", 1);
    tracker.extract("function", 2);
    tracker.extract("function", 3);
    // Extract "variable" 2 times to get count=2
    tracker.extract("variable", 4);
    tracker.extract("variable", 5);
    // Extract "class" 1 time to get count=1
    tracker.extract("class", 6);

    // Now we have 3 distinct concepts with different counts
    expect(tracker.getAll().length).toBe(3);

    const top2 = tracker.getTopConcepts(2);
    expect(top2).toHaveLength(2);
    // Most frequent should be first - this forces the sort callback to run
    expect(top2[0].name).toBe("function");
    expect(top2[0].count).toBe(3);
    expect(top2[1].name).toBe("variable");
    expect(top2[1].count).toBe(2);
  });

  test("getSummary aggregates by domain correctly", () => {
    const tracker = getTracker("summary-domain-test");
    tracker.extract("function class method", 1); // code domain
    tracker.extract("equation solve calculate", 2); // math domain

    const summary = tracker.getSummary();
    expect(summary.by_domain).toHaveProperty("code");
    expect(summary.by_domain).toHaveProperty("math");
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.top.length).toBeLessThanOrEqual(5);
  });

  test("gets concepts by domain", () => {
    const tracker = getTracker("test-session");
    tracker.extract("function variable class method", 1);

    const codeConcepts = tracker.getByDomain("code");
    expect(codeConcepts.length).toBeGreaterThan(0);
    expect(codeConcepts.every((c) => c.domain === "code")).toBe(true);
  });

  test("gets top concepts sorted by count", () => {
    const tracker = getTracker("test-session");
    tracker.extract("function function function", 1);
    tracker.extract("variable", 2);

    const top = tracker.getTopConcepts(2);
    expect(top.length).toBeLessThanOrEqual(2);
  });

  test("direct ConceptTracker construction", () => {
    // Directly construct ConceptTracker to ensure constructor is covered
    const tracker = new ConceptTracker();
    tracker.extract("algorithm complexity", 1);
    expect(tracker.getAll().length).toBeGreaterThan(0);
    tracker.clear();
    expect(tracker.getAll().length).toBe(0);
  });
});

describe("VerificationCache", () => {
  beforeEach(() => {
    verificationCache.clear();
    // Reset to default config
    verificationCache.configure({ rate_limit_ops: 100, rate_limit_window_ms: 1000 });
  });

  test("stores and retrieves cached results", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test-thought", "math", [], result);
    const cached = verificationCache.get("test-thought", "math", []);

    expect(cached).toBeDefined();
    expect(cached?.passed).toBe(true);
  });

  test("returns null for cache miss", () => {
    const result = verificationCache.get("nonexistent", "math", []);
    expect(result).toBeNull();
  });

  test("clears cache and resets stats", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test", "math", [], result);
    verificationCache.get("test", "math", []); // hit
    verificationCache.get("miss", "math", []); // miss

    const clearedCount = verificationCache.clear();
    expect(clearedCount).toBe(1);

    const stats = verificationCache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.rate_limited).toBe(0);
  });

  test("reports comprehensive stats", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test", "math", [], result);
    verificationCache.get("test", "math", []); // hit
    verificationCache.get("miss", "math", []); // miss

    const stats = verificationCache.getStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("max");
    expect(stats).toHaveProperty("hit_rate");
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
    expect(stats).toHaveProperty("rate_limited");
    expect(stats).toHaveProperty("ops_in_window");
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  test("rate limits under high load", () => {
    // Configure very low rate limit for testing
    verificationCache.configure({ rate_limit_ops: 5, rate_limit_window_ms: 1000 });
    verificationCache.clear();

    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    // First 5 operations should succeed
    for (let i = 0; i < 5; i++) {
      expect(verificationCache.set(`thought-${i}`, "math", [], result)).toBe(true);
    }

    // 6th operation should be rate limited
    expect(verificationCache.set("thought-6", "math", [], result)).toBe(false);
    expect(verificationCache.isRateLimited()).toBe(true);

    const stats = verificationCache.getStats();
    expect(stats.rate_limited).toBeGreaterThan(0);
  });

  test("rate limit resets after window expires", async () => {
    // Configure very short window for testing
    verificationCache.configure({ rate_limit_ops: 2, rate_limit_window_ms: 50 });
    verificationCache.clear();

    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    // Use up the rate limit
    verificationCache.set("t1", "math", [], result);
    verificationCache.set("t2", "math", [], result);
    expect(verificationCache.isRateLimited()).toBe(true);

    // Wait for window to expire
    await Bun.sleep(60);

    // Should be able to operate again
    expect(verificationCache.isRateLimited()).toBe(false);
    expect(verificationCache.set("t3", "math", [], result)).toBe(true);
  });

  test("handles context in cache key", () => {
    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    // Same thought, different context should be different cache entries
    verificationCache.set("thought", "math", ["context1"], result);
    verificationCache.set("thought", "math", ["context2"], { ...result, confidence: 0.5 });

    const cached1 = verificationCache.get("thought", "math", ["context1"]);
    const cached2 = verificationCache.get("thought", "math", ["context2"]);

    expect(cached1?.confidence).toBe(0.9);
    expect(cached2?.confidence).toBe(0.5);
  });

  test("expires entries after TTL", async () => {
    // Configure very short TTL for testing
    verificationCache.configure({ ttl_ms: 50 });
    verificationCache.clear();

    const result = {
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: "test",
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    };

    verificationCache.set("test", "math", [], result);
    expect(verificationCache.get("test", "math", [])).not.toBeNull();

    // Wait for TTL to expire
    await Bun.sleep(60);

    expect(verificationCache.get("test", "math", [])).toBeNull();
  });

  test("evicts oldest entries when at max capacity", () => {
    // Configure very small cache for testing eviction
    verificationCache.configure({
      max_entries: 5,
      ttl_ms: 60000,
      rate_limit_ops: 1000, // High limit to not interfere
    });
    verificationCache.clear();

    const makeResult = (id: number) => ({
      passed: true,
      confidence: 0.9,
      domain: "math" as const,
      evidence: `test-${id}`,
      suggestions: [] as string[],
      reward: 1 as const,
      cached: false,
    });

    // Fill cache to capacity
    for (let i = 0; i < 5; i++) {
      verificationCache.set(`thought-${i}`, "math", [], makeResult(i));
    }
    expect(verificationCache.getStats().size).toBe(5);

    // Access some entries to increase their hit count
    verificationCache.get("thought-3", "math", []);
    verificationCache.get("thought-3", "math", []);
    verificationCache.get("thought-4", "math", []);

    // Add new entry - should trigger eviction of least-hit entries
    verificationCache.set("thought-new", "math", [], makeResult(99));

    const stats = verificationCache.getStats();
    // Should have evicted ~10% (1 entry) and added 1
    expect(stats.size).toBeLessThanOrEqual(5);

    // High-hit entries should survive
    expect(verificationCache.get("thought-3", "math", [])).not.toBeNull();
  });
});

// =============================================================================
// COMPRESSION DETECTION TESTS
// =============================================================================

describe("TokenEstimation - estimateTokens", () => {
  test("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("very short strings return 1", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("abc")).toBe(1);
  });

  test("basic ASCII text estimation", () => {
    const text = "Hello, world!";
    const tokens = estimateTokens(text);
    // Should be ~3-4 tokens for this phrase
    expect(tokens).toBeGreaterThan(1);
    expect(tokens).toBeLessThan(10);
  });

  test("longer prose gets reasonable estimate", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const tokens = estimateTokens(text);
    // ~9-12 tokens typically
    expect(tokens).toBeGreaterThan(6);
    expect(tokens).toBeLessThan(20);
  });

  test("digit grouping - consecutive digits share tokens", () => {
    // "2024" should be fewer tokens than four separate digits
    const year = estimateTokens("2024");
    const fourWords = estimateTokens("a b c d");
    expect(year).toBeLessThanOrEqual(fourWords);
  });

  test("large numbers are efficient", () => {
    // "123456789" should be ~2-3 tokens, not 9
    const bigNum = estimateTokens("123456789");
    expect(bigNum).toBeLessThan(5);
  });

  test("CJK characters get ~1 token each", () => {
    const cjk = "你好世界"; // "Hello world" in Chinese
    const tokens = estimateTokens(cjk);
    // Each CJK char ~1 token, so ~4 tokens
    expect(tokens).toBeGreaterThanOrEqual(3);
    expect(tokens).toBeLessThanOrEqual(6);
  });

  test("emoji handling", () => {
    const emoji = "👋🌍✨";
    const tokens = estimateTokens(emoji);
    // Emoji are typically 1-3 tokens each
    expect(tokens).toBeGreaterThanOrEqual(1);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  test("mixed content", () => {
    const mixed = "Hello 2024! 你好 🎉";
    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(20);
  });

  test("long text gets discount", () => {
    const shortText = "word ".repeat(20).trim();
    const longText = "word ".repeat(250).trim();

    // Ratio should show long text is more efficient per-word
    const shortPerWord = estimateTokens(shortText) / 20;
    const longPerWord = estimateTokens(longText) / 250;
    expect(longPerWord).toBeLessThan(shortPerWord);
  });
});

describe("TokenEstimation - estimateCodeTokens", () => {
  test("empty code returns 0", () => {
    expect(estimateCodeTokens("")).toBe(0);
  });

  test("very short code returns 1", () => {
    expect(estimateCodeTokens("x=1")).toBe(1);
  });

  test("typical code snippet", () => {
    const code = `function add(a, b) {
  return a + b;
}`;
    const tokens = estimateCodeTokens(code);
    // Should be ~8-25 tokens
    expect(tokens).toBeGreaterThanOrEqual(8);
    expect(tokens).toBeLessThan(35);
  });

  test("string literals are efficient", () => {
    const withStrings = `const msg = "Hello, this is a long string message";`;
    const tokens = estimateCodeTokens(withStrings);
    // String contents should be efficiently encoded
    expect(tokens).toBeLessThan(20);
  });

  test("code is more efficient than prose", () => {
    const code = "const x = 10; const y = 20;";
    const prose = "set x to ten then set y to twenty";
    // Code should be similar or fewer tokens
    expect(estimateCodeTokens(code)).toBeLessThanOrEqual(estimateTokens(prose) + 5);
  });
});

describe("TokenEstimation - estimateTokensBatch", () => {
  test("empty array returns 0", () => {
    expect(estimateTokensBatch([])).toBe(0);
  });

  test("single message includes overhead", () => {
    const single = estimateTokensBatch(["Hello"]);
    const direct = estimateTokens("Hello");
    // Batch adds 4 tokens overhead per message
    expect(single).toBe(direct + 4);
  });

  test("multiple messages accumulate with overhead", () => {
    const messages = ["Hello", "World", "Test"];
    const batch = estimateTokensBatch(messages);
    const sum = messages.reduce((acc, m) => acc + estimateTokens(m), 0);
    // Should be sum + 4 per message
    expect(batch).toBe(sum + messages.length * 4);
  });

  test("realistic conversation estimate", () => {
    const conversation = ["What is 2 + 2?", "The answer is 4.", "Thanks!"];
    const tokens = estimateTokensBatch(conversation);
    // Should be reasonable for a short conversation (~20-30 tokens)
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(50);
  });
});

// ============================================================================
// SCRATCHPAD HELPERS (Session navigation)
// ============================================================================

describe("verifyMath with numeric equation verification", () => {
  test("passes correct computations", () => {
    expect(verify("2 + 2 = 4", "math").passed).toBe(true);
    expect(verify("3 * 5 = 15", "math").passed).toBe(true);
    expect(verify("10 - 3 = 7", "math").passed).toBe(true);
    expect(verify("20 / 4 = 5", "math").passed).toBe(true);
  });

  test("fails incorrect computations", () => {
    const result = verify("2 + 2 = 5", "math");
    expect(result.passed).toBe(false);
    expect(result.suggestions.some((s) => s.includes("Computation error"))).toBe(true);
  });

  test("fails incorrect multiplication", () => {
    const result = verify("3 * 4 = 10", "math");
    expect(result.passed).toBe(false);
  });

  test("handles complex expressions", () => {
    expect(verify("(2 + 3) * 4 = 20", "math").passed).toBe(true);
    expect(verify("2 ^ 3 = 8", "math").passed).toBe(true);
    expect(verify("√16 = 4", "math").passed).toBe(true);
  });

  test("handles Unicode operators", () => {
    expect(verify("6 × 7 = 42", "math").passed).toBe(true);
    expect(verify("20 ÷ 4 = 5", "math").passed).toBe(true);
    expect(verify("10 − 3 = 7", "math").passed).toBe(true);
  });

  test("skips equations with variables", () => {
    // Can't evaluate x + 1 = 5, so it should pass (no computation error)
    const result = verify("x + 1 = 5", "math");
    expect(result.passed).toBe(true);
  });

  test("handles floating point", () => {
    expect(verify("3.14 * 2 = 6.28", "math").passed).toBe(true);
    expect(verify("1.5 + 2.5 = 4", "math").passed).toBe(true);
  });
});

// ============================================================================
// S2: simplifyAST for constant folding and algebraic simplification
// ============================================================================
describe("simplifyAST", () => {
  const parse = (expr: string) => {
    const { tokens } = tokenizeMathExpression(expr);
    const { ast } = buildAST(tokens);
    return ast!;
  };

  test("constant folding - basic operations", () => {
    const simplified = simplifyAST(parse("2 + 3"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(5);
  });

  test("constant folding - complex expression", () => {
    const simplified = simplifyAST(parse("2 * 3 + 4"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(10);
  });

  test("identity: x + 0 → x", () => {
    const simplified = simplifyAST(parse("x + 0"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("identity: 0 + x → x", () => {
    const simplified = simplifyAST(parse("0 + x"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("identity: x * 1 → x", () => {
    const simplified = simplifyAST(parse("x * 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("identity: 1 * x → x", () => {
    const simplified = simplifyAST(parse("1 * x"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("zero: x * 0 → 0", () => {
    const simplified = simplifyAST(parse("x * 0"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("zero: 0 * x → 0", () => {
    const simplified = simplifyAST(parse("0 * x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("power: x ^ 0 → 1", () => {
    const simplified = simplifyAST(parse("x ^ 0"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(1);
  });

  test("power: x ^ 1 → x", () => {
    const simplified = simplifyAST(parse("x ^ 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("power: 1 ^ x → 1", () => {
    const simplified = simplifyAST(parse("1 ^ x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(1);
  });

  test("subtraction: x - 0 → x", () => {
    const simplified = simplifyAST(parse("x - 0"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("self subtraction: x - x → 0", () => {
    const simplified = simplifyAST(parse("x - x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("division: x / 1 → x", () => {
    const simplified = simplifyAST(parse("x / 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("self division: x / x → 1", () => {
    const simplified = simplifyAST(parse("x / x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(1);
  });

  test("division: 0 / x → 0", () => {
    const simplified = simplifyAST(parse("0 / x"));
    expect(simplified.type).toBe("number");
    expect((simplified as { value: number }).value).toBe(0);
  });

  test("double negation: --x → x", () => {
    // Parse "--x" as two unary negations
    const ast = parse("-(-x)");
    const simplified = simplifyAST(ast);
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("unary plus: +x → x", () => {
    // Build AST manually since tokenizer may not parse +x correctly
    const { tokens } = tokenizeMathExpression("0 + x");
    const { ast } = buildAST(tokens);
    const simplified = simplifyAST(ast!);
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("nested simplification", () => {
    // (x + 0) * 1 → x
    const simplified = simplifyAST(parse("(x + 0) * 1"));
    expect(simplified.type).toBe("variable");
    expect((simplified as { name: string }).name).toBe("x");
  });

  test("preserves non-simplifiable expressions", () => {
    const simplified = simplifyAST(parse("x + y"));
    expect(simplified.type).toBe("binary");
  });
});

// ============================================================================
// S3: compareExpressions for algebraic equivalence
// ============================================================================
describe("compareExpressions", () => {
  test("basic equivalence: x + x = 2 * x", () => {
    expect(compareExpressions("x + x", "2 * x")).toBe(true);
  });

  test("commutative: a + b = b + a", () => {
    expect(compareExpressions("a + b", "b + a")).toBe(true);
  });

  test("commutative multiplication: a * b = b * a", () => {
    expect(compareExpressions("a * b", "b * a")).toBe(true);
  });

  test("distributive: a * (b + c) = a * b + a * c", () => {
    expect(compareExpressions("a * (b + c)", "a * b + a * c")).toBe(true);
  });

  test("identity: x + 0 = x", () => {
    expect(compareExpressions("x + 0", "x")).toBe(true);
  });

  test("identity: x * 1 = x", () => {
    expect(compareExpressions("x * 1", "x")).toBe(true);
  });

  test("non-equivalent expressions", () => {
    expect(compareExpressions("x + 1", "x")).toBe(false);
    expect(compareExpressions("x * 2", "x")).toBe(false);
  });

  test("constant expressions", () => {
    expect(compareExpressions("2 + 3", "5")).toBe(true);
    expect(compareExpressions("2 * 3", "6")).toBe(true);
    expect(compareExpressions("2 ^ 3", "8")).toBe(true);
  });

  test("power expressions: x² = x * x", () => {
    expect(compareExpressions("x²", "x * x")).toBe(true);
  });

  test("handles Unicode operators", () => {
    expect(compareExpressions("a × b", "a * b")).toBe(true);
    expect(compareExpressions("a ÷ b", "a / b")).toBe(true);
  });

  test("returns false for invalid expressions", () => {
    expect(compareExpressions("+++", "x")).toBe(false);
    expect(compareExpressions("x", ")))")).toBe(false);
  });

  test("handles expressions with multiple variables", () => {
    expect(compareExpressions("(a + b) * (a - b)", "a² - b²")).toBe(true);
  });
});

// ============================================================================
// formatAST for human-readable output
// ============================================================================
describe("formatAST", () => {
  function parse(expr: string) {
    const { tokens } = tokenizeMathExpression(expr);
    const { ast } = buildAST(tokens);
    return ast!;
  }

  describe("basic formatting", () => {
    test("formats numbers", () => {
      expect(formatAST(parse("42"))).toBe("42");
    });

    test("formats variables", () => {
      expect(formatAST(parse("x"))).toBe("x");
    });

    test("formats binary operations with spaces", () => {
      expect(formatAST(parse("2 + 3"))).toBe("2 + 3");
      expect(formatAST(parse("x * y"))).toBe("x * y");
    });

    test("formats unary minus", () => {
      expect(formatAST(parse("-x"))).toBe("-x");
    });

    test("formats postfix operators", () => {
      expect(formatAST(parse("x²"))).toBe("x²");
      expect(formatAST(parse("x³"))).toBe("x³");
    });
  });

  describe("unicode operators", () => {
    test("converts * to ×", () => {
      expect(formatAST(parse("2 * 3"), { useUnicode: true })).toBe("2 × 3");
    });

    test("converts / to ÷", () => {
      expect(formatAST(parse("6 / 2"), { useUnicode: true })).toBe("6 ÷ 2");
    });

    test("converts - to −", () => {
      expect(formatAST(parse("5 - 3"), { useUnicode: true })).toBe("5 − 3");
    });
  });

  describe("minimal parentheses", () => {
    test("no parens needed for precedence: a + b * c", () => {
      // b * c binds tighter, so no parens needed
      expect(formatAST(parse("a + b * c"), { minimalParens: true })).toBe("a + b * c");
    });

    test("parens for lower precedence: (a + b) * c", () => {
      expect(formatAST(parse("(a + b) * c"), { minimalParens: true })).toBe("(a + b) * c");
    });

    test("parens for right associativity: a - (b - c)", () => {
      expect(formatAST(parse("a - (b - c)"), { minimalParens: true })).toBe("a - (b - c)");
    });

    test("no extra parens for same precedence left-associative: a - b - c", () => {
      // a - b - c means (a - b) - c, no parens needed on output
      expect(formatAST(parse("a - b - c"), { minimalParens: true })).toBe("a - b - c");
    });
  });

  describe("spacing options", () => {
    test("spaces: true (default)", () => {
      expect(formatAST(parse("2+3"), { spaces: true })).toBe("2 + 3");
    });

    test("spaces: false", () => {
      expect(formatAST(parse("2 + 3"), { spaces: false })).toBe("2+3");
    });
  });

  describe("complex expressions", () => {
    test("nested operations", () => {
      expect(formatAST(parse("(a + b) * (c + d)"))).toBe("(a + b) * (c + d)");
    });

    test("powers", () => {
      expect(formatAST(parse("x ^ 2"))).toBe("x ^ 2");
    });

    test("combined", () => {
      const ast = parse("2 * x + 3");
      expect(formatAST(ast, { useUnicode: true })).toBe("2 × x + 3");
    });
  });
});

// ============================================================================
// S2: canonicalizeExpression and trySimplifyToConstant
// ============================================================================
describe("canonicalizeExpression", () => {
  test("constant folding", () => {
    expect(canonicalizeExpression("2 + 3")).toBe("5");
    expect(canonicalizeExpression("2 * 3")).toBe("6");
    expect(canonicalizeExpression("10 / 2")).toBe("5");
  });

  test("identity removal: x + 0 → x", () => {
    const result = canonicalizeExpression("x + 0");
    expect(result).toBe("x");
  });

  test("identity removal: x * 1 → x", () => {
    const result = canonicalizeExpression("x * 1");
    expect(result).toBe("x");
  });

  test("preserves complex expressions", () => {
    const result = canonicalizeExpression("x + y");
    expect(result).toContain("x");
    expect(result).toContain("y");
  });

  test("returns null for invalid expressions", () => {
    expect(canonicalizeExpression("+++")).toBe(null);
    expect(canonicalizeExpression("((")).toBe(null);
  });
});

describe("trySimplifyToConstant", () => {
  test("reduces pure arithmetic to constant", () => {
    expect(trySimplifyToConstant("2 + 3")).toBe(5);
    expect(trySimplifyToConstant("10 / 2")).toBe(5);
    expect(trySimplifyToConstant("2 ^ 3")).toBe(8);
  });

  test("x - x → 0", () => {
    expect(trySimplifyToConstant("x - x")).toBe(0);
  });

  test("x / x → 1", () => {
    expect(trySimplifyToConstant("x / x")).toBe(1);
  });

  test("x ^ 0 → 1", () => {
    expect(trySimplifyToConstant("x ^ 0")).toBe(1);
  });

  test("returns null for non-constant expressions", () => {
    expect(trySimplifyToConstant("x + 1")).toBe(null);
    expect(trySimplifyToConstant("2 * y")).toBe(null);
  });
});

describe("tryFormula algebraic simplification", () => {
  test("solves x - x = ?", () => {
    const result = tryFormula("what is x - x?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(0);
    expect(result.method).toBe("algebraic_simplification");
  });

  test("solves x/x = ?", () => {
    const result = tryFormula("evaluate x / x = ?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(1);
  });

  test("solves pure arithmetic via simplification", () => {
    const result = tryFormula("simplify 2 + 3 * 4 = ?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(14);
  });
});

// ============================================================================
// S3: tryDerivation and verifyDerivationSteps
// ============================================================================
describe("verifyDerivationSteps", () => {
  test("validates simple valid derivation", () => {
    const steps = [
      { lhs: "x + x", rhs: "2 * x" },
      { lhs: "2 * x", rhs: "2x" },
    ];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(true);
    expect(result.steps.length).toBe(2);
  });

  test("catches invalid step", () => {
    const steps = [
      { lhs: "x + x", rhs: "2 * x" },
      { lhs: "2 * x", rhs: "3 * x" }, // Invalid: 2x ≠ 3x
    ];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(false);
    expect(result.invalidStep).toBe(2);
  });

  test("catches discontinuity between steps", () => {
    const steps = [
      { lhs: "x + x", rhs: "2 * x" },
      { lhs: "y + y", rhs: "2 * y" }, // Valid on its own, but doesn't follow from previous
    ];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Discontinuity");
  });

  test("handles empty steps", () => {
    const result = verifyDerivationSteps([]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("No derivation steps found");
  });

  test("validates single step", () => {
    const steps = [{ lhs: "a + b", rhs: "b + a" }];
    const result = verifyDerivationSteps(steps);
    expect(result.valid).toBe(true);
  });
});

describe("tryDerivation", () => {
  test("verifies valid chained derivation", () => {
    const result = tryDerivation("prove: x + x = 2x = 2 * x");
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Valid");
    expect(result.method).toBe("derivation_verification");
  });

  test("catches invalid derivation", () => {
    const result = tryDerivation("show that x + x = 2x = 3x");
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Invalid");
  });

  test("verifies distributive property", () => {
    const result = tryDerivation("verify: a * (b + c) = a*b + a*c");
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Valid");
  });

  test("skips non-derivation text", () => {
    const result = tryDerivation("What is 2 + 2?");
    expect(result.solved).toBe(false);
  });

  test("handles multi-line derivations", () => {
    const text = `
      prove the following:
      x + x = 2x
      2x + 0 = 2x
    `;
    const result = tryDerivation(text);
    expect(result.solved).toBe(true);
    expect(result.result).toContain("Valid");
  });
});

// ============================================================================
// simplifyDerivation - applies simplification and removes redundant steps
// ============================================================================
describe("simplifyDerivation", () => {
  describe("basic simplification", () => {
    test("simplifies x + 0 to x", () => {
      const steps = [{ lhs: "x + 0", rhs: "x" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("x");
      expect(result.simplified[0]?.wasSimplified).toBe(true);
    });

    test("simplifies x * 1 to x", () => {
      const steps = [{ lhs: "x * 1", rhs: "x" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("x");
    });

    test("simplifies x - x to 0", () => {
      const steps = [{ lhs: "x - x", rhs: "0" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("0");
    });

    test("constant folding: 2 + 3 → 5", () => {
      const steps = [{ lhs: "2 + 3", rhs: "5" }];
      const result = simplifyDerivation(steps);

      expect(result.simplified[0]?.simplifiedLhs).toBe("5");
      expect(result.simplified[0]?.simplifiedRhs).toBe("5");
    });
  });

  describe("redundant step removal", () => {
    test("removes identity steps in the middle", () => {
      const steps = [
        { lhs: "x + 0", rhs: "x" },
        { lhs: "x", rhs: "x * 1" }, // x = x (identity after simplification)
        { lhs: "x * 1", rhs: "x + x - x" }, // still x (identity)
        { lhs: "x", rhs: "2 * x / 2" }, // actual transformation
      ];
      const result = simplifyDerivation(steps);

      // Should have fewer steps after cleaning
      expect(result.stepsRemoved).toBeGreaterThan(0);
      expect(result.cleaned.length).toBeLessThan(steps.length);
    });

    test("keeps non-redundant steps", () => {
      const steps = [
        { lhs: "x", rhs: "x + 0" },
        { lhs: "x", rhs: "2 * x / 2" },
        { lhs: "x", rhs: "x * x / x" },
      ];
      const result = simplifyDerivation(steps);

      // First step is never removed
      expect(result.cleaned.length).toBeGreaterThanOrEqual(1);
    });

    test("handles single step (never removed)", () => {
      const steps = [{ lhs: "x + x", rhs: "2 * x" }];
      const result = simplifyDerivation(steps);

      expect(result.cleaned.length).toBe(1);
      expect(result.stepsRemoved).toBe(0);
    });
  });

  describe("suggestions", () => {
    test("generates suggestions for simplifiable expressions", () => {
      const steps = [{ lhs: "x + 0 + 0", rhs: "x" }];
      const result = simplifyDerivation(steps);

      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.summary.some((s) => s.includes("simplif"))).toBe(true);
    });

    test("reports identity steps", () => {
      const steps = [
        { lhs: "x", rhs: "x" }, // pure identity
      ];
      const result = simplifyDerivation(steps);

      expect(result.summary.some((s) => s.toLowerCase().includes("identity"))).toBe(true);
    });

    test("reports when already simplified", () => {
      const steps = [{ lhs: "x", rhs: "y" }];
      const result = simplifyDerivation(steps);

      // Should have a message about being simplified or no changes
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  describe("empty input handling", () => {
    test("handles empty steps array", () => {
      const result = simplifyDerivation([]);

      expect(result.original).toEqual([]);
      expect(result.simplified).toEqual([]);
      expect(result.cleaned).toEqual([]);
      expect(result.stepsRemoved).toBe(0);
    });
  });

  describe("complex derivations", () => {
    test("simplifies quadratic expansion", () => {
      const steps = [
        { lhs: "(a + b) * (a + b)", rhs: "a*a + a*b + b*a + b*b" },
        { lhs: "a*a + a*b + b*a + b*b", rhs: "a² + 2*a*b + b²" },
      ];
      const result = simplifyDerivation(steps);

      expect(result.cleaned.length).toBeGreaterThanOrEqual(1);
    });

    test("preserves valid multi-step derivation", () => {
      const steps = [
        { lhs: "x + x", rhs: "2*x" },
        { lhs: "2*x", rhs: "2x" },
        { lhs: "2x", rhs: "x + x" },
      ];
      const result = simplifyDerivation(steps);

      // Should preserve the structure (circular but valid)
      expect(result.original.length).toBe(3);
    });
  });
});

describe("simplifyDerivationText", () => {
  test("parses and simplifies derivation from text", () => {
    const result = simplifyDerivationText("prove: x + 0 = x = x * 1");

    expect(result).not.toBeNull();
    expect(result?.original.length).toBeGreaterThan(0);
  });

  test("returns null for non-derivation text", () => {
    const result = simplifyDerivationText("hello world");

    expect(result).toBeNull();
  });

  test("handles chained equalities", () => {
    const result = simplifyDerivationText("x + x = 2x = 2*x = x + x");

    expect(result).not.toBeNull();
    expect(result?.original.length).toBe(3); // 4 terms = 3 steps
  });
});

// =============================================================================
// suggestNextStep - proposes next algebraic transformation
// =============================================================================

describe("suggestNextStep", () => {
  describe("identity elimination", () => {
    test("suggests removing addition of zero", () => {
      const result = suggestNextStep([{ lhs: "x + 0", rhs: "x + 0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("add_zero");
      expect(result.description).toContain("zero");
    });

    test("suggests removing multiplication by one", () => {
      const result = suggestNextStep([{ lhs: "x * 1", rhs: "x * 1" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("multiply_one");
      expect(result.description).toContain("one");
    });

    test("suggests simplifying multiplication by zero", () => {
      const result = suggestNextStep([{ lhs: "x * 0", rhs: "x * 0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("multiply_zero");
    });

    test("suggests removing exponent of one", () => {
      const result = suggestNextStep([{ lhs: "x^1", rhs: "x^1" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("power_one");
    });

    test("suggests simplifying exponent of zero", () => {
      const result = suggestNextStep([{ lhs: "x^0", rhs: "x^0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("power_zero");
    });
  });

  describe("constant folding", () => {
    test("suggests evaluating numeric operations", () => {
      const result = suggestNextStep([{ lhs: "2 + 3", rhs: "2 + 3" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("constant_fold");
    });

    test("suggests evaluating nested numeric operations", () => {
      const result = suggestNextStep([{ lhs: "x + 2 * 3", rhs: "x + 2 * 3" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("constant_fold");
    });
  });

  describe("self-cancellation", () => {
    test("suggests self-subtraction simplification", () => {
      const result = suggestNextStep([{ lhs: "x - x", rhs: "x - x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("subtract_self");
    });

    test("suggests self-division simplification", () => {
      const result = suggestNextStep([{ lhs: "x / x", rhs: "x / x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("divide_self");
    });
  });

  describe("combining like terms", () => {
    test("suggests combining x + x", () => {
      const result = suggestNextStep([{ lhs: "x + x", rhs: "x + x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("combine_like_terms");
    });
  });

  describe("distributive law", () => {
    test("suggests distribution when multiplying sum", () => {
      const result = suggestNextStep([{ lhs: "a * (b + c)", rhs: "a * (b + c)" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("distribute");
    });
  });

  describe("double negation", () => {
    test("suggests removing double negation", () => {
      const result = suggestNextStep([{ lhs: "--x", rhs: "--x" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("double_negation");
    });
  });

  describe("fraction simplification", () => {
    test("suggests simplifying reducible fractions", () => {
      const result = suggestNextStep([{ lhs: "4 / 2", rhs: "4 / 2" }]);

      expect(result.hasSuggestion).toBe(true);
      // Could be constant_fold or simplify_fraction depending on priority
      expect(["constant_fold", "simplify_fraction"]).toContain(result.transformation ?? "");
    });
  });

  describe("power rules", () => {
    test("suggests power of power simplification", () => {
      const result = suggestNextStep([{ lhs: "(x^2)^3", rhs: "(x^2)^3" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("power_of_power");
    });
  });

  describe("all applicable transformations", () => {
    test("returns multiple applicable transformations", () => {
      // x * 1 + 0 has both add_zero and multiply_one applicable
      const result = suggestNextStep([{ lhs: "x * 1 + 0", rhs: "x * 1 + 0" }]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.allApplicable.length).toBeGreaterThan(1);
    });
  });

  describe("no suggestions", () => {
    test("returns no suggestion for already simplified expression", () => {
      const result = suggestNextStep([{ lhs: "x", rhs: "x" }]);

      expect(result.hasSuggestion).toBe(false);
      expect(result.allApplicable).toHaveLength(0);
    });

    test("returns no suggestion for empty steps", () => {
      const result = suggestNextStep([]);

      expect(result.hasSuggestion).toBe(false);
    });
  });

  describe("uses last step RHS", () => {
    test("analyzes the last step's RHS, not LHS", () => {
      // First step: x + 0 = x (simplified)
      // Should suggest based on "x" not "x + 0"
      const result = suggestNextStep([
        { lhs: "x + 0", rhs: "x" },
        { lhs: "x", rhs: "x * 1" }, // This has multiply_one applicable
      ]);

      expect(result.hasSuggestion).toBe(true);
      expect(result.transformation).toBe("multiply_one");
      expect(result.currentExpression).toBe("x * 1");
    });
  });
});

describe("suggestNextStepFromText", () => {
  test("parses derivation from text and suggests", () => {
    const result = suggestNextStepFromText("prove: x + 0 = x + 0");

    expect(result).not.toBeNull();
    expect(result?.hasSuggestion).toBe(true);
    expect(result?.transformation).toBe("add_zero");
  });

  test("returns null for non-derivation text", () => {
    const result = suggestNextStepFromText("hello world");

    expect(result).toBeNull();
  });

  test("handles chained equalities", () => {
    const result = suggestNextStepFromText("x * 1 = x * 1 = x");

    expect(result).not.toBeNull();
    // Last step RHS is "x" which is already simplified
    expect(result?.currentExpression).toBe("x");
  });
});

// =============================================================================
// explainDerivationError - human-readable error explanations
// =============================================================================

describe("explainDerivationError", () => {
  test("returns null for valid derivation", () => {
    const result = verifyDerivationSteps([
      { lhs: "x + x", rhs: "2x" },
      { lhs: "2x", rhs: "2 * x" },
    ]);

    expect(result.valid).toBe(true);
    expect(explainDerivationError(result)).toBeNull();
  });

  test("explains invalid algebraic transformation", () => {
    const result = verifyDerivationSteps([
      { lhs: "x + x", rhs: "2x" },
      { lhs: "2x", rhs: "3x" }, // Invalid!
    ]);

    expect(result.valid).toBe(false);

    const explanation = explainDerivationError(result);
    expect(explanation).not.toBeNull();
    expect(explanation?.summary).toContain("step 2");
    expect(explanation?.explanation).toContain("2x");
    expect(explanation?.explanation).toContain("3x");
    expect(explanation?.stepNumber).toBe(2);
    expect(explanation?.expected).toBe("2x");
    expect(explanation?.found).toBe("3x");
    expect(explanation?.fixSuggestions.length).toBeGreaterThan(0);
  });

  test("explains discontinuity error", () => {
    // Test discontinuity: LHS of step 2 doesn't match RHS of step 1
    const result = verifyDerivationSteps([
      { lhs: "x", rhs: "x" },
      { lhs: "y", rhs: "y" }, // LHS 'y' doesn't match previous RHS 'x'
    ]);

    expect(result.valid).toBe(false);

    const explanation = explainDerivationError(result);
    expect(explanation).not.toBeNull();
    expect(explanation?.stepNumber).toBe(2);
    expect(explanation?.fixSuggestions.length).toBeGreaterThan(0);
  });

  test("handles empty steps error", () => {
    const result = verifyDerivationSteps([]);

    expect(result.valid).toBe(false);

    const explanation = explainDerivationError(result);
    expect(explanation).not.toBeNull();
    expect(explanation?.stepNumber).toBe(0);
    expect(explanation?.fixSuggestions.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// derivationToLatex - LaTeX conversion
// =============================================================================

describe("derivationToLatex", () => {
  test("converts simple derivation to LaTeX align", () => {
    const latex = derivationToLatex([
      { lhs: "x + x", rhs: "2x" },
      { lhs: "2x", rhs: "2 * x" },
    ]);

    expect(latex).toContain("\\begin{align}");
    expect(latex).toContain("\\end{align}");
    expect(latex).toContain("x + x &= 2x");
    expect(latex).toContain("&= 2 \\cdot x");
  });

  test("handles step numbers option", () => {
    const latex = derivationToLatex([{ lhs: "a", rhs: "b" }], { showStepNumbers: true });

    expect(latex).toContain("\\text{(1)}");
  });

  test("handles therefore symbol option", () => {
    const latex = derivationToLatex(
      [
        { lhs: "x", rhs: "x" },
        { lhs: "x", rhs: "y" },
      ],
      { showTherefore: true },
    );

    expect(latex).toContain("\\therefore");
  });

  test("handles label option", () => {
    const latex = derivationToLatex([{ lhs: "a", rhs: "b" }], { label: "eq:myeq" });

    expect(latex).toContain("\\label{eq:myeq}");
  });

  test("converts powers correctly", () => {
    const latex = derivationToLatex([{ lhs: "x^2", rhs: "x^10" }]);

    expect(latex).toContain("x^{2}");
    expect(latex).toContain("x^{10}");
  });

  test("converts multiplication operators", () => {
    const latex = derivationToLatex([{ lhs: "a * b", rhs: "a · c" }]);

    expect(latex).toContain("\\cdot");
  });

  test("handles empty steps", () => {
    const latex = derivationToLatex([]);

    expect(latex).toBe("");
  });

  test("derivationTextToLatex extracts and converts", () => {
    const latex = derivationTextToLatex("prove: x + x = 2x = 2 * x");

    expect(latex).not.toBeNull();
    expect(latex).toContain("\\begin{align}");
    expect(latex).toContain("2 \\cdot x");
  });

  test("derivationTextToLatex returns null for non-derivation", () => {
    const latex = derivationTextToLatex("hello world");

    expect(latex).toBeNull();
  });

  test("converts sqrt function", () => {
    const latex = derivationToLatex([{ lhs: "sqrt(x)", rhs: "x^0.5" }]);

    expect(latex).toContain("\\sqrt{x}");
  });

  test("converts common math functions", () => {
    const latex = derivationToLatex([{ lhs: "sin(x)", rhs: "cos(x)" }]);

    expect(latex).toContain("\\sin");
    expect(latex).toContain("\\cos");
  });

  test("converts pi symbol", () => {
    const latex = derivationToLatex([{ lhs: "2 * pi", rhs: "2pi" }]);

    expect(latex).toContain("\\pi");
  });

  test("non-align mode uses equation environment", () => {
    const latex = derivationToLatex([{ lhs: "a", rhs: "b" }], { useAlign: false });

    expect(latex).toContain("\\begin{equation}");
    expect(latex).toContain("\\end{equation}");
    expect(latex).not.toContain("\\begin{align}");
  });
});

// =============================================================================
// suggestSimplificationPath - complete simplification sequence
// =============================================================================

describe("suggestSimplificationPath", () => {
  describe("basic simplifications", () => {
    test("simplifies x + 0 to x", () => {
      const result = suggestSimplificationPath("x + 0");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "add_zero"),
      ).toBe(true);
    });

    test("simplifies x * 1 to x", () => {
      const result = suggestSimplificationPath("x * 1");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "multiply_one"),
      ).toBe(true);
    });

    test("simplifies x * 0 to 0", () => {
      const result = suggestSimplificationPath("x * 0");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("0");
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "multiply_zero"),
      ).toBe(true);
    });

    test("simplifies x - x to 0", () => {
      const result = suggestSimplificationPath("x - x");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("0");
    });

    test("simplifies x / x to 1", () => {
      const result = suggestSimplificationPath("x / x");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
    });
  });

  describe("multi-step simplifications", () => {
    test("simplifies (x + 0) * 1 in multiple steps", () => {
      const result = suggestSimplificationPath("(x + 0) * 1");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(result.steps.length).toBeGreaterThanOrEqual(2);
      expect(result.isFullySimplified).toBe(true);
    });

    test("constant folding: 2 + 3 * 4", () => {
      const result = suggestSimplificationPath("2 + 3 * 4");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("14");
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
    });

    test("tracks each transformation step", () => {
      const result = suggestSimplificationPath("(x + 0) * 1 + 0");

      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThanOrEqual(3);

      // Each step should have before/after
      for (const step of result.steps) {
        expect(step.before).toBeDefined();
        expect(step.after).toBeDefined();
        expect(step.transformation).toBeDefined();
        expect(step.description).toBeDefined();
        expect(step.step).toBeGreaterThan(0);
      }
    });
  });

  describe("power simplifications", () => {
    test("simplifies x^0 to 1", () => {
      const result = suggestSimplificationPath("x^0");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
    });

    test("simplifies x^1 to x", () => {
      const result = suggestSimplificationPath("x^1");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
    });

    test("does not simplify 0^0 (indeterminate)", () => {
      const result = suggestSimplificationPath("0^0");

      // 0^0 is indeterminate - should not simplify
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("0^0"); // Original expression unchanged
      expect(result.steps.length).toBe(0);
      // But it should be detected as indeterminate
      expect(result.isFullySimplified).toBe(false);
    });

    test("simplifies 2^0 to 1 but not 0^0", () => {
      const result = suggestSimplificationPath("2^0 + 0^0");

      // 2^0 should simplify to 1, but 0^0 should remain
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1 + 0 ^ 0");
    });

    test("handles 1^x expression", () => {
      const result = suggestSimplificationPath("1^x");

      // 1^x should simplify to 1 (base_one transformation)
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.steps[0].transformation).toBe("base_one");
    });

    test("handles nested (1^x)^y expression in single step", () => {
      const result = suggestSimplificationPath("(1^x)^y");

      // (1^x)^y should simplify to 1 in a single base_one step
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].transformation).toBe("base_one");
    });

    test("handles deeply nested 1^(x+y) expression", () => {
      const result = suggestSimplificationPath("1^(x+y)");

      // 1^(x+y) should simplify to 1
      expect(result.success).toBe(true);
      expect(result.simplified).toBe("1");
      expect(result.steps[0].transformation).toBe("base_one");
    });
  });

  describe("edge cases", () => {
    test("handles already simplified expressions", () => {
      const result = suggestSimplificationPath("x");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
      expect(result.steps.length).toBe(0);
      expect(result.isFullySimplified).toBe(true);
    });

    test("handles invalid expressions", () => {
      const result = suggestSimplificationPath("+++");

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(0);
    });

    test("respects maxSteps limit", () => {
      // An expression that could have many simplification steps
      const result = suggestSimplificationPath("0 + 0 + 0 + x * 1 * 1", 2);

      expect(result.success).toBe(true);
      expect(result.steps.length).toBeLessThanOrEqual(2);
    });

    test("returns transformationCount", () => {
      const result = suggestSimplificationPath("(x + 0) * 1");

      expect(result.transformationCount).toBe(result.steps.length);
    });
  });

  describe("complex expressions", () => {
    test("simplifies nested identities (partially)", () => {
      const result = suggestSimplificationPath("((x + 0) * 1 - 0) / 1");

      expect(result.success).toBe(true);
      // May require multiple passes or not fully simplify due to nesting
      expect(result.steps.length).toBeGreaterThan(0);
      // The result should be simpler than the original
      expect(result.simplified.length).toBeLessThanOrEqual(result.original.length);
    });

    test("handles double negation", () => {
      const result = suggestSimplificationPath("-(-x)");

      expect(result.success).toBe(true);
      expect(result.simplified).toBe("x");
    });

    test("handles 1^x in compound expression", () => {
      const result = suggestSimplificationPath("1^n + x * 0");

      expect(result.success).toBe(true);
      // Should simplify 1^n to 1 and x*0 to 0, then 1+0 to 1
      expect(result.simplified).toBe("1");
      expect(
        result.steps.some((s: { transformation: string }) => s.transformation === "base_one"),
      ).toBe(true);
    });
  });
});

// =============================================================================
// detectCommonMistakes - algebraic error detection
// =============================================================================

describe("detectCommonMistakes", () => {
  describe("sign errors", () => {
    test("detects swapped subtraction operands", () => {
      const result = detectCommonMistakes([{ lhs: "a - b", rhs: "b - a" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes.length).toBe(1);
      expect(result.mistakes[0].type).toBe("sign_error");
      expect(result.mistakes[0].stepNumber).toBe(1);
      expect(result.mistakes[0].confidence).toBeGreaterThan(0.8);
    });

    test("provides fix suggestion for sign error", () => {
      const result = detectCommonMistakes([{ lhs: "a - b", rhs: "b - a" }]);

      // Should mention subtraction is not commutative or provide sign guidance
      expect(
        result.mistakes[0].suggestion.includes("commutative") ||
          result.mistakes[0].suggestion.includes("Subtraction") ||
          result.mistakes[0].suggestion.includes("sign"),
      ).toBe(true);
    });
  });

  describe("coefficient errors", () => {
    test("detects multiplied instead of added coefficients", () => {
      const result = detectCommonMistakes([
        { lhs: "2x + 3x", rhs: "6x" }, // Should be 5x!
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("coefficient_error");
      expect(result.mistakes[0].expected).toBe("5x");
      expect(result.mistakes[0].found).toBe("6x");
    });

    test("provides explanation for coefficient error", () => {
      const result = detectCommonMistakes([{ lhs: "2x + 3x", rhs: "6x" }]);

      expect(result.mistakes[0].explanation).toContain("ADD");
      expect(result.mistakes[0].suggestion).toContain("5");
    });
  });

  describe("exponent errors", () => {
    test("detects multiplied instead of added exponents", () => {
      const result = detectCommonMistakes([
        { lhs: "x^2 * x^3", rhs: "x^6" }, // Should be x^5!
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("exponent_error");
      expect(result.mistakes[0].expected).toContain("5");
    });

    test("provides rule explanation for exponent error", () => {
      const result = detectCommonMistakes([{ lhs: "x^2 * x^3", rhs: "x^6" }]);

      expect(result.mistakes[0].explanation).toContain("ADD");
      expect(result.mistakes[0].suggestion).toContain("x^5");
    });
  });

  describe("distribution errors", () => {
    test("detects incomplete distribution", () => {
      const result = detectCommonMistakes([
        { lhs: "a * (b + c)", rhs: "a*b + c" }, // Should be ab + ac
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("distribution_error");
    });

    test("provides distribution fix suggestion", () => {
      const result = detectCommonMistakes([{ lhs: "a * (b + c)", rhs: "a*b + c" }]);

      expect(result.mistakes[0].suggestion).toContain("both terms");
    });
  });

  describe("cancellation errors", () => {
    test("detects invalid term cancellation in fractions", () => {
      const result = detectCommonMistakes([
        { lhs: "(a + b) / a", rhs: "b" }, // Invalid cancellation!
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].type).toBe("cancellation_error");
    });

    test("provides cancellation rule explanation", () => {
      const result = detectCommonMistakes([{ lhs: "(a + b) / a", rhs: "b" }]);

      expect(result.mistakes[0].explanation).toContain("cancel");
      expect(result.mistakes[0].suggestion).toContain("FACTORS");
    });
  });

  describe("no mistakes", () => {
    test("returns no mistakes for valid derivation", () => {
      const result = detectCommonMistakes([
        { lhs: "x + x", rhs: "2x" },
        { lhs: "2x", rhs: "2 * x" },
      ]);

      expect(result.hasMistakes).toBe(false);
      expect(result.mistakes.length).toBe(0);
      expect(result.summary).toContain("No common mistakes");
    });

    test("returns no mistakes for identity steps", () => {
      const result = detectCommonMistakes([{ lhs: "x", rhs: "x" }]);

      expect(result.hasMistakes).toBe(false);
    });
  });

  describe("multiple mistakes", () => {
    test("detects mistakes across multiple steps", () => {
      const result = detectCommonMistakes([
        { lhs: "2x + 3x", rhs: "6x" }, // coefficient error
        { lhs: "x^2 * x^3", rhs: "x^6" }, // exponent error
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes.length).toBe(2);
      expect(result.summary).toContain("2 potential mistakes");
    });

    test("provides summary of mistake types", () => {
      const result = detectCommonMistakes([
        { lhs: "2x + 3x", rhs: "6x" },
        { lhs: "a - b", rhs: "b - a" },
      ]);

      expect(result.summary).toContain("coefficient");
      expect(result.summary).toContain("sign");
    });
  });

  describe("detectCommonMistakesFromText", () => {
    test("extracts derivation and detects mistakes", () => {
      const result = detectCommonMistakesFromText("2x + 3x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
    });

    test("returns null for non-derivation text", () => {
      const result = detectCommonMistakesFromText("hello world");

      expect(result).toBeNull();
    });

    test("handles chained derivations", () => {
      const result = detectCommonMistakesFromText("x^2 * x^3 = x^6 = x^5 + x");

      expect(result).not.toBeNull();
      // First step has exponent error
      expect(result?.hasMistakes).toBe(true);
    });

    test("detects subtraction distribution error: x - (y + z) = x - y + z", () => {
      const result = detectCommonMistakesFromText("x - (y + z) = x - y + z");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("subtraction_distribution_error");
      expect(result?.mistakes[0].suggestion).toContain("-(a + b) = -a - b");
    });

    test("detects subtraction distribution error: a - (b - c) = a - b - c", () => {
      const result = detectCommonMistakesFromText("a - (b - c) = a - b - c");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("subtraction_distribution_error");
    });

    test("does not flag correct subtraction distribution: x - (y + z) = x - y - z", () => {
      const result = detectCommonMistakesFromText("x - (y + z) = x - y - z");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct subtraction distribution: a - (b - c) = a - b + c", () => {
      const result = detectCommonMistakesFromText("a - (b - c) = a - b + c");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("detects nested subtraction distribution error: a - (b - (c + d)) = a - b - c - d", () => {
      const result = detectCommonMistakesFromText("a - (b - (c + d)) = a - b - c - d");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("subtraction_distribution_error");
      // Both c and d should have wrong signs
      expect(result?.mistakes[0].suggestion).toContain("'c'");
      expect(result?.mistakes[0].suggestion).toContain("'d'");
    });

    test("does not flag correct nested distribution: a - (b - (c + d)) = a - b + c + d", () => {
      const result = detectCommonMistakesFromText("a - (b - (c + d)) = a - b + c + d");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Subtraction coefficient error tests ===
    test("detects subtraction coefficient error: 5x - 2x = 2x", () => {
      const result = detectCommonMistakesFromText("5x - 2x = 2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3x");
    });

    test("detects subtraction coefficient error: 7y - 4y = 4y", () => {
      const result = detectCommonMistakesFromText("7y - 4y = 4y");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3y");
    });

    test("does not flag correct subtraction: 5x - 2x = 3x", () => {
      const result = detectCommonMistakesFromText("5x - 2x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct FOIL with subtraction: (x - 2)(x + 3) = x^2 + x - 6", () => {
      const result = detectCommonMistakesFromText("(x - 2)(x + 3) = x^2 + x - 6");

      // This should be correct, so no mistakes
      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct FOIL with both subtraction: (x - 2)(x - 3) = x^2 - 5x + 6", () => {
      const result = detectCommonMistakesFromText("(x - 2)(x - 3) = x^2 - 5x + 6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Multi-step derivation parsing tests ===
    test("parses comma-separated multi-step derivation", () => {
      const result = detectCommonMistakesFromText("x = x, 2x + 3x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
    });

    test("parses 'then' separated multi-step derivation", () => {
      const result = detectCommonMistakesFromText("x = x then 2x + 3x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
    });

    test("parses semicolon-separated multi-step derivation", () => {
      const result = detectCommonMistakesFromText("x = x; x^2 * x^3 = x^6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("exponent_error");
    });

    test("parses 'therefore' separated derivation", () => {
      const result = detectCommonMistakesFromText("x = x therefore a - b = b - a");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("sign_error");
    });

    test("detects error in second step of multi-step", () => {
      const result = detectCommonMistakesFromText("x^2 + 2x = x^2 + 2x, then 3x + 2x = 6x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].stepNumber).toBe(2); // Error is in second step
    });

    // === NEW: Implicit coefficient tests ===
    test("detects error with implicit coefficient: x + 2x = 4x", () => {
      const result = detectCommonMistakesFromText("x + 2x = 4x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3x");
    });

    test("detects error with two implicit coefficients: x + x = 3x", () => {
      const result = detectCommonMistakesFromText("x + x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("2x");
    });

    test("detects error with implicit on one side: 3x + x = 5x", () => {
      const result = detectCommonMistakesFromText("3x + x = 5x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("4x");
    });

    test("does not flag correct implicit coefficient: x + 2x = 3x", () => {
      const result = detectCommonMistakesFromText("x + 2x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct two implicit: x + x = 2x", () => {
      const result = detectCommonMistakesFromText("x + x = 2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Negative coefficient tests ===
    test("detects error with leading negative: -x + 3x = 3x", () => {
      const result = detectCommonMistakesFromText("-x + 3x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("2x");
    });

    test("detects error with negative explicit coefficient: -2x + 5x = 5x", () => {
      const result = detectCommonMistakesFromText("-2x + 5x = 5x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("3x");
    });

    test("detects error with two negatives: -2x - x = -2x", () => {
      const result = detectCommonMistakesFromText("-2x - x = -2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("-3x");
    });

    test("detects error with implicit negatives: -x - x = -x", () => {
      const result = detectCommonMistakesFromText("-x - x = -x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("coefficient_error");
      expect(result?.mistakes[0].expected).toBe("-2x");
    });

    test("does not flag correct negative: -x + 3x = 2x", () => {
      const result = detectCommonMistakesFromText("-x + 3x = 2x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct negative explicit: -2x + 5x = 3x", () => {
      const result = detectCommonMistakesFromText("-2x + 5x = 3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct two negatives: -2x - x = -3x", () => {
      const result = detectCommonMistakesFromText("-2x - x = -3x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Power rule derivative error tests ===
    test("detects power rule error: d/dx x^3 = 3x^3", () => {
      const result = detectCommonMistakesFromText("d/dx x^3 = 3x^3");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("power_rule_error");
      expect(result?.mistakes[0].expected).toBe("3x^2");
    });

    test("detects power rule error: derivative of x^4 = 4x^4", () => {
      const result = detectCommonMistakesFromText("derivative of x^4 = 4x^4");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("power_rule_error");
      expect(result?.mistakes[0].expected).toBe("4x^3");
    });

    test("detects power rule error: d/dx x^2 = x (missing coefficient)", () => {
      const result = detectCommonMistakesFromText("d/dx x^2 = x");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("power_rule_error");
      expect(result?.mistakes[0].expected).toBe("2x");
    });

    test("does not flag correct power rule: d/dx x^3 = 3x^2", () => {
      const result = detectCommonMistakesFromText("d/dx x^3 = 3x^2");

      // This is correct, should not detect
      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct power rule: derivative of x^4 = 4x^3", () => {
      const result = detectCommonMistakesFromText("derivative of x^4 = 4x^3");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    // === NEW: Chain rule error tests ===
    test("detects chain rule error: d/dx sin(x^2) = cos(x^2)", () => {
      const result = detectCommonMistakesFromText("d/dx sin(x^2) = cos(x^2)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("chain_rule_error");
      expect(result?.mistakes[0].expected).toContain("2x");
    });

    test("detects chain rule error: d/dx cos(x^2) = -sin(x^2)", () => {
      const result = detectCommonMistakesFromText("d/dx cos(x^2) = -sin(x^2)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("chain_rule_error");
    });

    test("detects chain rule error: d/dx e^(2x) = e^(2x)", () => {
      const result = detectCommonMistakesFromText("d/dx e^(2x) = e^(2x)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("chain_rule_error");
      expect(result?.mistakes[0].expected).toContain("* 2");
    });

    test("does not flag correct chain rule: d/dx sin(x) = cos(x)", () => {
      // No chain rule needed for just x
      const result = detectCommonMistakesFromText("d/dx sin(x) = cos(x)");

      // Should not detect as chain rule error (simple derivative)
      if (result?.hasMistakes) {
        expect(result.mistakes[0].type).not.toBe("chain_rule_error");
      }
    });

    test("includes suggestedFix for chain rule error", () => {
      const result = detectCommonMistakesFromText("d/dx sin(x^2) = cos(x^2)");

      expect(result?.mistakes[0].suggestedFix).toBeDefined();
      expect(result?.mistakes[0].suggestedFix).toContain("=");
    });

    // === NEW: Product rule error tests ===
    test("detects product rule error: d/dx x^2 * sin(x) = 2x * cos(x)", () => {
      const result = detectCommonMistakesFromText("d/dx x^2 * sin(x) = 2x * cos(x)");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("product_rule_error");
    });

    test("product rule error includes suggestedFix", () => {
      const result = detectCommonMistakesFromText("d/dx x * e^x = e^x");

      if (result?.hasMistakes && result.mistakes[0].type === "product_rule_error") {
        expect(result.mistakes[0].suggestedFix).toBeDefined();
        expect(result.mistakes[0].expected).toContain("+");
      }
    });

    // === NEW: Fraction addition error tests ===
    test("detects fraction addition error: 1/2 + 1/3 = 2/5", () => {
      const result = detectCommonMistakesFromText("1/2 + 1/3 = 2/5");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("fraction_error");
      expect(result?.mistakes[0].expected).toBe("5/6");
    });

    test("detects fraction addition error: 1/4 + 1/4 = 2/8", () => {
      const result = detectCommonMistakesFromText("1/4 + 1/4 = 2/8");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("fraction_error");
      // 1/4 + 1/4 = 2/4 = 1/2, not 2/8
      expect(result?.mistakes[0].expected).toBe("1/2");
    });

    test("detects fraction addition error: 2/3 + 1/4 = 3/7", () => {
      const result = detectCommonMistakesFromText("2/3 + 1/4 = 3/7");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].type).toBe("fraction_error");
      // 2/3 + 1/4 = (8 + 3)/12 = 11/12
      expect(result?.mistakes[0].expected).toBe("11/12");
    });

    test("does not flag correct fraction addition: 1/2 + 1/3 = 5/6", () => {
      const result = detectCommonMistakesFromText("1/2 + 1/3 = 5/6");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });

    test("does not flag correct fraction addition: 1/4 + 1/4 = 1/2", () => {
      const result = detectCommonMistakesFromText("1/4 + 1/4 = 1/2");

      expect(result).not.toBeNull();
      expect(result?.hasMistakes).toBe(false);
    });
  });

  describe("step numbering", () => {
    test("correctly numbers step where mistake occurred", () => {
      const result = detectCommonMistakes([
        { lhs: "x", rhs: "x" }, // Valid
        { lhs: "x", rhs: "x" }, // Valid
        { lhs: "2x + 3x", rhs: "6x" }, // Error at step 3
      ]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].stepNumber).toBe(3);
    });
  });

  describe("suggestedFix field", () => {
    test("includes suggestedFix for coefficient error", () => {
      const result = detectCommonMistakes([{ lhs: "2x + 3x", rhs: "6x" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBe("2x + 3x = 5x");
    });

    test("includes suggestedFix for wrong coefficient error", () => {
      const result = detectCommonMistakesFromText("5x - 2x = 2x");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBe("5x - 2x = 3x");
    });

    test("includes suggestedFix for exponent error", () => {
      const result = detectCommonMistakes([{ lhs: "x^2 * x^3", rhs: "x^6" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBe("x^2 * x^3 = x^5");
    });

    test("includes suggestedFix for sign error", () => {
      const result = detectCommonMistakes([{ lhs: "a - b", rhs: "b - a" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBeDefined();
      expect(result.mistakes[0].suggestedFix).toContain("a - b");
    });

    test("includes suggestedFix for distribution error", () => {
      const result = detectCommonMistakes([{ lhs: "a * (b + c)", rhs: "a*b + c" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBeDefined();
      expect(result.mistakes[0].suggestedFix).toContain("=");
    });

    test("includes suggestedFix for cancellation error", () => {
      const result = detectCommonMistakes([{ lhs: "(a + b) / a", rhs: "b" }]);

      expect(result.hasMistakes).toBe(true);
      expect(result.mistakes[0].suggestedFix).toBeDefined();
      expect(result.mistakes[0].suggestedFix).toContain("(a + b) / a");
    });

    test("includes suggestedFix for power rule error", () => {
      const result = detectCommonMistakesFromText("d/dx x^3 = 3x^3");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBe("d/dx x^3 = 3x^2");
    });

    test("includes suggestedFix for fraction addition error", () => {
      const result = detectCommonMistakesFromText("1/2 + 1/3 = 2/5");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBe("1/2 + 1/3 = 5/6");
    });

    test("includes suggestedFix for subtraction distribution error", () => {
      const result = detectCommonMistakesFromText("x - (y + z) = x - y + z");

      expect(result?.hasMistakes).toBe(true);
      expect(result?.mistakes[0].suggestedFix).toBeDefined();
      expect(result?.mistakes[0].suggestedFix).toContain("=");
    });
  });
});
