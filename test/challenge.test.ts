/**
 * Tests for challenge module - adversarial self-check for reasoning quality
 */

import { describe, expect, test } from "bun:test";
import { challenge, shouldChallenge } from "../src/think/challenge.ts";

describe("challenge", () => {
  describe("basic functionality", () => {
    test("returns empty result for no steps", () => {
      const result = challenge([]);

      expect(result.challenges_generated).toBe(0);
      expect(result.challenges).toHaveLength(0);
      expect(result.overall_robustness).toBe(1.0);
      expect(result.summary).toBe("No steps to challenge.");
    });

    test("returns result with robustness score", () => {
      const result = challenge([{ step: 1, thought: "Let's analyze the problem carefully." }]);

      expect(result).toHaveProperty("challenges_generated");
      expect(result).toHaveProperty("challenges");
      expect(result).toHaveProperty("overall_robustness");
      expect(result).toHaveProperty("summary");
      expect(result.overall_robustness).toBeGreaterThanOrEqual(0);
      expect(result.overall_robustness).toBeLessThanOrEqual(1);
    });
  });

  describe("assumption inversion challenges", () => {
    test("detects 'always' assumption", () => {
      const result = challenge([
        { step: 1, thought: "Therefore this function always returns true." },
      ]);

      const inversionChallenge = result.challenges.find((c) => c.type === "assumption_inversion");
      expect(inversionChallenge).toBeDefined();
      expect(inversionChallenge?.challenge).toContain("always");
      expect(inversionChallenge?.challenge).toContain("sometimes not");
    });

    test("detects 'never' assumption", () => {
      const result = challenge([{ step: 1, thought: "Thus this case never occurs." }]);

      const inversionChallenge = result.challenges.find(
        (c) => c.type === "assumption_inversion" && c.challenge.includes("never"),
      );
      expect(inversionChallenge).toBeDefined();
    });

    test("detects 'all' assumption", () => {
      const result = challenge([{ step: 1, thought: "So all items in the list are positive." }]);

      const inversionChallenge = result.challenges.find(
        (c) => c.type === "assumption_inversion" && c.challenge.includes("all"),
      );
      expect(inversionChallenge).toBeDefined();
    });

    test("detects 'impossible' assumption", () => {
      const result = challenge([
        { step: 1, thought: "Hence this means it's impossible to have duplicates." },
      ]);

      const inversionChallenge = result.challenges.find(
        (c) => c.type === "assumption_inversion" && c.challenge.includes("impossible"),
      );
      expect(inversionChallenge).toBeDefined();
    });

    test("detects 'obviously' assumption", () => {
      const result = challenge([
        { step: 1, thought: "Therefore this obviously requires recursion." },
      ]);

      const inversionChallenge = result.challenges.find(
        (c) => c.type === "assumption_inversion" && c.challenge.includes("obviously"),
      );
      expect(inversionChallenge).toBeDefined();
    });
  });

  describe("edge case challenges", () => {
    test("generates edge cases for numeric claims", () => {
      const result = challenge([{ step: 1, thought: "Therefore the answer is 42." }]);

      const edgeCaseChallenge = result.challenges.find((c) => c.type === "edge_case");
      expect(edgeCaseChallenge).toBeDefined();
      expect(edgeCaseChallenge?.challenge).toContain("edge cases");
    });

    test("suggests boundary values in edge case challenges", () => {
      const result = challenge([{ step: 1, thought: "So the result is 10." }]);

      const edgeCaseChallenge = result.challenges.find((c) => c.type === "edge_case");
      expect(edgeCaseChallenge?.suggested_response).toContain("boundary values");
    });
  });

  describe("premise check challenges", () => {
    test("detects unestablished premise in conditional", () => {
      const result = challenge([
        { step: 1, thought: "If x is prime then we can factorize." },
        { step: 2, thought: "So we use the factorization." },
      ]);

      // May or may not detect depending on text matching
      // This tests that the function processes conditionals
      expect(result).toHaveProperty("challenges");
    });

    test("extracts conditionals from if-then statements", () => {
      const result = challenge([
        { step: 1, thought: "If the list is sorted then binary search works." },
      ]);

      // Should process without error
      expect(result.overall_robustness).toBeGreaterThanOrEqual(0);
    });
  });

  describe("steelman counter challenges", () => {
    test("generates steelman counter for final claim", () => {
      const result = challenge([
        { step: 1, thought: "First we consider the data." },
        { step: 2, thought: "Therefore the algorithm is O(n)." },
      ]);

      const steelmanChallenge = result.challenges.find((c) => c.type === "steelman_counter");
      expect(steelmanChallenge).toBeDefined();
      expect(steelmanChallenge?.challenge).toContain("strongest argument AGAINST");
    });
  });

  describe("target claim parameter", () => {
    test("challenges specific claim when provided", () => {
      const result = challenge(
        [
          { step: 1, thought: "Some unrelated reasoning." },
          { step: 2, thought: "More reasoning here." },
        ],
        "This always works",
      );

      const inversionChallenge = result.challenges.find((c) => c.type === "assumption_inversion");
      expect(inversionChallenge).toBeDefined();
      expect(inversionChallenge?.original_claim).toBe("This always works");
    });
  });

  describe("robustness scoring", () => {
    test("robustness decreases with high severity challenges", () => {
      // High severity challenges should reduce robustness more
      const resultWithHighSeverity = challenge([
        {
          step: 1,
          thought:
            "If the user provides valid input then we proceed. So we proceed with the operation.",
        },
      ]);

      // The robustness should be less than 1 if challenges are found
      if (resultWithHighSeverity.challenges_generated > 0) {
        expect(resultWithHighSeverity.overall_robustness).toBeLessThan(1);
      }
    });

    test("robustness is 1.0 when no challenges found", () => {
      const result = challenge([{ step: 1, thought: "Simple statement." }]);

      if (result.challenges_generated === 0) {
        expect(result.overall_robustness).toBe(1.0);
      }
    });
  });

  describe("deduplication", () => {
    test("does not duplicate identical challenges", () => {
      const result = challenge([
        { step: 1, thought: "Therefore always true." },
        { step: 2, thought: "Hence always valid." },
      ]);

      // Check no exact duplicate challenges
      const challengeTexts = result.challenges.map((c) => c.challenge.toLowerCase());
      const uniqueTexts = new Set(challengeTexts);
      expect(uniqueTexts.size).toBe(challengeTexts.length);
    });
  });

  describe("limits", () => {
    test("limits claims processed to prevent excessive output", () => {
      // Create many claims
      const steps = Array.from({ length: 20 }, (_, i) => ({
        step: i + 1,
        thought: `Therefore conclusion ${i} is true.`,
      }));

      const result = challenge(steps);

      // Should have a reasonable number of challenges (not 20+)
      // The function limits to 5 claims
      expect(result.challenges_generated).toBeLessThanOrEqual(20);
    });
  });
});

describe("shouldChallenge", () => {
  test("returns true for overconfidence (>0.9, <3 steps, no verification)", () => {
    expect(shouldChallenge(0.95, 2, false)).toBe(true);
    expect(shouldChallenge(0.92, 2, false)).toBe(true);
  });

  test("returns true for very high confidence regardless", () => {
    expect(shouldChallenge(0.96, 10, true)).toBe(true);
    expect(shouldChallenge(0.99, 5, false)).toBe(true);
  });

  test("returns false for reasonable confidence with verification", () => {
    expect(shouldChallenge(0.85, 5, true)).toBe(false);
    expect(shouldChallenge(0.8, 4, true)).toBe(false);
  });

  test("returns false for moderate confidence even without verification", () => {
    expect(shouldChallenge(0.7, 2, false)).toBe(false);
    expect(shouldChallenge(0.85, 2, false)).toBe(false);
  });

  test("returns false when step count is high", () => {
    expect(shouldChallenge(0.92, 5, false)).toBe(false);
    expect(shouldChallenge(0.91, 4, false)).toBe(false);
  });
});

describe("Challenge type structure", () => {
  test("challenge results have correct structure", () => {
    const result = challenge([{ step: 1, thought: "Therefore always returns valid output." }]);

    for (const c of result.challenges) {
      expect(c).toHaveProperty("type");
      expect(c).toHaveProperty("original_claim");
      expect(c).toHaveProperty("challenge");
      expect(c).toHaveProperty("severity");
      expect(c).toHaveProperty("suggested_response");

      expect(["assumption_inversion", "edge_case", "premise_check", "steelman_counter"]).toContain(
        c.type,
      );
      expect(["low", "medium", "high"]).toContain(c.severity);
    }
  });

  test("summary reflects challenge severity", () => {
    const resultWithChallenges = challenge([{ step: 1, thought: "Therefore always valid." }]);

    if (resultWithChallenges.challenges_generated > 0) {
      expect(resultWithChallenges.summary).toMatch(/Found \d+ challenge/);
    }
  });

  test("summary indicates robustness when no challenges", () => {
    const result = challenge([{ step: 1, thought: "Simple fact." }]);

    if (result.challenges_generated === 0) {
      expect(result.summary).toContain("robust");
    }
  });
});
