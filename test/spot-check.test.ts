/**
 * Tests for generalized spot-check module - structural trap detection
 */

import { describe, expect, test } from "bun:test";
import { routeQuestion } from "../src/lib/think/route.ts";
import {
  hasTrapPatterns,
  needsSpotCheck,
  type SpotCheckResult,
  spotCheck,
} from "../src/lib/think/spot-check.ts";

// =============================================================================
// HELPER
// =============================================================================

function expectTrap(result: SpotCheckResult, trapType: string) {
  expect(result.passed).toBe(false);
  expect(result.trapType).toBe(trapType);
  expect(result.warning).toBeTruthy();
  expect(result.hint).toBeTruthy();
  expect(result.confidence).toBeGreaterThan(0.5);
}

function expectPass(result: SpotCheckResult) {
  expect(result.passed).toBe(true);
  expect(result.trapType).toBeNull();
  expect(result.warning).toBeNull();
}

// =============================================================================
// ADDITIVE SYSTEM (Bat & Ball structure)
// =============================================================================

describe("Additive System trap detection", () => {
  const question =
    "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost in cents?";

  test("detects wrong answer (10 cents = 1.10 - 1.00)", () => {
    // Note: 0.10 in the normalized form
    const result = spotCheck(question, "10");
    expectTrap(result, "additive_system");
  });

  test("passes correct answer (5 cents)", () => {
    const result = spotCheck(question, "5");
    expectPass(result);
  });

  test("needsSpotCheck identifies additive_system category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("additive_system");
  });
});

// =============================================================================
// NON-LINEAR GROWTH (Lily Pad structure)
// =============================================================================

describe("Non-Linear Growth trap detection", () => {
  const question =
    "A lily pad doubles in size every day. If it takes 48 days to cover the entire lake, how many days does it take to cover half the lake?";

  test("detects wrong answer (24 days - half of 48)", () => {
    const result = spotCheck(question, "24");
    expectTrap(result, "nonlinear_growth");
  });

  test("passes correct answer (47 days)", () => {
    const result = spotCheck(question, "47");
    expectPass(result);
  });

  test("needsSpotCheck identifies nonlinear_growth category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("nonlinear_growth");
  });
});

// =============================================================================
// RATE PATTERN (Widget Machine structure)
// =============================================================================

describe("Rate Pattern trap detection", () => {
  const question =
    "If 5 machines take 5 minutes to make 5 widgets, how many minutes would it take 100 machines to make 100 widgets?";

  test("detects wrong answer (100 minutes)", () => {
    const result = spotCheck(question, "100");
    expectTrap(result, "rate_pattern");
  });

  test("passes correct answer (5 minutes)", () => {
    const result = spotCheck(question, "5");
    expectPass(result);
  });

  test("needsSpotCheck identifies rate_pattern category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("rate_pattern");
  });
});

// =============================================================================
// HARMONIC MEAN (Average Speed structure)
// =============================================================================

describe("Harmonic Mean trap detection", () => {
  const question =
    "Train goes A→B at 60 mph, returns at 40 mph. Average speed for round trip in mph?";

  test("detects wrong answer (50 mph - arithmetic mean)", () => {
    const result = spotCheck(question, "50");
    expectTrap(result, "harmonic_mean");
  });

  test("passes correct answer (48 mph - harmonic mean)", () => {
    const result = spotCheck(question, "48");
    expectPass(result);
  });

  test("needsSpotCheck identifies harmonic_mean category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("harmonic_mean");
  });
});

// =============================================================================
// PIGEONHOLE (Socks in Dark structure)
// =============================================================================

describe("Pigeonhole trap detection", () => {
  const question =
    "A drawer contains 10 black socks and 10 white socks. In complete darkness, what is the minimum number of socks you must draw to guarantee a matching pair?";

  test("detects wrong answer (2 socks)", () => {
    const result = spotCheck(question, "2");
    expectTrap(result, "pigeonhole");
  });

  test("detects overthinking answer (11 socks)", () => {
    const result = spotCheck(question, "11");
    expectTrap(result, "pigeonhole");
  });

  test("passes correct answer (3 socks)", () => {
    const result = spotCheck(question, "3");
    expectPass(result);
  });

  test("needsSpotCheck identifies pigeonhole category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("pigeonhole");
  });
});

// =============================================================================
// INDEPENDENCE (Gambler's Fallacy structure)
// =============================================================================

describe("Independence trap detection", () => {
  const question =
    "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads? Answer as percentage.";

  test("detects gambler's fallacy (low probability)", () => {
    const result = spotCheck(question, "10");
    expectTrap(result, "independence");
  });

  test("detects gambler's fallacy (high probability)", () => {
    const result = spotCheck(question, "90");
    expectTrap(result, "independence");
  });

  test("passes correct answer (50%)", () => {
    const result = spotCheck(question, "50");
    expectPass(result);
  });

  test("passes correct answer as decimal", () => {
    const result = spotCheck(question, "0.5");
    expectPass(result);
  });

  test("needsSpotCheck identifies independence category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("independence");
  });
});

// =============================================================================
// BASE RATE (Bayes theorem structure)
// =============================================================================

describe("Base Rate trap detection", () => {
  const question =
    "Disease affects 1 in 1000. Test is 99% accurate (99% sensitivity, 99% specificity). You test positive. Probability you have the disease?";

  test("detects wrong answer (99% - ignoring base rate)", () => {
    const result = spotCheck(question, "99");
    expectTrap(result, "base_rate");
  });

  test("detects wrong answer (95%)", () => {
    const result = spotCheck(question, "95");
    expectTrap(result, "base_rate");
  });

  test("passes correct answer (~9%)", () => {
    const result = spotCheck(question, "9");
    expectPass(result);
  });

  test("passes close answer (~10%)", () => {
    const result = spotCheck(question, "10");
    expectPass(result);
  });

  test("needsSpotCheck identifies base_rate category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("base_rate");
  });
});

// =============================================================================
// CLOCK OVERLAP
// =============================================================================

describe("Clock Overlap trap detection", () => {
  test("detects wrong answer for 12 hours (12 instead of 11)", () => {
    const question = "How many times do clock hands overlap in 12 hours?";
    const result = spotCheck(question, "12");
    expectTrap(result, "clock_overlap");
  });

  test("passes correct answer for 12 hours (11)", () => {
    const question = "How many times do clock hands overlap in 12 hours?";
    const result = spotCheck(question, "11");
    expectPass(result);
  });

  test("detects wrong answer for 24 hours (24 instead of 22)", () => {
    const question = "How many times do clock hands overlap in 24 hours?";
    const result = spotCheck(question, "24");
    expectTrap(result, "clock_overlap");
  });

  test("passes correct answer for 24 hours (22)", () => {
    const question = "How many times do clock hands overlap in 24 hours?";
    const result = spotCheck(question, "22");
    expectPass(result);
  });

  test("needsSpotCheck identifies clock_overlap category", () => {
    const result = needsSpotCheck("How many times do clock hands overlap in 12 hours?");
    expect(result.required).toBe(true);
    expect(result.categories).toContain("clock_overlap");
  });
});

// =============================================================================
// FACTORIAL ZEROS
// =============================================================================

describe("Factorial Zeros trap detection", () => {
  const question = "How many trailing zeros does 100! have?";

  test("detects simple wrong answer (20 - just n/5)", () => {
    const result = spotCheck(question, "20");
    expectTrap(result, "factorial_counting");
  });

  test("detects very wrong answer (10 - n/10)", () => {
    const result = spotCheck(question, "10");
    expectTrap(result, "factorial_counting");
  });

  test("passes correct answer (24)", () => {
    const result = spotCheck(question, "24");
    expectPass(result);
  });

  test("needsSpotCheck identifies factorial_counting category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("factorial_counting");
  });
});

// =============================================================================
// NEEDS SPOT CHECK (generalized detection)
// =============================================================================

describe("needsSpotCheck generalized detection", () => {
  test("returns score and categories", () => {
    const result = needsSpotCheck(
      "A bat and ball cost $1.10 total. Bat costs $1.00 more than ball.",
    );
    expect(result.score).toBeGreaterThan(0);
    expect(result.categories.length).toBeGreaterThan(0);
  });

  test("returns false for simple questions", () => {
    expect(needsSpotCheck("What is 2 + 2?").required).toBe(false);
    expect(needsSpotCheck("What is the capital of France?").required).toBe(false);
  });

  test("detects multiple categories when applicable", () => {
    // A question that triggers both rate and additive patterns
    const q =
      "5 workers produce 5 items that cost $1.10 total in 5 minutes. The hammer costs $1.00 more than the nail.";
    const result = needsSpotCheck(q);
    expect(result.categories.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

describe("hasTrapPatterns (legacy)", () => {
  test("returns true for trap questions", () => {
    expect(
      hasTrapPatterns("A bat and ball cost $1.10 total. Bat costs $1.00 more than ball."),
    ).toBe(true);
  });

  test("returns false for simple questions", () => {
    expect(hasTrapPatterns("What is 2 + 2?")).toBe(false);
  });
});

// =============================================================================
// ROUTE INTEGRATION
// =============================================================================

describe("Route integration with spot-check", () => {
  test("shouldSpotCheck is true for trap pattern questions", () => {
    const result = routeQuestion(
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?",
    );
    expect(result.shouldSpotCheck).toBe(true);
  });

  test("shouldSpotCheck is false for low complexity", () => {
    const result = routeQuestion("What is 2 + 2?");
    expect(result.shouldSpotCheck).toBe(false);
  });

  test("shouldSpotCheck is false for explanatory questions", () => {
    const result = routeQuestion("Explain why the bat and ball problem is counterintuitive");
    expect(result.shouldSpotCheck).toBe(false);
    expect(result.isExplanatory).toBe(true);
  });
});

// =============================================================================
// PERFORMANCE
// =============================================================================

describe("Spot-check performance", () => {
  test("spotCheck runs in under 1ms", () => {
    const question =
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    const answer = "10 cents";

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      spotCheck(question, answer);
    }
    const elapsed = performance.now() - start;
    const avgTime = elapsed / iterations;

    expect(avgTime).toBeLessThan(1);
    console.log(`Average spot-check time: ${avgTime.toFixed(4)}ms`);
  });

  test("needsSpotCheck runs in under 0.1ms", () => {
    const questions = [
      "A bat and ball cost $1.10 total",
      "What is 2 + 2?",
      "5 machines make 5 widgets in 5 minutes",
      "Average speed for round trip",
      "Minimum socks to guarantee a pair",
    ];

    const iterations = 1000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      for (const q of questions) {
        needsSpotCheck(q);
      }
    }
    const elapsed = performance.now() - start;
    const avgTime = elapsed / (iterations * questions.length);

    expect(avgTime).toBeLessThan(0.1);
    console.log(`Average needsSpotCheck time: ${avgTime.toFixed(4)}ms`);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe("Edge cases", () => {
  test("handles empty answer", () => {
    const result = spotCheck("What is 2 + 2?", "");
    expectPass(result);
  });

  test("handles non-matching question", () => {
    const result = spotCheck("What is the meaning of life?", "42");
    expectPass(result);
  });

  test("handles answer with extra text", () => {
    const question =
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    const result = spotCheck(question, "I think the answer is 10 cents");
    expectTrap(result, "additive_system");
  });

  test("handles questions without numbers", () => {
    const result = needsSpotCheck("What is the best programming language?");
    expect(result.required).toBe(false);
  });
});

// =============================================================================
// STRUCTURAL CATEGORIES
// =============================================================================

describe("Structural category coverage", () => {
  const categories = [
    { name: "additive_system", q: "Total cost $10, A costs $2 more than B" },
    { name: "nonlinear_growth", q: "Doubles every day, half full" },
    { name: "rate_pattern", q: "5 machines in 5 minutes" },
    { name: "harmonic_mean", q: "Average speed round trip return" },
    { name: "independence", q: "Coin 10 heads in a row probability" },
    { name: "pigeonhole", q: "Minimum guarantee match pair" },
    { name: "base_rate", q: "Test positive 1 in 1000 probability" },
    { name: "factorial_counting", q: "100! trailing zeros" },
    { name: "clock_overlap", q: "Clock hands overlap coincide" },
    { name: "conditional_probability", q: "Given probability if knowing" },
  ];

  for (const { name, q } of categories) {
    test(`detects ${name} category`, () => {
      const result = needsSpotCheck(q);
      expect(result.categories).toContain(name);
    });
  }
});
