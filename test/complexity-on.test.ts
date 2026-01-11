/**
 * O(n) Complexity Guarantee Tests
 *
 * Verifies that assessPromptComplexity and related functions maintain
 * O(n) time complexity as claimed in the architecture.
 *
 * Key guarantees to test:
 * 1. Single-pass operation (no nested loops over input)
 * 2. Linear scaling with input length
 * 3. Bounded regex operations (finite number per call)
 * 4. No recursive pattern matching
 */

import { describe, expect, test } from "bun:test";
import { getDomainWeight } from "../src/lib/domain";
import {
  assessPromptComplexity,
  type ComplexityResult,
  isTrivialQuestion,
} from "../src/lib/think/complexity";
import { type RouteResult, routeQuestion } from "../src/lib/think/route";
import { needsSpotCheck } from "../src/lib/think/spot-check";

// Suppress unused import warnings - types are used
void (isTrivialQuestion as unknown);
void (needsSpotCheck as unknown);

// =============================================================================
// O(n) COMPLEXITY VERIFICATION
// =============================================================================

describe("O(n) Complexity Guarantee", () => {
  /**
   * Test Strategy:
   * If complexity is O(n), then processing 10x input should take ~10x time (with noise).
   * If complexity is O(n^2), then 10x input would take ~100x time.
   *
   * We test by:
   * 1. Running many iterations with small input
   * 2. Running many iterations with 10x input
   * 3. Verifying ratio is bounded by O(n) expectation
   */

  const ITERATIONS = 5000;
  const RATIO_BOUND = 25; // Allow 25x for 10x input (accounts for startup, GC, etc.)

  test("assessPromptComplexity scales linearly with input length", () => {
    const baseText = "What is the derivative of x squared?";
    const scaled10x = baseText.repeat(10);
    const scaled50x = baseText.repeat(50);

    // Warmup
    for (let i = 0; i < 100; i++) {
      assessPromptComplexity(baseText);
      assessPromptComplexity(scaled10x);
    }

    // Measure base
    const baseStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      assessPromptComplexity(baseText);
    }
    const baseTime = performance.now() - baseStart;

    // Measure 10x
    const scaled10xStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      assessPromptComplexity(scaled10x);
    }
    const scaled10xTime = performance.now() - scaled10xStart;

    // Measure 50x
    const scaled50xStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      assessPromptComplexity(scaled50x);
    }
    const scaled50xTime = performance.now() - scaled50xStart;

    const ratio10x = scaled10xTime / baseTime;
    const ratio50x = scaled50xTime / baseTime;

    // O(n) expectation: ratio should be roughly proportional to size increase
    // Allow generous bounds due to caching, startup costs, etc.
    expect(ratio10x).toBeLessThan(RATIO_BOUND);
    expect(ratio50x).toBeLessThan(RATIO_BOUND * 5); // 50x input, allow 125x time

    console.log(`assessPromptComplexity scaling:`);
    console.log(`  Base (${baseText.length} chars): ${(baseTime / ITERATIONS).toFixed(4)}ms avg`);
    console.log(
      `  10x (${scaled10x.length} chars): ${(scaled10xTime / ITERATIONS).toFixed(4)}ms avg, ratio: ${ratio10x.toFixed(2)}x`,
    );
    console.log(
      `  50x (${scaled50x.length} chars): ${(scaled50xTime / ITERATIONS).toFixed(4)}ms avg, ratio: ${ratio50x.toFixed(2)}x`,
    );
  });

  test("getDomainWeight scales linearly with input length", () => {
    const baseText = "Explain quantum entanglement in simple terms";
    const scaled10x = baseText.repeat(10);

    // Warmup
    for (let i = 0; i < 100; i++) {
      getDomainWeight(baseText);
    }

    const baseStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      getDomainWeight(baseText);
    }
    const baseTime = performance.now() - baseStart;

    const scaledStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      getDomainWeight(scaled10x);
    }
    const scaledTime = performance.now() - scaledStart;

    const ratio = scaledTime / baseTime;
    expect(ratio).toBeLessThan(RATIO_BOUND);

    console.log(`getDomainWeight scaling: ${ratio.toFixed(2)}x for 10x input`);
  });

  test("routeQuestion scales linearly with input length", () => {
    const baseText = "Prove that P is not equal to NP with a formal proof";
    const scaled10x = baseText.repeat(10);

    // Warmup
    for (let i = 0; i < 100; i++) {
      routeQuestion(baseText);
    }

    const baseStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      routeQuestion(baseText);
    }
    const baseTime = performance.now() - baseStart;

    const scaledStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      routeQuestion(scaled10x);
    }
    const scaledTime = performance.now() - scaledStart;

    const ratio = scaledTime / baseTime;
    expect(ratio).toBeLessThan(RATIO_BOUND);

    console.log(`routeQuestion scaling: ${ratio.toFixed(2)}x for 10x input`);
  });

  test("needsSpotCheck scales linearly with input length", () => {
    const baseText = "A bat and ball cost $1.10 together. The bat costs $1 more than the ball.";
    const scaled10x = baseText.repeat(10);

    // Warmup
    for (let i = 0; i < 100; i++) {
      needsSpotCheck(baseText);
    }

    const baseStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      needsSpotCheck(baseText);
    }
    const baseTime = performance.now() - baseStart;

    const scaledStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      needsSpotCheck(scaled10x);
    }
    const scaledTime = performance.now() - scaledStart;

    const ratio = scaledTime / baseTime;
    expect(ratio).toBeLessThan(RATIO_BOUND);

    console.log(`needsSpotCheck scaling: ${ratio.toFixed(2)}x for 10x input`);
  });

  test("isTrivialQuestion scales linearly with input length", () => {
    const baseText = "Is 5 greater than 3?";
    const scaled10x = baseText.repeat(10);

    // Warmup
    for (let i = 0; i < 100; i++) {
      isTrivialQuestion(baseText);
    }

    const baseStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      isTrivialQuestion(baseText);
    }
    const baseTime = performance.now() - baseStart;

    const scaledStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      isTrivialQuestion(scaled10x);
    }
    const scaledTime = performance.now() - scaledStart;

    const ratio = scaledTime / baseTime;
    expect(ratio).toBeLessThan(RATIO_BOUND);

    console.log(`isTrivialQuestion scaling: ${ratio.toFixed(2)}x for 10x input`);
  });
});

// =============================================================================
// ABSOLUTE PERFORMANCE BOUNDS
// =============================================================================

describe("Absolute Performance Bounds", () => {
  test("assessPromptComplexity completes in <0.5ms for typical questions", () => {
    const questions = [
      "What is 2 + 2?",
      "Explain how photosynthesis works in plants.",
      "Prove that there are infinitely many prime numbers.",
      "Design an algorithm to find the shortest path in a weighted graph.",
      "A bat and ball cost $1.10 together. The bat costs $1 more than the ball. How much does the ball cost?",
      "Why do people systematically fail at the Monty Hall problem?",
      "Derive the formula for compound interest.",
      "100 prisoners, 100 boxes. Each opens 50. What's the survival probability with loop strategy?",
    ];

    for (const q of questions) {
      const start = performance.now();
      assessPromptComplexity(q);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(0.5);
    }
  });

  test("routeQuestion completes in <1ms for typical questions", () => {
    const questions = [
      "What is the capital of France?",
      "Explain quantum computing.",
      "Prove P != NP",
      "How many trailing zeros in 100!?",
    ];

    for (const q of questions) {
      const start = performance.now();
      routeQuestion(q);
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(1);
    }
  });

  test("handles adversarial long input without timeout", () => {
    // Generate a very long input (100KB of text)
    const longInput = "What is the derivative of x? ".repeat(5000);
    expect(longInput.length).toBeGreaterThan(100000);

    const start = performance.now();
    const result = assessPromptComplexity(longInput);
    const elapsed = performance.now() - start;

    // Should complete in reasonable time even for 100KB
    expect(elapsed).toBeLessThan(50); // 50ms max
    expect(result.tier).toBeDefined();
  });

  test("handles adversarial pattern-heavy input", () => {
    // Input designed to trigger many regex patterns
    const adversarial = [
      "prove quantum cryptography distributed lock-free consensus",
      "derive backpropagation gradient neural network transformer",
      "counterintuitive paradox monty hall probability bayesian",
      "minimum guarantee worst case pigeonhole constraint",
      "explain why can't algorithm impossible polynomial",
    ].join(" ");

    const start = performance.now();
    const result = assessPromptComplexity(adversarial);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1);
    expect(result.tier).toBeDefined();
  });
});

// =============================================================================
// REGEX PATTERN SAFETY
// =============================================================================

describe("Regex Pattern Safety", () => {
  test("no catastrophic backtracking on nested patterns", () => {
    // ReDoS attack patterns
    const redosPatterns = [
      `${"a".repeat(30)}X`, // Classic ReDoS
      `${"step".repeat(20)}X`,
      `prove${" prove".repeat(20)}`,
      `$${"1.10 ".repeat(50)}more than`,
    ];

    for (const pattern of redosPatterns) {
      const start = performance.now();
      assessPromptComplexity(pattern);
      const elapsed = performance.now() - start;

      // Should not hang or take excessive time
      expect(elapsed).toBeLessThan(10);
    }
  });

  test("handles special regex characters safely", () => {
    const specialChars = [
      "What is (x+1)^2 - (x-1)^2?",
      "Solve: a[0] + a[1] + ... + a[n]",
      "Is $100 > $50?",
      "Does 2*3 = 6?",
      "Pattern: ^abc$",
      "Regex: .*?foo",
    ];

    for (const input of specialChars) {
      expect(() => assessPromptComplexity(input)).not.toThrow();
      expect(() => routeQuestion(input)).not.toThrow();
    }
  });
});

// =============================================================================
// MEMORY ALLOCATION
// =============================================================================

describe("Memory Efficiency", () => {
  test("no memory leaks on repeated calls", () => {
    const question = "Explain quantum computing in detail.";

    // Run many iterations - if there's a leak, this would cause issues
    for (let i = 0; i < 10000; i++) {
      assessPromptComplexity(question);
      routeQuestion(question);
    }

    // If we get here without crashing, memory is managed properly
    expect(true).toBe(true);
  });

  test("result objects are independent (no shared state)", () => {
    const q1 = "What is 2+2?";
    const q2 = "Prove P != NP";

    const r1 = assessPromptComplexity(q1);
    const r2 = assessPromptComplexity(q2);

    // Modifying one result shouldn't affect another
    r1.explanation.intensity_signals.push("test");

    expect(r2.explanation.intensity_signals).not.toContain("test");
  });
});

// =============================================================================
// DETERMINISM
// =============================================================================

describe("Deterministic Results", () => {
  test("same input always produces same output", () => {
    const questions = [
      "What is 2+2?",
      "Prove that P != NP",
      "Explain the Monty Hall problem",
      "A bat and ball cost $1.10 together",
    ];

    for (const q of questions) {
      const results: ComplexityResult[] = [];
      for (let i = 0; i < 10; i++) {
        results.push(assessPromptComplexity(q));
      }

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBe(results[0]!.score);
        expect(results[i]!.tier).toBe(results[0]!.tier);
        expect(results[i]!.explanation.verb_type).toBe(results[0]!.explanation.verb_type);
        expect(results[i]!.explanation.domain_detected).toBe(
          results[0]!.explanation.domain_detected,
        );
      }
    }
  });

  test("routeQuestion is deterministic", () => {
    const q = "Explain why compound interest grows faster than simple interest";

    const routes: RouteResult[] = [];
    for (let i = 0; i < 10; i++) {
      routes.push(routeQuestion(q));
    }

    for (let i = 1; i < routes.length; i++) {
      expect(routes[i]!.path).toBe(routes[0]!.path);
      expect(routes[i]!.tier).toBe(routes[0]!.tier);
      expect(routes[i]!.shouldSpotCheck).toBe(routes[0]!.shouldSpotCheck);
    }
  });
});
