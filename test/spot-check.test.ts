/**
 * Tests for generalized spot-check module - structural trap detection
 */

import { describe, expect, test } from "bun:test";
import { SessionManager } from "../src/lib/session.ts";
import { routeQuestion } from "../src/lib/think/route.ts";
import {
  hasTrapPatterns,
  needsSpotCheck,
  primeQuestion,
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
// COMPLETE OPERATION INTEGRATION
// =============================================================================

describe("Complete operation spot-check integration", () => {
  test("spotCheck is called with question and final_answer", () => {
    // Simulate the complete operation flow
    const question =
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    const wrongAnswer = "10 cents";
    const correctAnswer = "5 cents";

    // Wrong answer should trigger warning
    const wrongResult = spotCheck(question, wrongAnswer);
    expect(wrongResult.passed).toBe(false);
    expect(wrongResult.trapType).toBe("additive_system");

    // Correct answer should pass
    const correctResult = spotCheck(question, correctAnswer);
    expect(correctResult.passed).toBe(true);
  });

  test("spot-check result structure matches ScratchpadResponse.spot_check_result", () => {
    const result = spotCheck("A lily pad doubles daily. Lake full day 48. Half full?", "24");

    // Verify structure matches what handleComplete returns
    expect(typeof result.passed).toBe("boolean");
    expect(result.trapType === null || typeof result.trapType === "string").toBe(true);
    expect(result.warning === null || typeof result.warning === "string").toBe(true);
    expect(result.hint === null || typeof result.hint === "string").toBe(true);
    expect(typeof result.confidence).toBe("number");
  });

  test("no spot-check needed for non-trap questions", () => {
    const simpleQuestion = "What is 2 + 2?";
    const result = needsSpotCheck(simpleQuestion);
    expect(result.required).toBe(false);

    // Even if we run spotCheck, it should pass
    const checkResult = spotCheck(simpleQuestion, "4");
    expect(checkResult.passed).toBe(true);
  });

  test("reconsideration data structure is correct for failed spot-check", () => {
    const question =
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?";
    const wrongAnswer = "10";

    const result = spotCheck(question, wrongAnswer);

    // Verify we have all the data needed for reconsideration prompt
    expect(result.passed).toBe(false);
    expect(result.trapType).toBeTruthy();
    expect(result.hint).toBeTruthy();

    // This is what would be used for reconsideration.suggested_revise
    const suggestedReason = `Potential ${result.trapType} trap: ${result.hint}`;
    expect(suggestedReason).toContain("additive_system");
    expect(suggestedReason).toContain("system");
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
    {
      name: "conjunction_fallacy",
      q: "Which is more likely: bank teller, or bank teller and feminist?",
    },
    { name: "monty_hall", q: "Three doors, host reveals goat, should you switch or stay?" },
    { name: "anchoring", q: "Spin wheel number 65, estimate how many countries in Africa" },
    { name: "sunk_cost", q: "Already invested $10,000. Should you continue to keep going?" },
    {
      name: "framing_effect",
      q: "Program A: 200 people will be saved. Program B: probability all saved or none.",
    },
  ];

  for (const { name, q } of categories) {
    test(`detects ${name} category`, () => {
      const result = needsSpotCheck(q);
      expect(result.categories).toContain(name);
    });
  }
});

// =============================================================================
// CONJUNCTION FALLACY (Linda Problem structure)
// =============================================================================

describe("Conjunction Fallacy trap detection", () => {
  const question =
    "Linda is 31, single, outspoken, and very bright. She majored in philosophy. Which is more likely: (A) Linda is a bank teller, or (B) Linda is a bank teller and active in the feminist movement?";

  test("detects wrong answer (choosing the conjunction)", () => {
    const result = spotCheck(question, "B - bank teller and feminist");
    expectTrap(result, "conjunction_fallacy");
  });

  test("detects wrong answer variant", () => {
    const result = spotCheck(question, "bank teller and active in feminist movement");
    expectTrap(result, "conjunction_fallacy");
  });

  test("passes correct answer (A - just bank teller)", () => {
    const result = spotCheck(question, "A - bank teller");
    expectPass(result);
  });

  test("needsSpotCheck identifies conjunction_fallacy category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("conjunction_fallacy");
  });
});

// =============================================================================
// MONTY HALL
// =============================================================================

describe("Monty Hall trap detection", () => {
  const question =
    "You pick door 1 out of 3 doors. The host, who knows what's behind each door, opens door 3 to reveal a goat. Should you switch to door 2 or stay with door 1?";

  test("detects wrong answer (stay)", () => {
    const result = spotCheck(question, "stay with door 1");
    expectTrap(result, "monty_hall");
  });

  test("detects wrong answer (doesn't matter)", () => {
    const result = spotCheck(question, "doesn't matter, it's 50/50");
    expectTrap(result, "monty_hall");
  });

  test("passes correct answer (switch)", () => {
    const result = spotCheck(question, "switch to door 2");
    expectPass(result);
  });

  test("needsSpotCheck identifies monty_hall category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("monty_hall");
  });

  test("detects 50% probability trap", () => {
    const probQuestion =
      "In Monty Hall, after the host reveals a goat, what's the probability of winning if you stay?";
    const result = spotCheck(probQuestion, "50%");
    expectTrap(result, "monty_hall");
  });
});

// =============================================================================
// SUNK COST FALLACY
// =============================================================================

describe("Sunk Cost Fallacy trap detection", () => {
  const question =
    "You've already invested $10,000 in a failing startup. Should you invest another $5,000 to keep it going, knowing it will likely fail?";

  test("detects wrong answer (continue because of past investment)", () => {
    const result = spotCheck(question, "Yes, continue - I've already spent $10,000");
    expectTrap(result, "sunk_cost");
  });

  test("detects wrong answer (can't waste what was spent)", () => {
    const result = spotCheck(question, "Keep going - can't let that money go to waste");
    expectTrap(result, "sunk_cost");
  });

  test("detects wrong answer (too much invested)", () => {
    const result = spotCheck(question, "Continue because I've come this far");
    expectTrap(result, "sunk_cost");
  });

  test("passes correct answer (focus on future value)", () => {
    const result = spotCheck(
      question,
      "No, stop - only continue if future benefits outweigh future costs, regardless of past spending",
    );
    expectPass(result);
  });

  test("passes correct answer (explicit rational reasoning)", () => {
    const result = spotCheck(
      question,
      "Don't invest - the expected return going forward doesn't justify more investment",
    );
    expectPass(result);
  });

  test("needsSpotCheck identifies sunk_cost category", () => {
    const result = needsSpotCheck(question);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("sunk_cost");
  });

  test("detects sunk cost in movie ticket scenario", () => {
    const movieQuestion =
      "You already paid $15 for a movie ticket but realize you don't want to see it. Should you go anyway?";
    const result = spotCheck(
      movieQuestion,
      "Yes, go - I already paid for it, can't let the money be wasted",
    );
    expectTrap(result, "sunk_cost");
  });

  test("passes movie ticket with correct reasoning", () => {
    const movieQuestion =
      "You already paid $15 for a movie ticket but realize you don't want to see it. Should you go anyway?";
    const result = spotCheck(
      movieQuestion,
      "No - the $15 is gone either way. Go only if watching is worth your time.",
    );
    expectPass(result);
  });
});

// =============================================================================
// FRAMING EFFECT
// =============================================================================

describe("Framing Effect trap detection", () => {
  const gainFrameQuestion =
    "A disease outbreak will kill 600 people. Program A: 200 people will be saved. Program B: 1/3 probability all 600 saved, 2/3 probability no one saved. Which do you choose?";

  const lossFrameQuestion =
    "A disease outbreak affects 600 people. Program A: 400 people will die. Program B: 1/3 probability no one dies, 2/3 probability all 600 die. Which do you choose?";

  test("detects potential framing trap in gain frame (just picking A)", () => {
    const result = spotCheck(gainFrameQuestion, "A");
    expectTrap(result, "framing_effect");
  });

  test("detects potential framing trap in loss frame (just picking B)", () => {
    const result = spotCheck(lossFrameQuestion, "B");
    expectTrap(result, "framing_effect");
  });

  test("passes when answer acknowledges framing equivalence", () => {
    const result = spotCheck(
      gainFrameQuestion,
      "Both options have the same expected value - they are mathematically equivalent",
    );
    expectPass(result);
  });

  test("passes when answer explicitly calculates expected value", () => {
    const result = spotCheck(
      lossFrameQuestion,
      "The expected value is 200 saved for both options, so it doesn't matter rationally",
    );
    expectPass(result);
  });

  test("needsSpotCheck identifies framing_effect category (gain frame)", () => {
    const result = needsSpotCheck(gainFrameQuestion);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("framing_effect");
  });

  test("needsSpotCheck identifies framing_effect category (loss frame)", () => {
    const result = needsSpotCheck(lossFrameQuestion);
    expect(result.required).toBe(true);
    expect(result.categories).toContain("framing_effect");
  });
});

// =============================================================================
// PRIME QUESTION (proactive trap detection)
// =============================================================================

describe("primeQuestion - proactive trap detection", () => {
  test("returns shouldPrime=true with priming prompt for trap questions", () => {
    const result = primeQuestion(
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("additive_system");
    expect(result.primingPrompt).toBeTruthy();
    expect(result.primingPrompt).toContain("variables");
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("returns shouldPrime=false for non-trap questions", () => {
    const result = primeQuestion("What is 2 + 2?");
    expect(result.shouldPrime).toBe(false);
    expect(result.trapTypes).toEqual([]);
    expect(result.primedTypes).toEqual([]);
    expect(result.primingPrompt).toBeNull();
    expect(result.skippedReason).toBe("no_traps_detected");
  });

  test("returns correct priming prompt for exponential growth", () => {
    const result = primeQuestion(
      "A lily pad doubles in size every day. If it takes 48 days to cover the lake, how many days for half?",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("nonlinear_growth");
    expect(result.primingPrompt).toContain("backwards");
  });

  test("returns correct priming prompt for rate pattern (with lowered threshold)", () => {
    // rate_pattern has 0.6 confidence, below default 0.7 threshold
    // Use aggressive options to trigger priming
    const result = primeQuestion(
      "If 5 machines make 5 widgets in 5 minutes, how long for 100 machines to make 100 widgets?",
      { minConfidence: 0.5 },
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("rate_pattern");
    expect(result.primingPrompt).toContain("rate per unit");
  });

  test("rate pattern skipped when below default confidence threshold", () => {
    // Default minConfidence=0.7, rate_pattern=0.6
    const result = primeQuestion(
      "If 5 machines make 5 widgets in 5 minutes, how long for 100 machines to make 100 widgets?",
    );
    expect(result.shouldPrime).toBe(false);
    expect(result.trapTypes).toContain("rate_pattern");
    expect(result.skippedReason).toContain("confidence_below_threshold");
  });

  test("returns correct priming prompt for harmonic mean", () => {
    const result = primeQuestion("Train goes A→B at 60 mph, returns at 40 mph. Average speed?");
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("harmonic_mean");
    expect(result.primingPrompt).toContain("harmonic");
  });

  test("returns correct priming prompt for independence (gambler's fallacy)", () => {
    const result = primeQuestion(
      "A fair coin has landed heads 10 times. What's the probability the next flip is heads?",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("independence");
    expect(result.primingPrompt).toContain("Independent");
  });

  test("returns correct priming prompt for pigeonhole", () => {
    const result = primeQuestion(
      "Drawer has 10 black and 10 white socks. Minimum to guarantee a matching pair?",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("pigeonhole");
    expect(result.primingPrompt).toContain("worst case");
  });

  test("returns correct priming prompt for base rate", () => {
    const result = primeQuestion(
      "Disease affects 1 in 1000. Test is 99% accurate. You test positive. Probability you have it?",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("base_rate");
    expect(result.primingPrompt).toContain("Bayes");
  });

  test("returns correct priming prompt for factorial zeros", () => {
    const result = primeQuestion("How many trailing zeros does 100! have?");
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("factorial_counting");
    expect(result.primingPrompt).toContain("factors of 5");
  });

  test("returns correct priming prompt for clock overlap", () => {
    const result = primeQuestion("How many times do clock hands overlap in 12 hours?");
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("clock_overlap");
    expect(result.primingPrompt).toContain("11 times");
  });

  test("returns correct priming prompt for conjunction fallacy", () => {
    const result = primeQuestion("Which is more likely: bank teller, or bank teller and feminist?");
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("conjunction_fallacy");
    expect(result.primingPrompt).toContain("P(A and B)");
  });

  test("returns correct priming prompt for Monty Hall", () => {
    const result = primeQuestion("Three doors, host reveals goat. Should you switch or stay?");
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("monty_hall");
    expect(result.primingPrompt).toContain("Switching");
  });

  test("returns correct priming prompt for sunk cost", () => {
    const result = primeQuestion("You've already invested $10,000. Should you continue investing?");
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("sunk_cost");
    expect(result.primingPrompt).toContain("irrelevant");
  });

  test("returns correct priming prompt for framing effect", () => {
    const result = primeQuestion(
      "Program A: 200 people saved. Program B: 1/3 probability all saved. Which?",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("framing_effect");
    expect(result.primingPrompt).toContain("expected values");
  });

  test("primeQuestion runs in under 0.1ms", () => {
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
        primeQuestion(q);
      }
    }
    const elapsed = performance.now() - start;
    const avgTime = elapsed / (iterations * questions.length);

    expect(avgTime).toBeLessThan(0.1);
    console.log(`Average primeQuestion time: ${avgTime.toFixed(4)}ms`);
  });

  test("priming prompts are under 20 tokens (approximate)", () => {
    // All trap types should have priming prompts that are concise
    const trapQuestions = [
      "A bat and ball cost $1.10 total. Bat costs $1 more.",
      "Lily pad doubles daily. 48 days full. Half full when?",
      "5 machines 5 widgets 5 minutes. 100 machines 100 widgets?",
      "60 mph there, 40 mph back. Average speed?",
      "10 heads in a row. Next flip probability?",
      "10 black 10 white socks. Minimum for pair?",
      "1 in 1000 disease. 99% test. Positive. Probability?",
      "100! trailing zeros?",
      "Clock hands overlap in 12 hours?",
      "Bank teller OR bank teller and feminist?",
      "Three doors. Host reveals. Switch or stay?",
      "Already invested $10k. Continue?",
      "Program A: 200 saved. Program B: 1/3 all saved.",
    ];

    for (const q of trapQuestions) {
      const result = primeQuestion(q);
      if (result.primingPrompt) {
        // Rough token count: ~4 chars per token
        const approxTokens = result.primingPrompt.length / 4;
        expect(approxTokens).toBeLessThan(30); // Allow some margin
      }
    }
  });

  test("returns allPrompts array with individual prompts", () => {
    const result = primeQuestion(
      "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball.",
    );
    expect(result.allPrompts).toBeDefined();
    expect(Array.isArray(result.allPrompts)).toBe(true);
    expect(result.allPrompts.length).toBeGreaterThan(0);
    expect(result.allPrompts[0]).toContain("variables");
  });

  test("returns empty allPrompts for non-trap questions", () => {
    const result = primeQuestion("What is 2 + 2?");
    expect(result.allPrompts).toEqual([]);
  });

  test("combines multiple trap prompts when maxCombined > 1", () => {
    // Construct a question that triggers multiple traps
    // Rate pattern + additive system
    const q =
      "5 workers produce 5 items in 5 minutes. The total cost is $1.10, with item A costing $1 more than item B.";

    // With default maxCombined=1, only the highest-confidence trap is used
    const defaultResult = primeQuestion(q);
    expect(defaultResult.trapTypes.length).toBeGreaterThanOrEqual(2);
    expect(defaultResult.primedTypes.length).toBe(1); // Only one primed
    expect(defaultResult.primingPrompt).not.toContain("1."); // No numbered format

    // With maxCombined=3, multiple traps can be combined
    const multiResult = primeQuestion(q, { maxCombined: 3, minConfidence: 0.5 });
    if (multiResult.trapTypes.length > 1) {
      expect(multiResult.primedTypes.length).toBeGreaterThan(1);
      // Should have numbered format for combined prompt
      expect(multiResult.primingPrompt).toContain("1.");
      expect(multiResult.primingPrompt).toContain("2.");
      // allPrompts should have individual entries
      expect(multiResult.allPrompts.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("respects maxCombined parameter (backward compat number syntax)", () => {
    // Construct a question that might trigger multiple traps
    const q =
      "5 workers produce 5 items in 5 minutes. The total cost is $1.10, with item A costing $1 more than item B. Average speed?";

    // With maxCombined=1 (via number), primedTypes should have at most 1 entry
    const result1 = primeQuestion(q, 1);
    expect(result1.primedTypes.length).toBeLessThanOrEqual(1);

    // With maxCombined=3 (via number) + lower threshold, can have multiple
    const result3 = primeQuestion(q, { maxCombined: 3, minConfidence: 0.5 });
    if (result3.trapTypes.length >= 2) {
      expect(result3.primedTypes.length).toBeGreaterThanOrEqual(
        Math.min(result3.trapTypes.length, 3),
      );
    }
  });

  test("single trap does not use numbered format", () => {
    const result = primeQuestion("How many trailing zeros does 100! have?");
    expect(result.trapTypes).toHaveLength(1);
    expect(result.primingPrompt).not.toContain("1.");
    expect(result.primingPrompt).toContain("⚠️");
  });

  // Smart priming feature tests
  describe("smart priming options", () => {
    test("minConfidence filters out low-confidence detections", () => {
      // rate_pattern has 0.6 confidence
      const q = "5 machines make 5 widgets in 5 minutes. How many for 100 machines?";

      // Default minConfidence=0.7 should skip
      const defaultResult = primeQuestion(q);
      expect(defaultResult.shouldPrime).toBe(false);
      expect(defaultResult.trapTypes).toContain("rate_pattern");
      expect(defaultResult.skippedReason).toContain("confidence_below_threshold");

      // minConfidence=0.5 should prime
      const loweredResult = primeQuestion(q, { minConfidence: 0.5 });
      expect(loweredResult.shouldPrime).toBe(true);
      expect(loweredResult.primedTypes).toContain("rate_pattern");
      expect(loweredResult.skippedReason).toBeNull();
    });

    test("excludeTypes filters out specific trap types", () => {
      // additive_system has 0.8 confidence - normally would prime
      const q =
        "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much?";

      // Without exclusion
      const normal = primeQuestion(q);
      expect(normal.shouldPrime).toBe(true);
      expect(normal.primedTypes).toContain("additive_system");

      // With exclusion
      const excluded = primeQuestion(q, { excludeTypes: ["additive_system"] });
      expect(excluded.shouldPrime).toBe(false);
      expect(excluded.trapTypes).toContain("additive_system"); // Still detected
      expect(excluded.primedTypes).toEqual([]); // But not primed
      expect(excluded.skippedReason).toContain("all_types_excluded");
    });

    test("PRIME_DEFAULTS uses conservative settings", () => {
      // Verify default behavior matches PRIME_DEFAULTS
      const q =
        "A lily pad doubles in size every day. If it takes 48 days to cover the lake, how many days for half?";

      const defaultResult = primeQuestion(q);
      expect(defaultResult.primedTypes.length).toBeLessThanOrEqual(1); // maxCombined=1

      // Nonlinear growth has 0.8 confidence, should pass default threshold
      expect(defaultResult.shouldPrime).toBe(true);
    });

    test("PRIME_AGGRESSIVE allows more traps and lower confidence", () => {
      // Multi-trap question with mixed confidence
      const q =
        "5 workers produce 5 items in 5 minutes. The total cost is $1.10, with item A costing $1 more than item B.";

      // Aggressive settings
      const aggressive = primeQuestion(q, { maxCombined: 2, minConfidence: 0.5 });

      // Should include both traps (rate_pattern at 0.6 + additive_system at 0.8)
      expect(aggressive.trapTypes.length).toBeGreaterThanOrEqual(2);
      expect(aggressive.primedTypes.length).toBe(2);
    });

    test("primedTypes vs trapTypes distinction", () => {
      // Question with multiple detected traps
      const q =
        "5 workers produce 5 items in 5 minutes. The total cost is $1.10, with item A costing $1 more than item B.";

      // With default single-trap mode
      const result = primeQuestion(q);

      // trapTypes shows ALL detected traps
      expect(result.trapTypes.length).toBeGreaterThanOrEqual(2);

      // primedTypes shows only what was actually primed
      expect(result.primedTypes.length).toBe(1);
      expect(result.trapTypes).toContain(result.primedTypes[0]);
    });

    test("skippedReason explains why priming was skipped", () => {
      // No traps
      const noTrap = primeQuestion("What is 2 + 2?");
      expect(noTrap.skippedReason).toBe("no_traps_detected");

      // Low confidence
      const lowConf = primeQuestion("5 machines make 5 widgets in 5 minutes", {
        minConfidence: 0.9,
      });
      expect(lowConf.skippedReason).toContain("confidence_below_threshold");

      // Excluded type - use full pattern that triggers detection
      const excluded = primeQuestion(
        "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball.",
        { excludeTypes: ["additive_system"] },
      );
      expect(excluded.trapTypes).toContain("additive_system");
      expect(excluded.skippedReason).toContain("all_types_excluded");
    });
  }); // close "smart priming options" describe
});

// =============================================================================
// SCRATCHPAD TRAP_ANALYSIS INTEGRATION
// =============================================================================

describe("Scratchpad trap_analysis integration", () => {
  test("setQuestion stores question in session", () => {
    const sessionId = `test-trap-${Date.now()}`;
    const question = "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball.";

    // Store question
    SessionManager.setQuestion(sessionId, question);

    // Retrieve question
    const stored = SessionManager.getQuestion(sessionId);
    expect(stored).toBe(question);

    // Cleanup
    SessionManager.clear(sessionId);
  });

  test("setQuestion first-write-wins (prevents race condition)", () => {
    const sessionId = `test-race-${Date.now()}`;
    const question1 = "First question about bat and ball";
    const question2 = "Second question that should be ignored";

    // First write
    SessionManager.setQuestion(sessionId, question1);
    // Second write should be ignored
    SessionManager.setQuestion(sessionId, question2);

    // Should still have first question
    expect(SessionManager.getQuestion(sessionId)).toBe(question1);

    // Cleanup
    SessionManager.clear(sessionId);
  });

  test("getQuestion returns undefined for non-existent session", () => {
    const stored = SessionManager.getQuestion("non-existent-session");
    expect(stored).toBeUndefined();
  });

  test("question persists across session operations", () => {
    const sessionId = `test-trap-persist-${Date.now()}`;
    const question = "A lily pad doubles daily. 48 days full. Half full?";

    // Store question
    SessionManager.setQuestion(sessionId, question);

    // Add a thought to the session
    const thought = {
      id: `${sessionId}:main:1`,
      step_number: 1,
      thought: "Let me think about this...",
      timestamp: Date.now(),
      branch_id: "main",
    };
    SessionManager.addThought(sessionId, thought);

    // Question should still be retrievable
    expect(SessionManager.getQuestion(sessionId)).toBe(question);

    // Cleanup
    SessionManager.clear(sessionId);
  });

  test("primeQuestion returns trap_analysis structure for trap questions", () => {
    const question = "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball.";
    const result = primeQuestion(question, { maxCombined: 1 });

    // Verify structure matches what scratchpad returns
    expect(result.shouldPrime).toBe(true);
    expect(result.trapTypes).toContain("additive_system");
    expect(result.primingPrompt).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);

    // This is what trap_analysis in scratchpad would look like
    const trapAnalysis = {
      detected: result.shouldPrime && !!result.primingPrompt,
      types: result.trapTypes,
      primed_count: result.primedTypes.length,
      note: result.primingPrompt,
      confidence: result.confidence,
    };

    expect(trapAnalysis.detected).toBe(true);
    expect(trapAnalysis.types).toContain("additive_system");
    expect(trapAnalysis.primed_count).toBe(1);
    expect(trapAnalysis.note).toContain("variables");
    expect(trapAnalysis.confidence).toBeGreaterThan(0.5);
  });

  test("primeQuestion with maxCombined=1 returns single trap (conservative)", () => {
    // Multi-trap question
    const question =
      "5 workers produce 5 items in 5 minutes. Total cost $1.10, A costs $1 more than B.";

    const result = primeQuestion(question, { maxCombined: 1 });

    // Even with multiple detected traps, only one should be primed
    expect(result.trapTypes.length).toBeGreaterThanOrEqual(1);
    expect(result.primedTypes.length).toBeLessThanOrEqual(1);

    // Priming prompt should NOT have numbered format
    if (result.primingPrompt) {
      expect(result.primingPrompt).not.toMatch(/^\d\./);
    }
  });

  test("trap_analysis not returned for non-trap questions", () => {
    const question = "What is 2 + 2?";
    const result = primeQuestion(question, { maxCombined: 1 });

    expect(result.shouldPrime).toBe(false);
    expect(result.primingPrompt).toBeNull();

    // trap_analysis would not be included in scratchpad response
    const trapAnalysis =
      result.shouldPrime && result.primingPrompt
        ? {
            detected: true,
            types: result.trapTypes,
            primed_count: result.primedTypes.length,
            note: result.primingPrompt,
            confidence: result.confidence,
          }
        : undefined;

    expect(trapAnalysis).toBeUndefined();
  });

  test("stored question flows to spotCheck at complete", () => {
    // Simulate the complete operation flow
    const sessionId = `test-complete-${Date.now()}`;
    const question = "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball.";

    // Step 1: Store question (simulating step operation with question param)
    SessionManager.setQuestion(sessionId, question);

    // Step 2: At complete, retrieve stored question
    const storedQuestion = SessionManager.getQuestion(sessionId);
    expect(storedQuestion).toBe(question);

    // Step 3: Run spot-check with stored question
    const wrongAnswer = "10 cents";
    const spotCheckResult = spotCheck(storedQuestion!, wrongAnswer);

    expect(spotCheckResult.passed).toBe(false);
    expect(spotCheckResult.trapType).toBe("additive_system");
    expect(spotCheckResult.hint).toBeTruthy();

    // Cleanup
    SessionManager.clear(sessionId);
  });

  test("complete without stored question skips auto spot-check", () => {
    const sessionId = `test-no-question-${Date.now()}`;

    // Add a thought without storing question
    const thought = {
      id: `${sessionId}:main:1`,
      step_number: 1,
      thought: "Some reasoning...",
      timestamp: Date.now(),
      branch_id: "main",
    };
    SessionManager.addThought(sessionId, thought);

    // No stored question
    const storedQuestion = SessionManager.getQuestion(sessionId);
    expect(storedQuestion).toBeUndefined();

    // Cleanup
    SessionManager.clear(sessionId);
  });

  test("adaptive maxCombined: short questions allow multiple traps", () => {
    // Short multi-trap question (<190 chars) combining rate problem + additive system
    const shortQuestion =
      "If 5 machines take 5 minutes to make 5 widgets, how long for 100 machines? Total cost $1.10, A is $1 more than B.";
    expect(shortQuestion.length).toBeLessThan(190);

    // With maxCombined=2, short questions can have multiple primed traps
    const result = primeQuestion(shortQuestion, { maxCombined: 2 });

    // Should detect multiple trap types
    expect(result.trapTypes.length).toBeGreaterThanOrEqual(2);
    // Should prime up to 2 traps
    expect(result.primedTypes.length).toBeLessThanOrEqual(2);
    if (result.trapTypes.length >= 2) {
      expect(result.primedTypes.length).toBe(2);
    }
  });

  test("adaptive maxCombined: long questions stay conservative", () => {
    // Long question (>=190 chars) - matches multi-trap threshold
    const longQuestion =
      "5 machines make 5 items in 5 minutes. Total cost is $1.10, and item A costs $1 more than item B. " +
      "Please solve this step by step, showing all your work carefully. Consider each part of the problem " +
      "separately before combining your answers. What is the cost of item B?";
    expect(longQuestion.length).toBeGreaterThanOrEqual(190);

    // With maxCombined=1, long questions only get one primed trap
    const result = primeQuestion(longQuestion, { maxCombined: 1 });

    // Should detect multiple trap types
    expect(result.trapTypes.length).toBeGreaterThanOrEqual(1);
    // Should only prime 1 trap (conservative)
    expect(result.primedTypes.length).toBeLessThanOrEqual(1);
  });
});

// =============================================================================
// CONJUNCTION FALLACY EDGE CASES (Beyond Linda Problem)
// =============================================================================

describe("Conjunction Fallacy - varied scenarios", () => {
  // The current detector specifically looks for "bank teller|feminist|active|personality|description"
  // so we test variants that use these patterns

  test("detects conjunction fallacy with 'active' keyword", () => {
    const question = `John is an active volunteer. Which is more likely:
    (A) John is a doctor
    (B) John is a doctor and runs marathons`;
    const result = spotCheck(question, "B - doctor and runs marathons");
    expectTrap(result, "conjunction_fallacy");
  });

  test("detects conjunction fallacy with personality description", () => {
    const question =
      "Sarah has a strong personality and studies math. Which is more probable: (A) Sarah will become a professor, or (B) Sarah will become a professor and win a chess tournament?";
    const result = spotCheck(question, "B");
    expectTrap(result, "conjunction_fallacy");
  });

  test("detects conjunction fallacy with 'both' phrasing", () => {
    const question =
      "Given the description of Tom's personality, which is more likely: winning the lottery, or both winning the lottery and getting struck by lightning?";
    const result = spotCheck(question, "both events happening");
    expectTrap(result, "conjunction_fallacy");
  });

  test("detects conjunction fallacy with 'as well' phrasing", () => {
    const question =
      "Based on the description above, which is more probable: Maria becomes a CEO, or Maria becomes a CEO as well as a published author?";
    const result = spotCheck(question, "CEO as well as author");
    expectTrap(result, "conjunction_fallacy");
  });

  test("passes when choosing the simpler (correct) option", () => {
    const question =
      "Given Bob's description, which is more likely: (A) Bob is a teacher, or (B) Bob is a teacher and plays piano?";
    const result = spotCheck(question, "A - just teacher");
    expectPass(result);
  });

  test("needsSpotCheck triggers for varied conjunction scenarios", () => {
    // These use the required pattern words: bank teller, feminist, active, personality, description
    // AND must match the likely/probable pattern
    const questions = [
      "Based on her personality, which is more likely: engineer, or engineer and musician?",
      "Given his description and active lifestyle, which is more likely: raining, or both raining and cold?",
      "Is she more likely to be a bank teller, or a bank teller and activist?",
    ];

    for (const q of questions) {
      const result = needsSpotCheck(q);
      expect(result.categories).toContain("conjunction_fallacy");
    }
  });
});

// =============================================================================
// MONTY HALL EDGE CASES (Structural detection without "Monty Hall" name)
// =============================================================================

describe("Monty Hall - structural detection", () => {
  test("detects by structure without naming Monty Hall", () => {
    const question =
      "There are 3 boxes. You pick box 1. The host opens box 2 to show it's empty. Should you switch to box 3 or stay with box 1?";
    const result = spotCheck(question, "stay - it's 50/50 now");
    expectTrap(result, "monty_hall");
  });

  test("detects with curtains instead of doors", () => {
    // Must use "should/better/strategy" for answer detection to trigger
    const question =
      "Three curtains hide a prize. You choose curtain A. Host opens curtain C to reveal it's a goat. Should you switch to B or stay with A?";
    const result = spotCheck(question, "doesn't matter, same odds");
    expectTrap(result, "monty_hall");
  });

  test("passes correct answer for structural variant", () => {
    const question = "3 doors, you pick #1, host shows goat behind #2. Should you switch or stay?";
    const result = spotCheck(question, "switch - switching wins 2/3 of the time");
    expectPass(result);
  });
});
