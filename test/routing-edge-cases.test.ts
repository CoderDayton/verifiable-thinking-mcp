/**
 * Routing Edge Cases Tests
 *
 * Tests for boundary conditions and edge cases in the routing logic.
 * Focuses on cases that could cause regressions if routing logic changes.
 */

import { describe, expect, test } from "bun:test";
import { assessPromptComplexity } from "../src/lib/think/complexity";
import { getComplexityInfo, isExplanatoryQuestion, routeQuestion } from "../src/lib/think/route";
import { needsSpotCheck, primeQuestion, spotCheck } from "../src/lib/think/spot-check";

// =============================================================================
// TIER BOUNDARY TESTS
// =============================================================================

describe("Tier Boundaries", () => {
  describe("Low/Moderate boundary (0.3)", () => {
    test("score 0.29 maps to Low", () => {
      // Find a question that scores around 0.29
      const result = assessPromptComplexity("What is the weather today?");
      if (result.score < 0.3) {
        expect(result.tier).toBe("Low");
      }
    });

    test("score 0.31 maps to Moderate", () => {
      // Find a question that scores around 0.31
      const result = assessPromptComplexity("Explain why the sky is blue");
      if (result.score >= 0.3 && result.score < 0.5) {
        expect(result.tier).toBe("Moderate");
      }
    });

    test("intensity signal bumps Low to Moderate (asymmetric default)", () => {
      // Question with intensity signal but low base score
      const result = assessPromptComplexity("Is this faster than the other?");
      expect(result.explanation.intensity_signals).toContain("comparative");
      // Due to asymmetric default, should be at least Moderate
      expect(result.tier).not.toBe("Low");
    });
  });

  describe("Moderate/High boundary (0.5)", () => {
    test("design verb pushes to High tier", () => {
      const result = assessPromptComplexity("Design an algorithm to sort a list");
      expect(result.tier).toBe("High");
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    test("derive with financial domain reaches High", () => {
      const result = assessPromptComplexity("Derive the formula for compound interest");
      expect(result.tier).toBe("High");
      expect(result.explanation.domain_detected).toBe("financial");
    });
  });

  describe("High/Very Hard boundary (0.72)", () => {
    test("prove with distributed systems reaches Very Hard", () => {
      const result = assessPromptComplexity(
        "Prove that no two-process consensus algorithm can tolerate one crash failure",
      );
      expect(["Very Hard", "Almost Impossible"]).toContain(result.tier);
      expect(result.score).toBeGreaterThanOrEqual(0.72);
    });

    test("counterintuitive booster can push to Very Hard", () => {
      const result = assessPromptComplexity(
        "Explain why the Monty Hall problem has a counterintuitive solution",
      );
      expect(result.tier).toBe("Very Hard");
      expect(result.explanation.verb_type).toContain("[counterintuitive]");
    });
  });

  describe("Very Hard/Almost Impossible boundary (0.85)", () => {
    test("P vs NP proof reaches top tier", () => {
      const result = assessPromptComplexity("Prove P ≠ NP rigorously");
      expect(["Very Hard", "Almost Impossible"]).toContain(result.tier);
    });

    test("quantum cryptography proof reaches top tier", () => {
      const result = assessPromptComplexity(
        "Prove the security of BB84 quantum key distribution protocol against all attacks",
      );
      expect(["Very Hard", "Almost Impossible"]).toContain(result.tier);
    });
  });
});

// =============================================================================
// ROUTING PATH EDGE CASES
// =============================================================================

describe("Routing Path Edge Cases", () => {
  describe("Trivial path edge cases", () => {
    test("long question cannot be trivial", () => {
      const longQuestion = "Is 5 greater than 3? ".repeat(5);
      const route = routeQuestion(longQuestion);
      // Length > 80 should prevent trivial classification
      expect(route.path).not.toBe("trivial");
    });

    test("question with reasoning indicators not trivial", () => {
      const route = routeQuestion("What is the minimum to guarantee a match?");
      expect(route.path).not.toBe("trivial");
    });

    test("question with trap patterns not trivial", () => {
      const route = routeQuestion("If 5 machines make 5 widgets in 5 minutes...");
      expect(route.path).not.toBe("trivial");
    });
  });

  describe("Direct vs Reasoning boundary", () => {
    test("Low tier routes to direct", () => {
      const route = routeQuestion("What is the capital of France?");
      expect(["trivial", "direct"]).toContain(route.path);
      expect(route.tier).toBe("Low");
    });

    test("Moderate tier routes to reasoning", () => {
      const route = routeQuestion("Explain how photosynthesis works in plants");
      expect(route.path).toBe("reasoning");
      expect(route.tier).toBe("Moderate");
    });
  });

  describe("SpotCheck triggering", () => {
    test("trap patterns enable spotCheck", () => {
      const route = routeQuestion(
        "A bat and ball cost $1.10 together. The bat costs $1 more than the ball.",
      );
      expect(route.shouldSpotCheck).toBe(true);
    });

    test("explanatory questions never get spotCheck", () => {
      const route = routeQuestion("Explain why the Monty Hall problem is counterintuitive");
      expect(route.isExplanatory).toBe(true);
      expect(route.shouldSpotCheck).toBe(false);
    });

    test("trivial questions never get spotCheck", () => {
      const route = routeQuestion("Is 5 > 3?");
      expect(route.path).toBe("trivial");
      expect(route.shouldSpotCheck).toBe(false);
    });
  });
});

// =============================================================================
// EXPLANATORY DETECTION EDGE CASES
// =============================================================================

describe("Explanatory Detection Edge Cases", () => {
  test("explain at start of question is explanatory", () => {
    expect(isExplanatoryQuestion("Explain how a car engine works")).toBe(true);
  });

  test("explain embedded is explanatory", () => {
    expect(isExplanatoryQuestion("Can you explain why the sky is blue?")).toBe(true);
  });

  test("how many is NOT explanatory (factual)", () => {
    expect(isExplanatoryQuestion("Explain how many people live in Tokyo")).toBe(false);
  });

  test("how much is NOT explanatory (factual)", () => {
    expect(isExplanatoryQuestion("Describe how much money you need")).toBe(false);
  });

  test("compare is explanatory", () => {
    expect(isExplanatoryQuestion("Compare Python and JavaScript")).toBe(true);
  });

  test("compare and contrast is explanatory", () => {
    expect(isExplanatoryQuestion("Compare and contrast TCP and UDP")).toBe(true);
  });

  test("describe at start is explanatory", () => {
    expect(isExplanatoryQuestion("Describe the process of mitosis")).toBe(true);
  });

  test("calculate is NOT explanatory", () => {
    expect(isExplanatoryQuestion("Explain how to calculate the sum")).toBe(false);
  });

  test("solve is NOT explanatory", () => {
    expect(isExplanatoryQuestion("Describe how to solve for x")).toBe(false);
  });

  test("bare why is NOT explanatory (no explain/describe verb)", () => {
    expect(isExplanatoryQuestion("Why is the sky blue?")).toBe(false);
  });

  test("discuss is explanatory", () => {
    expect(isExplanatoryQuestion("Discuss the implications of climate change")).toBe(true);
  });
});

// =============================================================================
// SPOT-CHECK EDGE CASES
// =============================================================================

describe("Spot-Check Edge Cases", () => {
  describe("needsSpotCheck detection", () => {
    test("additive system pattern detected", () => {
      const result = needsSpotCheck(
        "A bat and ball cost $1.10 total. The bat costs $1 more than the ball.",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("additive_system");
    });

    test("harmonic mean pattern detected", () => {
      const result = needsSpotCheck(
        "A car drives 60 mph one way and 30 mph back. What is the average speed for the round trip?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("harmonic_mean");
    });

    test("rate pattern detected", () => {
      const result = needsSpotCheck(
        "If 5 machines make 5 widgets in 5 minutes, how long for 100 machines to make 100 widgets?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("rate_pattern");
    });

    test("nonlinear growth detected", () => {
      const result = needsSpotCheck(
        "A lily pad doubles in size every day. It fills the lake on day 48. When was it half full?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("nonlinear_growth");
    });

    test("independence (gambler's fallacy) detected", () => {
      const result = needsSpotCheck(
        "I flipped heads 10 times in a row. What's the probability the next flip is heads?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("independence");
    });

    test("pigeonhole detected", () => {
      const result = needsSpotCheck(
        "What is the minimum number of socks you must draw to guarantee a matching pair?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("pigeonhole");
    });

    test("factorial zeros detected", () => {
      const result = needsSpotCheck("How many trailing zeros are in 100! ?");
      expect(result.required).toBe(true);
      expect(result.categories).toContain("factorial_counting");
    });

    test("clock overlap detected", () => {
      const result = needsSpotCheck("How many times do clock hands overlap in 12 hours?");
      expect(result.required).toBe(true);
      expect(result.categories).toContain("clock_overlap");
    });

    test("monty hall detected", () => {
      const result = needsSpotCheck(
        "You pick door 1. The host opens door 3 revealing a goat. Should you switch?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("monty_hall");
    });
  });

  describe("spotCheck answer verification", () => {
    test("catches bat-ball trap answer (10 cents)", () => {
      const result = spotCheck(
        "A bat and ball cost $1.10 total. The bat costs $1 more than the ball. What does the ball cost?",
        "10 cents",
      );
      expect(result.passed).toBe(false);
      expect(result.trapType).toBe("additive_system");
    });

    test("passes correct bat-ball answer (5 cents)", () => {
      const result = spotCheck(
        "A bat and ball cost $1.10 total. The bat costs $1 more than the ball. What does the ball cost?",
        "5 cents",
      );
      expect(result.passed).toBe(true);
    });

    test("catches clock overlap trap (12)", () => {
      const result = spotCheck("How many times do clock hands overlap in 12 hours?", "12");
      expect(result.passed).toBe(false);
      expect(result.trapType).toBe("clock_overlap");
    });

    test("passes correct clock overlap answer (11)", () => {
      const result = spotCheck("How many times do clock hands overlap in 12 hours?", "11");
      expect(result.passed).toBe(true);
    });

    test("catches harmonic mean trap (arithmetic mean)", () => {
      const result = spotCheck(
        "A car goes 60 mph there and 30 mph back. What's the average speed for the round trip?",
        "45 mph",
      );
      expect(result.passed).toBe(false);
      expect(result.trapType).toBe("harmonic_mean");
    });

    test("catches nonlinear growth trap (half of time)", () => {
      const result = spotCheck(
        "A lily pad doubles every day and fills the lake on day 48. When was it half full?",
        "24",
      );
      expect(result.passed).toBe(false);
      expect(result.trapType).toBe("nonlinear_growth");
    });
  });
});

// =============================================================================
// PRIMING EDGE CASES
// =============================================================================

describe("Priming Edge Cases", () => {
  test("single trap priming works (default)", () => {
    const result = primeQuestion(
      "A bat and ball cost $1.10 together. The bat costs $1 more than the ball.",
    );
    expect(result.shouldPrime).toBe(true);
    expect(result.primedTypes.length).toBe(1);
    expect(result.primingPrompt).toBeTruthy();
  });

  test("multi-trap priming with maxCombined=2", () => {
    // Question that might trigger multiple patterns
    const result = primeQuestion(
      "A bat costs $1 more than a ball, total $1.10. What's the average if one is 60mph and one is 30mph?",
      { maxCombined: 2 },
    );
    expect(result.trapTypes.length).toBeGreaterThanOrEqual(1);
    expect(result.primedTypes.length).toBeLessThanOrEqual(2);
  });

  test("confidence threshold filtering", () => {
    // Use a question that triggers a trap pattern but with low confidence
    const result = primeQuestion("The test showed positive", { minConfidence: 0.9 });
    // Should either not prime (no traps) or be filtered by confidence
    expect(result.shouldPrime).toBe(false);
    // Skip reason should be either no traps or confidence-related
    expect(result.skippedReason).toBeTruthy();
  });

  test("exclude types filtering", () => {
    const result = primeQuestion(
      "A bat and ball cost $1.10 together. The bat costs $1 more than the ball.",
      { excludeTypes: ["additive_system"] },
    );
    expect(result.primedTypes).not.toContain("additive_system");
  });

  test("backward compatibility with number parameter", () => {
    const result = primeQuestion(
      "A bat and ball cost $1.10 together. The bat costs $1 more than the ball.",
      2, // Legacy number parameter for maxCombined
    );
    expect(result.shouldPrime).toBe(true);
  });
});

// =============================================================================
// COMPLEXITY INFO HELPER
// =============================================================================

describe("getComplexityInfo helper", () => {
  test("returns all expected fields", () => {
    const info = getComplexityInfo("What is 2+2?");
    expect(info.tier).toBeDefined();
    expect(typeof info.score).toBe("number");
    expect(info.score).toBeGreaterThanOrEqual(0);
    expect(info.score).toBeLessThanOrEqual(1);
    expect(typeof info.trivial).toBe("boolean");
    expect(info.domain).toBeDefined();
    expect(Array.isArray(info.signals)).toBe(true);
  });

  test("trivial flag matches isTrivialQuestion", () => {
    const trivialQ = "Is 5 > 3?";
    const complexQ = "Prove P != NP";

    const trivialInfo = getComplexityInfo(trivialQ);
    const complexInfo = getComplexityInfo(complexQ);

    expect(trivialInfo.trivial).toBe(true);
    expect(complexInfo.trivial).toBe(false);
  });

  test("signals array populated for trap questions", () => {
    const info = getComplexityInfo(
      "A bat and ball cost $1.10 together. The bat costs $1 more than the ball.",
    );
    expect(info.signals).toContain("trap_pattern");
  });
});

// =============================================================================
// DOMAIN ROUTING CONSISTENCY
// =============================================================================

describe("Domain Routing Consistency", () => {
  test("coding domain gets coding meta-domain", () => {
    const route = routeQuestion("Implement a binary search algorithm");
    expect(route.metaDomain).toBe("coding");
  });

  test("scientific domain gets scientific meta-domain", () => {
    const route = routeQuestion("Explain quantum superposition");
    expect(route.metaDomain).toBe("scientific");
  });

  test("financial domain gets financial meta-domain", () => {
    const route = routeQuestion("Explain how mortgage amortization works");
    expect(route.metaDomain).toBe("financial");
  });

  test("educational patterns get educational meta-domain", () => {
    const route = routeQuestion("Explain how students learn in school");
    expect(route.metaDomain).toBe("educational");
  });

  test("general questions get general meta-domain", () => {
    const route = routeQuestion("What is the weather today?");
    expect(route.metaDomain).toBe("general");
  });
});

// =============================================================================
// PROMPT GENERATION CONSISTENCY
// =============================================================================

describe("Prompt Generation Consistency", () => {
  test("trivial path has minimal system prompt", () => {
    const route = routeQuestion("Is 5 > 3?");
    expect(route.path).toBe("trivial");
    expect(route.prompts.main.system.length).toBeLessThan(100);
  });

  test("direct path includes question in user prompt", () => {
    const q = "What is the capital of France?";
    const route = routeQuestion(q);
    if (route.path === "direct") {
      expect(route.prompts.main.user).toContain(q);
    }
  });

  test("reasoning path prompts are well-formed", () => {
    const route = routeQuestion("Derive the quadratic formula");
    expect(route.path).toBe("reasoning");
    // Prompts should be non-empty
    expect(route.prompts.main.system.length).toBeGreaterThan(0);
    expect(route.prompts.main.user.length).toBeGreaterThan(0);
    // User prompt should contain the question
    expect(route.prompts.main.user).toContain("quadratic");
  });

  test("explanatory question uses domain-specific prompt", () => {
    const route = routeQuestion("Explain how a sorting algorithm works");
    expect(route.isExplanatory).toBe(true);
    // Coding domain should have code-related prompt
    if (route.metaDomain === "coding") {
      expect(route.prompts.main.system.toLowerCase()).toContain("code");
    }
  });
});
