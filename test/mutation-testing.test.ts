/**
 * Mutation Testing for Complexity and Routing Modules
 *
 * This file documents potential mutation points and the tests that catch them.
 * Used for tracking test robustness against code changes.
 */

import { describe, expect, test } from "bun:test";
import { assessPromptComplexity } from "../src/think/complexity";
import { routeQuestion } from "../src/think/route";
import { needsSpotCheck } from "../src/think/spot-check";

// =============================================================================
// MUTATION POINTS IN complexity.ts
// =============================================================================

describe("Mutation Testing: complexity.ts", () => {
  describe("Tier boundary mutations", () => {
    // Mutation: Change 0.3 to 0.29 or 0.31 in tier classification
    test("catches Low/Moderate boundary changes", () => {
      // Score of 0.299 should be Low, 0.301 should be Moderate
      // We test with known questions that fall in these ranges
      const lowResult = assessPromptComplexity("What is 5 + 3?");
      expect(lowResult.tier).toBe("Low");
      expect(lowResult.score).toBeLessThan(0.3);

      const moderateResult = assessPromptComplexity("Explain why the sky is blue");
      expect(moderateResult.tier).toBe("Moderate");
    });

    // Mutation: Change 0.5 to 0.49 or 0.51
    test("catches Moderate/High boundary changes", () => {
      const result = assessPromptComplexity("Design an algorithm to sort a list");
      expect(result.tier).toBe("High");
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    // Mutation: Change 0.72 to different value
    test("catches High/Very Hard boundary changes", () => {
      const result = assessPromptComplexity("Prove that the halting problem is undecidable");
      expect(["Very Hard", "Almost Impossible"]).toContain(result.tier);
    });
  });

  describe("Verb weight mutations", () => {
    // Mutation: Change "prove" weight from 0.95 to 0.85
    test("catches prove verb weight changes", () => {
      const result = assessPromptComplexity("Prove this theorem");
      expect(result.explanation.verb_type).toContain("prove");
      expect(result.explanation.verb_score).toBeGreaterThan(0.9);
    });

    // Mutation: Change "explain why" weight from 0.7 to 0.5
    test("catches explain why verb weight changes", () => {
      const result = assessPromptComplexity("Explain why this works");
      expect(result.explanation.verb_type).toBe("explain why");
      expect(result.explanation.verb_score).toBeGreaterThanOrEqual(0.7);
    });

    // Mutation: Change "design" weight
    test("catches design verb weight changes", () => {
      const result = assessPromptComplexity("Design a system");
      expect(result.explanation.verb_type).toBe("design");
      expect(result.explanation.verb_score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("Booster mutations", () => {
    // Mutation: Remove counterintuitive booster
    test("catches counterintuitive booster removal", () => {
      const base = assessPromptComplexity("Explain probability");
      const boosted = assessPromptComplexity("Explain this counterintuitive probability");
      expect(boosted.explanation.verb_score).toBeGreaterThan(base.explanation.verb_score);
    });

    // Mutation: Remove meta-cognitive booster
    test("catches meta-cognitive booster removal", () => {
      const result = assessPromptComplexity("Why do people systematically fail at this?");
      expect(result.explanation.verb_type).toContain("[meta-cognitive]");
    });

    // Mutation: Remove trap detection booster
    test("catches trap detection booster removal", () => {
      const result = assessPromptComplexity(
        "A bat and ball cost $1.10. The bat costs $1 more than the ball.",
      );
      expect(result.explanation.verb_type).toContain("[trap-detected]");
      expect(result.explanation.intensity_signals).toContain("trap_pattern");
    });
  });

  describe("Intensity modifier mutations", () => {
    // Mutation: Remove quantifier detection
    test("catches quantifier detection removal", () => {
      const result = assessPromptComplexity("Prove that all primes satisfy this");
      expect(result.explanation.intensity_signals).toContain("quantifier");
    });

    // Mutation: Remove impossibility detection
    test("catches impossibility detection removal", () => {
      const result = assessPromptComplexity("Why can't this algorithm work?");
      expect(result.explanation.intensity_signals).toContain("impossibility");
    });

    // Mutation: Remove comparative detection
    test("catches comparative detection removal", () => {
      const result = assessPromptComplexity("Is this faster than FFT?");
      expect(result.explanation.intensity_signals).toContain("comparative");
    });
  });

  describe("Negation correction mutations", () => {
    // Mutation: Remove negation penalty
    test("catches negation penalty removal", () => {
      const hard = assessPromptComplexity("Explain this difficult concept");
      const easy = assessPromptComplexity("Explain this not difficult concept");
      expect(easy.score).toBeLessThan(hard.score);
    });
  });

  describe("Asymmetric default mutations", () => {
    // Mutation: Remove safety bump from Low to Moderate
    test("catches asymmetric default removal", () => {
      const result = assessPromptComplexity("Is this faster than that?");
      expect(result.explanation.intensity_signals).toContain("comparative");
      expect(result.tier).not.toBe("Low"); // Should bump to at least Moderate
    });
  });
});

// =============================================================================
// MUTATION POINTS IN route.ts
// =============================================================================

describe("Mutation Testing: route.ts", () => {
  describe("Path selection mutations", () => {
    // Mutation: Remove trivial path check
    test("catches trivial path removal", () => {
      const result = routeQuestion("Is 5 > 3?");
      expect(result.path).toBe("trivial");
    });

    // Mutation: Remove direct path for Low tier
    test("catches direct path removal", () => {
      const result = routeQuestion("What is the capital of France?");
      expect(["trivial", "direct"]).toContain(result.path);
    });

    // Mutation: Change reasoning path trigger
    test("catches reasoning path trigger changes", () => {
      const result = routeQuestion("Explain how photosynthesis works");
      expect(result.path).toBe("reasoning");
    });
  });

  describe("SpotCheck trigger mutations", () => {
    // Mutation: Remove spotCheck for trap patterns
    test("catches spotCheck trigger removal", () => {
      const result = routeQuestion(
        "A bat and ball cost $1.10. The bat costs $1 more than the ball.",
      );
      expect(result.shouldSpotCheck).toBe(true);
    });

    // Mutation: Add spotCheck for explanatory (should NOT happen)
    test("catches erroneous spotCheck for explanatory", () => {
      const result = routeQuestion("Explain the Monty Hall problem");
      expect(result.isExplanatory).toBe(true);
      expect(result.shouldSpotCheck).toBe(false);
    });

    // Mutation: Add spotCheck for trivial (should NOT happen)
    test("catches erroneous spotCheck for trivial", () => {
      const result = routeQuestion("Is 5 > 3?");
      expect(result.path).toBe("trivial");
      expect(result.shouldSpotCheck).toBe(false);
    });
  });

  describe("Explanatory detection mutations", () => {
    // Mutation: Remove "explain" verb detection
    test("catches explain detection removal", () => {
      const result = routeQuestion("Explain how a car engine works");
      expect(result.isExplanatory).toBe(true);
    });

    // Mutation: Remove "compare" detection
    test("catches compare detection removal", () => {
      const result = routeQuestion("Compare Python and JavaScript");
      expect(result.isExplanatory).toBe(true);
    });

    // Mutation: Incorrectly mark factual as explanatory
    test("catches false positive explanatory", () => {
      const result = routeQuestion("Explain how many people live in Tokyo");
      expect(result.isExplanatory).toBe(false);
    });
  });

  describe("Steps count mutations", () => {
    // Mutation: Change steps count
    test("all paths return steps = 1", () => {
      expect(routeQuestion("Is 5 > 3?").steps).toBe(1);
      expect(routeQuestion("What is the capital of France?").steps).toBe(1);
      expect(routeQuestion("Explain photosynthesis").steps).toBe(1);
      expect(routeQuestion("Prove P != NP").steps).toBe(1);
    });
  });
});

// =============================================================================
// MUTATION POINTS IN spot-check.ts
// =============================================================================

describe("Mutation Testing: spot-check.ts", () => {
  describe("Pattern detection mutations", () => {
    // Mutation: Remove additive system detection
    test("catches additive system detection removal", () => {
      const result = needsSpotCheck(
        "A bat and ball cost $1.10 total. The bat costs $1 more than the ball.",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("additive_system");
    });

    // Mutation: Remove harmonic mean detection
    test("catches harmonic mean detection removal", () => {
      const result = needsSpotCheck(
        "What is the average speed for the round trip at 60mph and 30mph?",
      );
      expect(result.required).toBe(true);
      expect(result.categories).toContain("harmonic_mean");
    });

    // Mutation: Remove rate pattern detection
    test("catches rate pattern detection removal", () => {
      const result = needsSpotCheck("5 machines make 5 widgets in 5 minutes");
      expect(result.required).toBe(true);
      expect(result.categories).toContain("rate_pattern");
    });
  });

  describe("Score threshold mutations", () => {
    // Mutation: Change 0.6 threshold for required
    test("catches score threshold changes", () => {
      // A question that scores exactly around threshold
      const result = needsSpotCheck("What's the minimum number to guarantee a match?");
      expect(result.required).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    });
  });
});

// =============================================================================
// INTEGRATION MUTATION TESTS
// =============================================================================

describe("Mutation Testing: Integration", () => {
  test("complexity -> route pipeline integrity", () => {
    // If complexity changes, routing should follow
    const complexity = assessPromptComplexity("Explain quantum computing");
    const route = routeQuestion("Explain quantum computing");

    expect(route.tier).toBe(complexity.tier);
    expect(route.score).toBe(complexity.score);
  });

  test("spotCheck integration with routing", () => {
    // Questions that should trigger spotCheck via route
    const trapQ = "A bat and ball cost $1.10. The bat costs $1 more.";
    const spotCheck = needsSpotCheck(trapQ);
    const route = routeQuestion(trapQ);

    // If needsSpotCheck says required, routing should enable spotCheck
    if (spotCheck.required && !route.isExplanatory && route.path !== "trivial") {
      expect(route.shouldSpotCheck).toBe(true);
    }
  });
});
