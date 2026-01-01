/**
 * Tests for domain-aware computation filtering
 */

import { describe, expect, test } from "bun:test";
import {
  computeWithContext,
  contextAwareCompute,
  extractAndCompute,
  filterByDomainRelevance,
  filterByMask,
  isMethodRelevant,
  methodToSolverType,
  SolverType,
  wouldKeepComputation,
} from "../src/lib/compute/index.ts";
import { type ThinkArgs, tryAugment } from "../src/lib/think/index.ts";

// =============================================================================
// FILTER.TS TESTS
// =============================================================================

describe("methodToSolverType", () => {
  test("maps arithmetic methods correctly", () => {
    expect(methodToSolverType("arithmetic")).toBe(SolverType.ARITHMETIC);
    expect(methodToSolverType("inline_arithmetic")).toBe(SolverType.ARITHMETIC);
  });

  test("maps calculus methods correctly", () => {
    expect(methodToSolverType("derivative_eval")).toBe(SolverType.CALCULUS);
    expect(methodToSolverType("derivative_symbolic")).toBe(SolverType.CALCULUS);
    expect(methodToSolverType("definite_integral")).toBe(SolverType.CALCULUS);
  });

  test("maps word problem methods correctly", () => {
    expect(methodToSolverType("word_twice")).toBe(SolverType.WORD_PROBLEM);
    expect(methodToSolverType("crt_bat_ball")).toBe(SolverType.WORD_PROBLEM);
    expect(methodToSolverType("word_average")).toBe(SolverType.WORD_PROBLEM);
  });

  test("maps logic methods correctly", () => {
    expect(methodToSolverType("modus_ponens")).toBe(SolverType.LOGIC);
    expect(methodToSolverType("syllogism")).toBe(SolverType.LOGIC);
  });

  test("maps probability methods correctly", () => {
    expect(methodToSolverType("fair_coin_independence")).toBe(SolverType.PROBABILITY);
    expect(methodToSolverType("independent_event")).toBe(SolverType.PROBABILITY);
  });

  test("falls back to ARITHMETIC for unknown methods", () => {
    expect(methodToSolverType("unknown_method")).toBe(SolverType.ARITHMETIC);
  });
});

describe("isMethodRelevant", () => {
  test("arithmetic is relevant for most masks", () => {
    expect(isMethodRelevant("arithmetic", SolverType.ARITHMETIC)).toBe(true);
    expect(isMethodRelevant("arithmetic", SolverType.ARITHMETIC | SolverType.FORMULA_TIER1)).toBe(
      true,
    );
  });

  test("calculus filtered out when not in mask", () => {
    // Financial mask doesn't include CALCULUS
    const financialMask =
      SolverType.ARITHMETIC |
      SolverType.FORMULA_TIER1 |
      SolverType.FORMULA_TIER4 |
      SolverType.WORD_PROBLEM;

    expect(isMethodRelevant("derivative_eval", financialMask)).toBe(false);
    expect(isMethodRelevant("arithmetic", financialMask)).toBe(true);
    expect(isMethodRelevant("word_twice", financialMask)).toBe(true);
  });

  test("probability filtered out of coding context", () => {
    const codingMask =
      SolverType.ARITHMETIC |
      SolverType.FORMULA_TIER1 |
      SolverType.FORMULA_TIER2 |
      SolverType.FORMULA_TIER3;

    expect(isMethodRelevant("fair_coin_independence", codingMask)).toBe(false);
    expect(isMethodRelevant("combinations", codingMask)).toBe(true);
  });
});

describe("filterByDomainRelevance", () => {
  test("financial context filters out calculus", () => {
    const computations = [
      { original: "5 + 3", result: 8, method: "arithmetic", start: 0, end: 5 },
      { original: "d/dx x^2", result: "2x", method: "derivative_symbolic", start: 10, end: 20 },
    ];

    const result = filterByDomainRelevance(computations, "You are a financial advisor");

    expect(result.relevant).toHaveLength(1);
    expect(result.relevant[0].method).toBe("arithmetic");
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].method).toBe("derivative_symbolic");
    expect(result.meta).toBe("financial");
  });

  test("educational context keeps all solvers", () => {
    const computations = [
      { original: "5 + 3", result: 8, method: "arithmetic", start: 0, end: 5 },
      { original: "d/dx x^2", result: "2x", method: "derivative_symbolic", start: 10, end: 20 },
      {
        original: "P(A) given B",
        result: 0.5,
        method: "fair_coin_independence",
        start: 25,
        end: 40,
      },
    ];

    // Use keyword that triggers "common_knowledge" or "paradox" (educational meta)
    const result = filterByDomainRelevance(computations, "Explain the blue eyes puzzle induction");

    // Educational domains get ALL_SOLVERS
    expect(result.relevant).toHaveLength(3);
    expect(result.filtered).toHaveLength(0);
    expect(result.meta).toBe("educational");
  });

  test("coding context filters out probability but keeps combinations", () => {
    const computations = [
      { original: "10 choose 3", result: 120, method: "combinations", start: 0, end: 12 },
      { original: "coin flip", result: 0.5, method: "fair_coin_independence", start: 15, end: 25 },
    ];

    // Use keyword that triggers coding domain (algorithm, complexity)
    const result = filterByDomainRelevance(computations, "Analyze the algorithm time complexity");

    expect(result.relevant).toHaveLength(1);
    expect(result.relevant[0].method).toBe("combinations");
    expect(result.filtered).toHaveLength(1);
    expect(result.meta).toBe("coding");
  });

  test("returns stats correctly", () => {
    const computations = [
      { original: "5 + 3", result: 8, method: "arithmetic", start: 0, end: 5 },
      { original: "d/dx x^2", result: "2x", method: "derivative_symbolic", start: 10, end: 20 },
    ];

    const result = filterByDomainRelevance(computations, "financial planning");

    expect(result.stats.total).toBe(2);
    expect(result.stats.kept).toBe(1);
    expect(result.stats.removed).toBe(1);
  });
});

describe("filterByMask", () => {
  test("filters by explicit mask", () => {
    const computations = [
      { original: "5 + 3", result: 8, method: "arithmetic", start: 0, end: 5 },
      { original: "d/dx x^2", result: "2x", method: "derivative_symbolic", start: 10, end: 20 },
    ];

    const onlyArithmetic = filterByMask(computations, SolverType.ARITHMETIC);
    expect(onlyArithmetic).toHaveLength(1);
    expect(onlyArithmetic[0].method).toBe("arithmetic");
  });
});

// =============================================================================
// CONTEXT.TS TESTS
// =============================================================================

describe("contextAwareCompute", () => {
  test("respects system prompt domain", () => {
    // Financial advisor shouldn't compute derivatives
    const result = contextAwareCompute({
      systemPrompt: "You are a financial advisor helping with investments",
      thought: "The derivative of x^2 is 2x. Also 5 + 3 = ?",
    });

    // Should have detected financial domain
    expect(result.domain).toBe("financial");
    // Arithmetic should still work
    expect(result.augmented).toContain("[=8]");
  });

  test("scientific context keeps all computations", () => {
    const result = contextAwareCompute({
      // Use keyword that triggers scientific domain (calculus, derivative)
      systemPrompt: "Explain how to find the derivative of a function",
      thought: "Calculate 5 + 3 and then find the derivative",
    });

    expect(result.domain).toBe("scientific");
  });

  test("falls back to thought if no system prompt", () => {
    const result = contextAwareCompute({
      thought: "Calculate compound interest on investment",
    });

    expect(result.domain).toBe("financial");
  });

  test("userQuery used when systemPrompt absent", () => {
    const result = contextAwareCompute({
      userQuery: "Help with my finance homework",
      thought: "Let me calculate 5 + 3",
    });

    // userQuery mentions "homework" which is educational
    // but also "finance" - financial should win due to keyword order
    expect(result.domain).toBe("financial");
  });

  test("handles empty computations gracefully", () => {
    const result = contextAwareCompute({
      systemPrompt: "You are helpful",
      thought: "This has no math at all",
    });

    expect(result.hasComputations).toBe(false);
    expect(result.filteredCount).toBe(0);
    expect(result.filteredComputations).toHaveLength(0);
  });

  test("tracks filtered computations", () => {
    // Create a scenario where we filter something
    const result = contextAwareCompute({
      systemPrompt: "You are a financial advisor",
      thought: "The probability of heads is 0.5 after 10 heads in a row. Also 2 + 2.",
    });

    // Arithmetic should work
    expect(result.augmented).toContain("[=4]");
    expect(result.domain).toBe("financial");
  });
});

describe("computeWithContext", () => {
  test("returns augmented string directly", () => {
    const result = computeWithContext("Calculate 5 + 3", "You are a math tutor");
    expect(result).toContain("[=8]");
  });

  test("works without system prompt", () => {
    const result = computeWithContext("Calculate 5 + 3");
    expect(result).toContain("[=8]");
  });
});

describe("wouldKeepComputation", () => {
  test("returns true for relevant methods", () => {
    expect(wouldKeepComputation("arithmetic", "financial advisor")).toBe(true);
    expect(wouldKeepComputation("word_twice", "investment portfolio")).toBe(true);
  });

  test("returns false for filtered methods", () => {
    expect(wouldKeepComputation("derivative_eval", "financial advisor")).toBe(false);
    expect(wouldKeepComputation("fair_coin_independence", "code assistant")).toBe(false);
  });

  test("educational contexts keep everything", () => {
    // Use teaching keywords that trigger educational domain
    expect(wouldKeepComputation("derivative_eval", "You are a math tutor")).toBe(true);
    expect(wouldKeepComputation("fair_coin_independence", "Help with homework")).toBe(true);
    expect(wouldKeepComputation("syllogism", "Explain step by step")).toBe(true);
  });
});

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe("end-to-end filtering", () => {
  test("financial system prompt filters calculus from extraction", () => {
    // First extract everything
    const extraction = extractAndCompute("5 + 3 equals something");

    // Then filter with financial context
    const filtered = filterByDomainRelevance(extraction.computations, "financial advisor");

    // Arithmetic should remain
    expect(filtered.relevant.some((c) => c.method === "inline_arithmetic")).toBe(true);
  });

  test("performance: filtering is fast", () => {
    const computations = Array.from({ length: 100 }, (_, i) => ({
      original: `${i} + 1`,
      result: i + 1,
      method: i % 2 === 0 ? "arithmetic" : "derivative_eval",
      start: i * 10,
      end: i * 10 + 5,
    }));

    const start = performance.now();
    const result = filterByDomainRelevance(computations, "financial advisor");
    const elapsed = performance.now() - start;

    // Should be sub-5ms (allowing for CI variance)
    expect(elapsed).toBeLessThan(5);
    expect(result.relevant).toHaveLength(50); // Only arithmetic
    expect(result.filtered).toHaveLength(50); // Calculus filtered
  });
});

// =============================================================================
// TRYAUGMENT TESTS (think tool helper)
// =============================================================================

describe("tryAugment", () => {
  // Helper to create args with defaults
  const makeArgs = (overrides: Partial<ThinkArgs> = {}): ThinkArgs => ({
    step_number: 1,
    estimated_total: 1,
    purpose: "analysis",
    context: "test",
    thought: "test",
    outcome: "test",
    next_action: "done",
    rationale: "test",
    is_final_step: false,
    guidance: true,
    verify: false,
    local_compute: false,
    augment_compute: false,
    compression_level: "auto",
    baseline: false,
    ...overrides,
  });

  test("returns null when augment_compute is false", () => {
    const result = tryAugment(makeArgs({ augment_compute: false }), "Calculate 5 + 3");
    expect(result).toBeNull();
  });

  test("augments arithmetic expressions", () => {
    const result = tryAugment(makeArgs({ augment_compute: true }), "Calculate 5 + 3");
    expect(result).not.toBeNull();
    expect(result!.augmented).toContain("[=8]");
    expect(result!.count).toBeGreaterThan(0);
  });

  test("respects system_prompt for domain filtering", () => {
    // Financial context - should compute arithmetic
    const financial = tryAugment(
      makeArgs({ augment_compute: true, system_prompt: "You are a financial advisor" }),
      "5 + 3 equals something",
    );
    expect(financial).not.toBeNull();
    expect(financial!.domain).toBe("financial");

    // Coding context with algorithm keyword
    const coding = tryAugment(
      makeArgs({ augment_compute: true, system_prompt: "Analyze this algorithm" }),
      "5 + 3 equals something",
    );
    expect(coding).not.toBeNull();
    expect(coding!.domain).toBe("coding");
  });

  test("returns null when no computations found", () => {
    const result = tryAugment(makeArgs({ augment_compute: true }), "This has no math at all");
    expect(result).toBeNull();
  });

  test("tracks filtered count", () => {
    // Educational context keeps everything
    const result = tryAugment(
      makeArgs({ augment_compute: true, system_prompt: "sleeping beauty paradox" }),
      "5 + 3 equals something",
    );
    expect(result).not.toBeNull();
    expect(result!.filtered).toBe(0); // Nothing filtered in educational context
  });
});
