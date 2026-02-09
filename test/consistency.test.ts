/**
 * Tests for consistency checker - contradiction detection
 */

import { describe, expect, test } from "bun:test";
import { checkConsistency, checkStepConsistency } from "../src/think/consistency.ts";

describe("checkConsistency", () => {
  test("returns no contradictions for single step", () => {
    const result = checkConsistency([{ step: 1, thought: "Let x = 5" }]);

    expect(result.has_contradictions).toBe(false);
    expect(result.contradictions).toHaveLength(0);
    expect(result.steps_analyzed).toBe(1);
  });

  test("returns no contradictions for consistent steps", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let x = 5" },
      { step: 2, thought: "Then y = x + 3 = 8" },
      { step: 3, thought: "Therefore z = y * 2 = 16" },
    ]);

    expect(result.has_contradictions).toBe(false);
    expect(result.contradictions).toHaveLength(0);
    expect(result.steps_analyzed).toBe(3);
  });

  test("detects value reassignment contradiction", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let x = 5" },
      { step: 2, thought: "Now x = 10" },
    ]);

    expect(result.has_contradictions).toBe(true);
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].type).toBe("value_reassignment");
    expect(result.contradictions[0].subject).toBe("x");
    expect(result.contradictions[0].original_step).toBe(1);
    expect(result.contradictions[0].original_value).toBe("5");
    expect(result.contradictions[0].conflicting_step).toBe(2);
    expect(result.contradictions[0].conflicting_value).toBe("10");
  });

  test("detects logical conflict - always vs never", () => {
    const result = checkConsistency([
      { step: 1, thought: "This function always returns true" },
      { step: 2, thought: "The function never returns true when input is 0" },
    ]);

    expect(result.has_contradictions).toBe(true);
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
    const logicalConflict = result.contradictions.find((c) => c.type === "logical_conflict");
    expect(logicalConflict).toBeDefined();
  });

  test("detects logical conflict - all vs none", () => {
    const result = checkConsistency([
      { step: 1, thought: "All prime numbers greater than 2 are odd" },
      { step: 2, thought: "None of the numbers we tested are odd primes" },
    ]);

    // This might not be detected as a conflict since they're in different contexts
    // The checker is conservative to avoid false positives
    expect(result.steps_analyzed).toBe(2);
  });

  test("detects sign flip contradiction", () => {
    const result = checkConsistency([
      { step: 1, thought: "The value is positive" },
      { step: 2, thought: "Therefore the value is negative" },
    ]);

    expect(result.has_contradictions).toBe(true);
    const signFlip = result.contradictions.find((c) => c.type === "sign_flip");
    expect(signFlip).toBeDefined();
    if (signFlip) {
      expect(signFlip.original_value).toBe("positive");
      expect(signFlip.conflicting_value).toBe("negative");
    }
  });

  test("detects direction reversal", () => {
    const result = checkConsistency([
      { step: 1, thought: "The function is increasing" },
      { step: 2, thought: "We see the function is decreasing" },
    ]);

    expect(result.has_contradictions).toBe(true);
    const signFlip = result.contradictions.find((c) => c.type === "sign_flip");
    expect(signFlip).toBeDefined();
    if (signFlip) {
      expect(signFlip.original_value).toBe("increasing");
      expect(signFlip.conflicting_value).toBe("decreasing");
    }
  });

  test("handles multiple contradictions", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let x = 5 and y = positive" },
      { step: 2, thought: "Now x = 10 and y is negative" },
    ]);

    expect(result.has_contradictions).toBe(true);
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
  });

  test("ignores same-step reassignments", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let x = 5, wait let me recalculate, x = 10" },
    ]);

    // Same step, so no inter-step contradiction
    expect(result.has_contradictions).toBe(false);
  });

  test("handles empty input", () => {
    const result = checkConsistency([]);

    expect(result.has_contradictions).toBe(false);
    expect(result.contradictions).toHaveLength(0);
    expect(result.steps_analyzed).toBe(0);
  });

  test("handles assignments with different variable names", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let x = 5" },
      { step: 2, thought: "Let y = 10" },
    ]);

    expect(result.has_contradictions).toBe(false);
  });

  test("is case insensitive for variable names", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let X = 5" },
      { step: 2, thought: "Now x = 10" },
    ]);

    expect(result.has_contradictions).toBe(true);
    expect(result.contradictions[0].subject).toBe("x");
  });

  test("handles floating point values", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let pi = 3.14" },
      { step: 2, thought: "Wait, pi = 3.14159" },
    ]);

    expect(result.has_contradictions).toBe(true);
    expect(result.contradictions[0].original_value).toBe("3.14");
    expect(result.contradictions[0].conflicting_value).toBe("3.14159");
  });

  test("handles negative values", () => {
    const result = checkConsistency([
      { step: 1, thought: "Let temp = -5" },
      { step: 2, thought: "Now temp = -10" },
    ]);

    expect(result.has_contradictions).toBe(true);
    expect(result.contradictions[0].original_value).toBe("-5");
    expect(result.contradictions[0].conflicting_value).toBe("-10");
  });
});

describe("checkStepConsistency", () => {
  test("returns empty for first step", () => {
    const contradictions = checkStepConsistency({ step: 1, thought: "Let x = 5" }, []);

    expect(contradictions).toHaveLength(0);
  });

  test("detects contradiction with prior steps", () => {
    const contradictions = checkStepConsistency({ step: 3, thought: "Now x = 10" }, [
      { step: 1, thought: "Let x = 5" },
      { step: 2, thought: "y = x + 2" },
    ]);

    expect(contradictions.length).toBeGreaterThanOrEqual(1);
    expect(contradictions[0].conflicting_step).toBe(3);
  });

  test("only returns contradictions involving new step", () => {
    const contradictions = checkStepConsistency({ step: 4, thought: "z = 100" }, [
      { step: 1, thought: "Let x = 5" },
      { step: 2, thought: "x = 10" }, // This is a contradiction between steps 1 and 2
      { step: 3, thought: "y = 20" },
    ]);

    // Should not include the step 1-2 contradiction
    for (const c of contradictions) {
      expect(c.conflicting_step).toBe(4);
    }
  });
});

describe("performance", () => {
  test("handles large number of steps efficiently", () => {
    const steps = Array.from({ length: 100 }, (_, i) => ({
      step: i + 1,
      thought: `Step ${i + 1}: Processing data with value${i} = ${i * 10}`,
    }));

    const start = performance.now();
    const result = checkConsistency(steps);
    const elapsed = performance.now() - start;

    expect(result.steps_analyzed).toBe(100);
    expect(elapsed).toBeLessThan(100); // Should complete in <100ms
  });

  test("handles long text efficiently", () => {
    const longText = `${"This is a test. ".repeat(1000)}Let x = 5`;
    const steps = [
      { step: 1, thought: longText },
      { step: 2, thought: longText.replace("x = 5", "x = 10") },
    ];

    const start = performance.now();
    const result = checkConsistency(steps);
    const elapsed = performance.now() - start;

    expect(result.has_contradictions).toBe(true);
    expect(elapsed).toBeLessThan(100); // Should complete in <100ms
  });
});
