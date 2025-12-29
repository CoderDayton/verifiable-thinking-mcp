/**
 * Tests for Semantic Complexity Router v3
 * Verifies compositional scoring: verb × domain × intensity
 */

import { describe, expect, test } from "bun:test";
import {
  assessPromptComplexity,
  getTrivialPrompt,
  isTrivialQuestion,
} from "../src/lib/think/complexity";

describe("assessPromptComplexity", () => {
  describe("Low complexity (simple questions)", () => {
    test("simple arithmetic", () => {
      const result = assessPromptComplexity("What is 5 + 3?");
      expect(result.tier).toBe("Low");
      expect(result.score).toBeLessThan(0.3);
    });

    test("simple yes/no logic", () => {
      const result = assessPromptComplexity(
        "If it rains, the ground is wet. The ground is dry. Did it rain?",
      );
      expect(result.tier).toBe("Low");
    });

    test("basic factual question", () => {
      const result = assessPromptComplexity("What is the capital of France?");
      expect(result.tier).toBe("Low");
    });

    test("explain why simple topic is Moderate (causal reasoning)", () => {
      const result = assessPromptComplexity("Explain why the sky is blue");
      expect(result.tier).toBe("Moderate");
      expect(result.score).toBeGreaterThanOrEqual(0.3);
      expect(result.score).toBeLessThan(0.5);
    });
  });

  describe("Moderate complexity", () => {
    test("derive simple formula", () => {
      // "Derive" (0.8 verb) × "general" domain (0.5) = 0.4 (Moderate)
      const result = assessPromptComplexity("Derive the formula for the area of a triangle.");
      expect(result.tier).toBe("Moderate");
    });

    test("derive financial formula is High due to domain", () => {
      // "Derive" (0.8) × "financial" (0.65) = 0.52 (High)
      const result = assessPromptComplexity("Derive the formula for compound interest.");
      expect(result.tier).toBe("High");
      expect(result.explanation.domain_detected).toBe("financial");
    });

    test("why does with domain", () => {
      const result = assessPromptComplexity("Why does TCP use a three-way handshake?");
      expect(result.tier).toBe("Moderate");
      expect(result.explanation.domain_detected).toBe("networking");
    });

    test("explain how with calculus", () => {
      const result = assessPromptComplexity("Explain how to find the derivative of x^2");
      expect(result.tier).toBe("Moderate");
      expect(result.explanation.domain_detected).toBe("calculus");
    });
  });

  describe("High complexity", () => {
    test("proof requirement", () => {
      const result = assessPromptComplexity(
        "Prove that the sum of angles in a triangle is 180 degrees.",
      );
      expect(["High", "Moderate"]).toContain(result.tier);
      expect(result.explanation.verb_type).toContain("prove");
    });

    test("design algorithm", () => {
      const result = assessPromptComplexity("Design an algorithm to sort a list.");
      expect(result.tier).toBe("High");
      expect(result.explanation.verb_type).toBe("design");
      expect(result.explanation.domain_detected).toBe("algorithms");
    });

    test("counterintuitive explanation triggers High", () => {
      const result = assessPromptComplexity(
        "Explain why the Monty Hall problem has a counterintuitive solution",
      );
      expect(result.tier).toBe("Very Hard");
      expect(result.explanation.verb_type).toContain("counterintuitive");
      expect(result.explanation.domain_detected).toBe("paradox");
    });

    test("why can't with complexity domain", () => {
      const result = assessPromptComplexity("Why can't you solve the halting problem?");
      expect(result.tier).toBe("High");
      expect(result.explanation.domain_detected).toBe("complexity_theory");
    });

    test("explain why with domain terms triggers High", () => {
      const result = assessPromptComplexity(
        "Explain why no online algorithm can beat 2-competitive for ski rental",
      );
      expect(["High", "Very Hard"]).toContain(result.tier);
      expect(result.explanation.domain_detected).toBe("competitive_analysis");
    });
  });

  describe("Very Hard / Almost Impossible complexity", () => {
    test("consensus algorithm proof", () => {
      const result = assessPromptComplexity(
        "Prove that no two-process consensus algorithm can tolerate one crash failure.",
      );
      expect(["Almost Impossible", "Very Hard"]).toContain(result.tier);
      expect(result.explanation.domain_detected).toBe("distributed_systems");
    });

    test("P vs NP proof", () => {
      const result = assessPromptComplexity("Prove that P ≠ NP rigorously.");
      expect(["Almost Impossible", "Very Hard"]).toContain(result.tier);
      expect(result.score).toBeGreaterThanOrEqual(0.72);
    });

    test("lock-free queue impossibility", () => {
      const result = assessPromptComplexity(
        "Prove that no lock-free queue algorithm can achieve both linearizability and wait-freedom.",
      );
      expect(["Almost Impossible", "Very Hard"]).toContain(result.tier);
    });

    test("cryptographic security reduction", () => {
      const result = assessPromptComplexity(
        "Construct a security reduction from discrete logarithm problem to this protocol.",
      );
      expect(["Very Hard", "High"]).toContain(result.tier);
      expect(result.explanation.domain_detected).toBe("cryptography");
    });
  });

  describe("Semantic boosters", () => {
    test("counterintuitive boosts explain verb", () => {
      const base = assessPromptComplexity("Explain probability");
      const boosted = assessPromptComplexity("Explain this counterintuitive probability result");
      expect(boosted.explanation.verb_score).toBeGreaterThan(base.explanation.verb_score);
      expect(boosted.explanation.verb_type).toContain("[counterintuitive]");
    });

    test("meta-cognitive pattern boosts score", () => {
      const meta = assessPromptComplexity("Why do people systematically fail at this reasoning?");
      expect(meta.explanation.verb_type).toContain("[meta-cognitive]");
    });

    test("paradox keyword boosts", () => {
      const result = assessPromptComplexity("Explain Simpson's paradox");
      expect(result.explanation.verb_type).toContain("[counterintuitive]");
    });
  });

  describe("Intensity modifiers", () => {
    test("quantifier adds intensity", () => {
      const result = assessPromptComplexity("Prove that all prime numbers satisfy this property");
      expect(result.explanation.intensity_signals).toContain("quantifier");
      expect(result.explanation.intensity_modifier).toBeGreaterThan(1.0);
    });

    test("impossibility adds intensity", () => {
      const result = assessPromptComplexity(
        "Prove that no algorithm can solve this in polynomial time",
      );
      expect(result.explanation.intensity_signals).toContain("impossibility");
    });

    test("comparative adds intensity", () => {
      const result = assessPromptComplexity("Is there an algorithm faster than FFT?");
      expect(result.explanation.intensity_signals).toContain("comparative");
    });
  });

  describe("Negation correction", () => {
    test("'not difficult' reduces score", () => {
      const hard = assessPromptComplexity("Explain this difficult concept");
      const easy = assessPromptComplexity("Explain this not difficult concept");
      expect(easy.score).toBeLessThan(hard.score);
      expect(easy.explanation.verb_type).toContain("[simplified]");
    });

    test("'briefly' reduces score", () => {
      const full = assessPromptComplexity("Explain quantum computing");
      const brief = assessPromptComplexity("Briefly explain quantum computing");
      expect(brief.score).toBeLessThan(full.score);
    });
  });

  describe("Domain detection", () => {
    test("detects quantum domain", () => {
      const result = assessPromptComplexity("Explain Shor's algorithm for quantum factoring.");
      expect(result.explanation.domain_detected).toBe("quantum_computing");
    });

    test("detects probability domain with Monty Hall", () => {
      const result = assessPromptComplexity("Analyze the Monty Hall problem");
      expect(result.explanation.domain_detected).toBe("paradox");
    });

    test("detects ML domain", () => {
      const result = assessPromptComplexity("Derive the backpropagation equations");
      expect(result.explanation.domain_detected).toBe("machine_learning");
    });

    test("detects logic_puzzle domain", () => {
      const result = assessPromptComplexity(
        "On an island, every inhabitant is either a knight or a knave. Who is lying?",
      );
      expect(result.explanation.domain_detected).toBe("logic_puzzle");
      expect(result.explanation.domain_weight).toBe(0.92);
    });

    test("detects game_theory domain", () => {
      const result = assessPromptComplexity("Find the Nash equilibrium in the prisoner's dilemma");
      expect(result.explanation.domain_detected).toBe("game_theory");
      expect(result.explanation.domain_weight).toBe(0.9);
    });

    test("detects number_theory domain", () => {
      const result = assessPromptComplexity("How many trailing zeros are in 100 factorial?");
      expect(result.explanation.domain_detected).toBe("number_theory");
      expect(result.explanation.domain_weight).toBe(0.85);
    });
  });

  describe("Trap detection", () => {
    test("bat and ball classic trap", () => {
      const result = assessPromptComplexity(
        "A bat and ball cost $1.10 together. The bat costs $1 more than the ball. How much does the ball cost?",
      );
      expect(result.explanation.verb_type).toContain("[trap-detected]");
      expect(result.explanation.intensity_signals).toContain("trap_pattern");
      expect(["Moderate", "High"]).toContain(result.tier);
    });

    test("factorial trailing zeros trap", () => {
      const result = assessPromptComplexity("How many trailing zeros does 100! have?");
      expect(result.explanation.verb_type).toContain("[trap-detected]");
      expect(["Moderate", "High"]).toContain(result.tier);
    });

    test("cost/price patterns trigger trap", () => {
      const result = assessPromptComplexity(
        "If a book costs $5 and you pay with $20, what is your change?",
      );
      expect(result.explanation.intensity_signals).toContain("trap_pattern");
    });

    test("simple arithmetic without trap patterns stays Low", () => {
      const result = assessPromptComplexity("What is 5 + 3?");
      expect(result.tier).toBe("Low");
      expect(result.explanation.verb_type).not.toContain("[trap-detected]");
    });

    test("100 prisoners problem triggers trap", () => {
      const result = assessPromptComplexity(
        "100 prisoners, 100 boxes with their numbers randomly placed. Each opens 50 boxes to find their number. With the loop-following strategy, what's the approximate survival probability (percentage)?",
      );
      expect(result.explanation.verb_type).toContain("[trap-detected]");
      expect(result.explanation.intensity_signals).toContain("trap_pattern");
      // Should be boosted to High or Very Hard due to counterintuitive nature
      expect(["High", "Very Hard", "Almost Impossible"]).toContain(result.tier);
    });

    test("Monty Hall problem triggers trap", () => {
      const result = assessPromptComplexity(
        "On a game show, you choose door 1 of 3. The host opens door 3 revealing a goat. Should you switch to door 2?",
      );
      expect(result.explanation.intensity_signals).toContain("trap_pattern");
    });
  });

  describe("Asymmetric default (safety net)", () => {
    test("intensity signal bumps Low to Moderate", () => {
      const result = assessPromptComplexity("Is this faster than the other one?");
      expect(result.explanation.intensity_signals).toContain("comparative");
      expect(result.tier).not.toBe("Low");
    });
  });
});

describe("isTrivialQuestion", () => {
  test("simple yes/no questions are trivial", () => {
    expect(isTrivialQuestion("Is the sky blue? yes")).toBe(true);
    expect(isTrivialQuestion("Is 5 greater than 3?")).toBe(true);
  });

  test("long questions are not trivial", () => {
    const longQuestion =
      "Explain in detail how the quantum mechanical principles affect the behavior of electrons in a semiconductor material, including band theory and doping mechanisms.";
    expect(isTrivialQuestion(longQuestion)).toBe(false);
  });

  test("complex questions are not trivial", () => {
    expect(isTrivialQuestion("Prove that P ≠ NP")).toBe(false);
  });
});

describe("getTrivialPrompt", () => {
  test("returns system and user prompts", () => {
    const { system, user } = getTrivialPrompt("Is the sky blue?");
    expect(system).toBeTruthy();
    expect(user).toBe("Is the sky blue?");
    expect(system).toContain("Answer");
  });
});

describe("Confidence calibration", () => {
  test("confidence is high when far from boundaries", () => {
    const result = assessPromptComplexity("What is 5 + 3?");
    expect(result.confidence.level).toBeGreaterThan(0.7);
    expect(result.confidence.inGrayZone).toBe(false);
  });

  test("confidence is lower near boundaries", () => {
    const result = assessPromptComplexity("Explain why this works");
    expect(result.confidence.boundaryDistance).toBeLessThan(0.15);
  });

  test("inGrayZone flag is correct", () => {
    const low = assessPromptComplexity("What is 2 + 2?");
    expect(low.confidence.inGrayZone).toBe(false);

    const high = assessPromptComplexity("Prove that P ≠ NP rigorously.");
    expect(high.confidence.inGrayZone).toBe(false);

    const mid = assessPromptComplexity("Explain why the sky is blue");
    expect(mid.confidence.inGrayZone).toBe(true);
  });
});

describe("Performance", () => {
  test("assessPromptComplexity runs under 0.1ms per call", () => {
    const questions = [
      "What is 5 + 3?",
      "Prove that P ≠ NP",
      "Design a lock-free queue algorithm",
      "Derive the backpropagation equations for RNN",
      "If it rains, ground is wet. Ground is dry. Did it rain?",
    ];

    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      for (const q of questions) {
        assessPromptComplexity(q);
      }
    }

    const elapsed = performance.now() - start;
    const avgPerCall = elapsed / (iterations * questions.length);

    expect(avgPerCall).toBeLessThan(0.1);
    console.log(`Average time per call: ${avgPerCall.toFixed(4)}ms`);
  });

  test("O(n) complexity: linear with input length", () => {
    const shortText = "What is 2 + 2?";
    const longText = shortText.repeat(100);

    const shortStart = performance.now();
    for (let i = 0; i < 1000; i++) assessPromptComplexity(shortText);
    const shortTime = performance.now() - shortStart;

    const longStart = performance.now();
    for (let i = 0; i < 1000; i++) assessPromptComplexity(longText);
    const longTime = performance.now() - longStart;

    const ratio = longTime / shortTime;
    expect(ratio).toBeLessThan(200);
    console.log(`Time ratio (100x input): ${ratio.toFixed(2)}x`);
  });
});

// =============================================================================
// ROUTING TESTS
// =============================================================================

import {
  buildSpotCheckPrompt,
  parseSpotCheckResponse,
  routeQuestion,
} from "../src/lib/think/route";

describe("routeQuestion", () => {
  describe("Path: trivial", () => {
    test("simple yes/no question routes to trivial", () => {
      const route = routeQuestion("Is 5 > 3?");
      expect(route.path).toBe("trivial");
      expect(route.steps).toBe(1);
      expect(route.hasVerification).toBe(false);
    });

    test("trivial prompt is minimal", () => {
      const route = routeQuestion("Is water wet?");
      expect(route.prompts.main.system).toContain("Answer directly");
      expect(route.prompts.spotCheck).toBeUndefined();
    });
  });

  describe("Path: direct (Low complexity)", () => {
    test("simple factual question routes to trivial or direct", () => {
      const route = routeQuestion("What is the capital of France?");
      expect(["trivial", "direct"]).toContain(route.path);
      expect(route.tier).toBe("Low");
      expect(route.steps).toBe(1);
      expect(route.hasVerification).toBe(false);
    });

    test("basic arithmetic routes to direct or trivial", () => {
      const route = routeQuestion("What is 2 + 2?");
      expect(["trivial", "direct"]).toContain(route.path);
      expect(route.hasVerification).toBe(false);
    });

    test("slightly longer Low question routes to direct", () => {
      const route = routeQuestion(
        "List the first five prime numbers and explain why they are prime.",
      );
      // This should be Low or Moderate, but not trivial
      expect(route.tier).not.toBe("Very Hard");
      expect(route.hasVerification).toBe(false);
    });
  });

  describe("Path: reasoning (Moderate/High complexity)", () => {
    test("moderate question routes to reasoning without verification", () => {
      const route = routeQuestion("Explain how photosynthesis works.");
      expect(route.path).toBe("reasoning");
      expect(route.tier).toBe("Moderate");
      expect(route.steps).toBe(1);
      expect(route.hasVerification).toBe(false);
    });

    test("High complexity routes to reasoning without verification", () => {
      // Force a High tier question
      const route = routeQuestion("Design an algorithm for sorting with O(n log n) complexity.");
      // Could be Moderate or High depending on domain detection
      expect(["reasoning"]).toContain(route.path);
      expect(route.hasVerification).toBe(false);
    });

    test("reasoning prompt includes step-by-step instruction", () => {
      const route = routeQuestion("Derive the quadratic formula step by step.");
      expect(route.prompts.main.user).toContain("step");
    });
  });

  describe("Path: reasoning+spot (Very Hard/Almost Impossible)", () => {
    test("Very Hard question routes to reasoning+spot", () => {
      const route = routeQuestion("Prove that the halting problem is undecidable.");
      expect(route.path).toBe("reasoning+spot");
      expect(["Very Hard", "Almost Impossible"]).toContain(route.tier);
      expect(route.steps).toBe(2);
      expect(route.hasVerification).toBe(true);
    });

    test("Almost Impossible question includes spot-check", () => {
      const route = routeQuestion("Prove P ≠ NP rigorously with a formal proof.");
      expect(route.hasVerification).toBe(true);
      expect(route.prompts.spotCheck).toBeDefined();
      expect(route.prompts.spotCheck?.userTemplate).toContain("CORRECT");
    });

    test("skipVerify=true forces reasoning path even for Very Hard", () => {
      const route = routeQuestion("Prove that the halting problem is undecidable.", true);
      expect(route.path).toBe("reasoning");
      expect(route.steps).toBe(1);
      expect(route.hasVerification).toBe(false);
    });
  });

  describe("Verbosity detection", () => {
    test("short simple question gets terse verbosity", () => {
      const route = routeQuestion("What is 5?");
      expect(route.verbosity).toBe("terse");
    });

    test("question with 'explain' gets verbose verbosity", () => {
      const route = routeQuestion("Explain why the sky is blue in detail.");
      expect(route.verbosity).toBe("verbose");
    });
  });
});

describe("buildSpotCheckPrompt", () => {
  test("replaces question placeholder", () => {
    const template = "Q: {{question}}\nAnswer: {{answer}}";
    const result = buildSpotCheckPrompt(template, {
      question: "What is 2+2?",
      proposedAnswer: "4",
    });
    expect(result).toBe("Q: What is 2+2?\nAnswer: 4");
  });

  test("handles complex questions with special chars", () => {
    const template = "Q: {{question}}\nProposed: {{answer}}";
    const result = buildSpotCheckPrompt(template, {
      question: 'Is "hello" == "hello"?',
      proposedAnswer: "true",
    });
    expect(result).toContain('Is "hello"');
  });
});

describe("parseSpotCheckResponse", () => {
  test("YES at start returns true", () => {
    expect(parseSpotCheckResponse("YES, the answer is correct.")).toBe(true);
    expect(parseSpotCheckResponse("Yes, that's right.")).toBe(true);
    expect(parseSpotCheckResponse("yes")).toBe(true);
  });

  test("NO at start returns false", () => {
    expect(parseSpotCheckResponse("NO, the answer should be 5.")).toBe(false);
    expect(parseSpotCheckResponse("No, incorrect.")).toBe(false);
    expect(parseSpotCheckResponse("no")).toBe(false);
  });

  test("handles whitespace", () => {
    expect(parseSpotCheckResponse("  YES  ")).toBe(true);
    expect(parseSpotCheckResponse("\nNO\n")).toBe(false);
  });

  test("YES not at start returns false", () => {
    expect(parseSpotCheckResponse("I think YES")).toBe(false);
    expect(parseSpotCheckResponse("The answer is YES")).toBe(false);
  });
});
