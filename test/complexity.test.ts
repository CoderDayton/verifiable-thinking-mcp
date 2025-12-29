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
    test("derive formula", () => {
      const result = assessPromptComplexity("Derive the formula for compound interest.");
      expect(result.tier).toBe("Moderate");
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
      expect(result.tier).toBe("High");
      expect(result.explanation.verb_type).toContain("counterintuitive");
      expect(result.explanation.domain_detected).toBe("probability_statistics");
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
      expect(result.explanation.domain_detected).toBe("probability_statistics");
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
      expect(result.explanation.domain_weight).toBe(0.85);
    });

    test("detects game_theory domain", () => {
      const result = assessPromptComplexity("Find the Nash equilibrium in the prisoner's dilemma");
      expect(result.explanation.domain_detected).toBe("game_theory");
      expect(result.explanation.domain_weight).toBe(0.9);
    });

    test("detects number_theory domain", () => {
      const result = assessPromptComplexity("How many trailing zeros are in 100 factorial?");
      expect(result.explanation.domain_detected).toBe("number_theory");
      expect(result.explanation.domain_weight).toBe(0.8);
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
