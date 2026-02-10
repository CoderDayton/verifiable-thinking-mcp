/**
 * Tests for hypothesis resolution detection
 */

import { describe, expect, test } from "bun:test";
import { analyzeHypothesisResolution, analyzeStepForResolution } from "../src/think/hypothesis.ts";

describe("analyzeStepForResolution", () => {
  const hypothesis = "The number n is prime";
  const successCriteria = "n has no divisors other than 1 and itself";

  test("returns unresolved for neutral text", () => {
    const result = analyzeStepForResolution(
      "Let me check if n is divisible by 2",
      hypothesis,
      successCriteria,
      1,
    );

    expect(result.resolved).toBe(false);
    expect(result.outcome).toBeNull();
  });

  test("detects confirmation with 'therefore...proven'", () => {
    const result = analyzeStepForResolution(
      "Therefore the hypothesis is proven true",
      hypothesis,
      successCriteria,
      3,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("confirmed");
    expect(result.resolved_at_step).toBe(3);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  test("detects confirmation with QED", () => {
    const result = analyzeStepForResolution(
      "This completes the proof. QED",
      hypothesis,
      successCriteria,
      5,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("confirmed");
  });

  test("detects confirmation with 'we have shown'", () => {
    const result = analyzeStepForResolution(
      "We have shown that n satisfies all conditions",
      hypothesis,
      successCriteria,
      4,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("confirmed");
  });

  test("detects refutation with 'contradiction'", () => {
    const result = analyzeStepForResolution(
      "This leads to a contradiction since n is even",
      hypothesis,
      successCriteria,
      3,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("refuted");
    expect(result.confidence).toBe(0.9);
  });

  test("detects refutation with 'impossible'", () => {
    const result = analyzeStepForResolution(
      "This is impossible given our constraints",
      hypothesis,
      null,
      2,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("refuted");
  });

  test("detects refutation with 'hypothesis is false'", () => {
    const result = analyzeStepForResolution(
      "The hypothesis is false because n = 4 = 2 * 2",
      hypothesis,
      null,
      2,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("refuted");
  });

  test("detects refutation with 'counterexample'", () => {
    const result = analyzeStepForResolution(
      "Found a counterexample: n = 6 has divisor 2",
      hypothesis,
      null,
      4,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("refuted");
  });

  test("detects inconclusive explicitly stated", () => {
    const result = analyzeStepForResolution(
      "The result is inconclusive at this point",
      hypothesis,
      null,
      3,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("inconclusive");
  });

  test("detects need for more evidence", () => {
    const result = analyzeStepForResolution(
      "We need more evidence to determine the answer",
      hypothesis,
      null,
      2,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("inconclusive");
  });

  test("refutation takes priority over confirmation", () => {
    // Text with both signals - refutation should win
    const result = analyzeStepForResolution(
      "Although we thought it was true, this is a contradiction",
      hypothesis,
      null,
      3,
    );

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("refuted");
  });

  test("boosts confidence when success criteria matches", () => {
    const resultWithCriteria = analyzeStepForResolution(
      "We have shown that n has no divisors other than 1 and itself. QED",
      hypothesis,
      successCriteria,
      4,
    );

    const resultWithoutCriteria = analyzeStepForResolution(
      "We have shown something. QED",
      hypothesis,
      successCriteria,
      4,
    );

    expect(resultWithCriteria.confidence).toBeGreaterThan(resultWithoutCriteria.confidence);
  });

  test("returns suggestion based on outcome", () => {
    const confirmed = analyzeStepForResolution(
      "Therefore hypothesis is proven",
      hypothesis,
      null,
      1,
    );
    expect(confirmed.suggestion).toContain("merging");

    const refuted = analyzeStepForResolution("This is a contradiction", hypothesis, null, 1);
    expect(refuted.suggestion).toContain("abandon");

    const inconclusive = analyzeStepForResolution("Result is inconclusive", hypothesis, null, 1);
    expect(inconclusive.suggestion).toContain("more evidence");
  });

  test("preserves hypothesis and criteria in result", () => {
    const result = analyzeStepForResolution("Some reasoning step", hypothesis, successCriteria, 1);

    expect(result.hypothesis).toBe(hypothesis);
    expect(result.success_criteria).toBe(successCriteria);
  });
});

describe("analyzeHypothesisResolution", () => {
  const hypothesis = "x > 0 implies x^2 > 0";

  test("returns unresolved for empty steps", () => {
    const result = analyzeHypothesisResolution([], hypothesis, null);

    expect(result.resolved).toBe(false);
    expect(result.outcome).toBeNull();
  });

  test("finds resolution in first matching step", () => {
    const steps = [
      { step: 1, thought: "Let x be any positive number" },
      { step: 2, thought: "Then x^2 = x * x" },
      { step: 3, thought: "Since x > 0, we have x^2 > 0. QED" },
      { step: 4, thought: "This confirms our hypothesis" },
    ];

    const result = analyzeHypothesisResolution(steps, hypothesis, null);

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("confirmed");
    expect(result.resolved_at_step).toBe(3); // First resolution, not step 4
  });

  test("finds refutation across multiple steps", () => {
    const steps = [
      { step: 1, thought: "Let me analyze this problem" },
      { step: 2, thought: "Let's check edge cases" },
      { step: 3, thought: "We found a contradiction for x = 0" },
    ];

    const result = analyzeHypothesisResolution(steps, hypothesis, null);

    expect(result.resolved).toBe(true);
    expect(result.outcome).toBe("refuted");
    expect(result.resolved_at_step).toBe(3);
  });

  test("returns continue suggestion when unresolved", () => {
    const steps = [
      { step: 1, thought: "Let me analyze this problem" },
      { step: 2, thought: "Still working on it" },
    ];

    const result = analyzeHypothesisResolution(steps, hypothesis, null);

    expect(result.resolved).toBe(false);
    expect(result.suggestion).toContain("Continue testing");
  });

  test("handles long hypothesis in suggestion", () => {
    const longHypothesis =
      "This is a very long hypothesis that exceeds fifty characters and needs truncation";
    const result = analyzeHypothesisResolution([], longHypothesis, null);

    expect(result.suggestion).toContain("...");
    expect(result.suggestion.length).toBeLessThan(200);
  });
});

describe("performance", () => {
  test("handles large text efficiently", () => {
    const longText = `${"This is some reasoning. ".repeat(1000)}QED`;

    const start = performance.now();
    const result = analyzeStepForResolution(longText, "test hypothesis", null, 1);
    const elapsed = performance.now() - start;

    expect(result.resolved).toBe(true);
    expect(elapsed).toBeLessThan(50); // Should be fast
  });

  test("handles many steps efficiently", () => {
    const steps = Array.from({ length: 100 }, (_, i) => ({
      step: i + 1,
      thought: `Step ${i + 1}: Analyzing the problem further`,
    }));
    // Add resolution at the end
    steps.push({ step: 101, thought: "Therefore the hypothesis is confirmed" });

    const start = performance.now();
    const result = analyzeHypothesisResolution(steps, "test", null);
    const elapsed = performance.now() - start;

    expect(result.resolved).toBe(true);
    expect(result.resolved_at_step).toBe(101);
    expect(elapsed).toBeLessThan(100);
  });
});
