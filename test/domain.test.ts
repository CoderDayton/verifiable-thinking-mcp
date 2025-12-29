/**
 * Tests for unified domain detector
 */

import { describe, expect, test } from "bun:test";
import { SolverType } from "../src/lib/compute/classifier.ts";
import {
  detectDomainFull,
  detectMetaDomain,
  detectVerificationDomain,
  type GranularDomain,
  getDomainWeight,
  getRelevantSolvers,
  isSolverRelevant,
} from "../src/lib/domain.ts";

describe("detectDomainFull", () => {
  test("detects financial domain from system prompt", () => {
    const result = detectDomainFull("You are a financial advisor helping with investments");
    expect(result.domain).toBe("financial");
    expect(result.meta).toBe("financial");
    expect(result.verification).toBe("math");
    expect(result.weight).toBeGreaterThan(0.5);
  });

  test("detects financial domain from keywords", () => {
    const prompts = [
      "Calculate the compound interest on this loan",
      "What's the ROI on this investment?",
      "Compare savings account vs index fund",
      "Calculate mortgage payments",
    ];
    for (const prompt of prompts) {
      const result = detectDomainFull(prompt);
      expect(result.domain).toBe("financial");
      expect(result.meta).toBe("financial");
    }
  });

  test("detects coding domains", () => {
    const cases: Array<{ text: string; domain: GranularDomain }> = [
      { text: "Explain the time complexity of quicksort", domain: "algorithms" },
      { text: "What is NP-complete?", domain: "complexity_theory" },
      { text: "Implement Byzantine fault tolerance", domain: "distributed_systems" },
      { text: "How does RSA encryption work?", domain: "cryptography" },
    ];
    for (const { text, domain } of cases) {
      const result = detectDomainFull(text);
      expect(result.domain).toBe(domain);
      expect(result.meta).toBe("coding");
    }
  });

  test("detects scientific domains", () => {
    const cases: Array<{ text: string; domain: GranularDomain }> = [
      { text: "Find the derivative of x^2", domain: "calculus" },
      { text: "What is the probability of rolling 6?", domain: "probability_statistics" },
      { text: "Calculate the determinant of this matrix", domain: "linear_algebra" },
      { text: "How many ways to arrange MISSISSIPPI?", domain: "combinatorics" },
    ];
    for (const { text, domain } of cases) {
      const result = detectDomainFull(text);
      expect(result.domain).toBe(domain);
      expect(result.meta).toBe("scientific");
    }
  });

  test("detects educational/puzzle domains", () => {
    const cases: Array<{ text: string; domain: GranularDomain }> = [
      { text: "Explain the Monty Hall paradox", domain: "paradox" },
      { text: "Is this syllogism valid or invalid?", domain: "logic_puzzle" },
      { text: "The blue-eyed islanders problem", domain: "common_knowledge" },
    ];
    for (const { text, domain } of cases) {
      const result = detectDomainFull(text);
      expect(result.domain).toBe(domain);
      expect(result.meta).toBe("educational");
    }
  });

  test("detects teaching/tutoring domains", () => {
    const cases: Array<{ text: string; expected: GranularDomain }> = [
      { text: "You are a math tutor", expected: "teaching" },
      { text: "Help me with my homework", expected: "teaching" },
      { text: "Explain step by step", expected: "teaching" },
      { text: "You are a helpful teacher", expected: "teaching" },
      { text: "This is a practice problem", expected: "teaching" },
      { text: "Show your work on this exercise", expected: "teaching" },
    ];
    for (const { text, expected } of cases) {
      const result = detectDomainFull(text);
      expect(result.domain).toBe(expected);
      expect(result.meta).toBe("educational");
      // Teaching domain should get ALL_SOLVERS
      expect(result.relevantSolvers).toBeGreaterThan(1000); // ALL_SOLVERS is 2047
    }
  });

  test("falls back to general for unrecognized text", () => {
    const result = detectDomainFull("What is the weather like today?");
    expect(result.domain).toBe("general");
    expect(result.meta).toBe("general");
    expect(result.verification).toBe("general");
    expect(result.weight).toBe(0.5);
  });
});

describe("meta domain detection", () => {
  test("detectMetaDomain returns correct categories", () => {
    expect(detectMetaDomain("compound interest calculation")).toBe("financial");
    expect(detectMetaDomain("algorithm time complexity")).toBe("coding");
    expect(detectMetaDomain("integral of sin(x)")).toBe("scientific");
    expect(detectMetaDomain("monty hall paradox")).toBe("educational");
    expect(detectMetaDomain("hello world")).toBe("general");
  });
});

describe("verification domain detection", () => {
  test("detectVerificationDomain returns legacy domains", () => {
    expect(detectVerificationDomain("calculate the derivative")).toBe("math");
    expect(detectVerificationDomain("is this syllogism valid")).toBe("logic");
    expect(detectVerificationDomain("time complexity of quicksort")).toBe("code");
    expect(detectVerificationDomain("what's the weather")).toBe("general");
  });
});

describe("solver relevance", () => {
  test("financial domain includes interest/percentage solvers", () => {
    const solvers = getRelevantSolvers("Calculate compound interest");
    expect(solvers & SolverType.ARITHMETIC).toBeTruthy();
    expect(solvers & SolverType.FORMULA_TIER1).toBeTruthy(); // percentage
    expect(solvers & SolverType.FORMULA_TIER4).toBeTruthy(); // interest
    expect(solvers & SolverType.WORD_PROBLEM).toBeTruthy();
    // Should NOT include calculus for financial
    expect(solvers & SolverType.CALCULUS).toBeFalsy();
  });

  test("coding domain includes modulo/power solvers", () => {
    const solvers = getRelevantSolvers("What's the time complexity?");
    expect(solvers & SolverType.ARITHMETIC).toBeTruthy();
    expect(solvers & SolverType.FORMULA_TIER1).toBeTruthy(); // modulo
    expect(solvers & SolverType.FORMULA_TIER2).toBeTruthy(); // power
    expect(solvers & SolverType.FORMULA_TIER3).toBeTruthy(); // log
    // Should NOT include calculus for coding
    expect(solvers & SolverType.CALCULUS).toBeFalsy();
  });

  test("calculus domain includes relevant math solvers", () => {
    const solvers = getRelevantSolvers("Find the integral of x^2");
    expect(solvers & SolverType.ARITHMETIC).toBeTruthy();
    expect(solvers & SolverType.CALCULUS).toBeTruthy();
    expect(solvers & SolverType.FORMULA_TIER1).toBeTruthy();
    expect(solvers & SolverType.FORMULA_TIER2).toBeTruthy();
  });

  test("educational domain includes all solvers", () => {
    const solvers = getRelevantSolvers("Explain the Monty Hall paradox");
    expect(solvers & SolverType.ARITHMETIC).toBeTruthy();
    expect(solvers & SolverType.LOGIC).toBeTruthy();
    expect(solvers & SolverType.PROBABILITY).toBeTruthy();
    expect(solvers & SolverType.CALCULUS).toBeTruthy();
  });

  test("general domain has basic math only", () => {
    const solvers = getRelevantSolvers("What is 2+2?");
    expect(solvers & SolverType.ARITHMETIC).toBeTruthy();
    expect(solvers & SolverType.FORMULA_TIER1).toBeTruthy();
    expect(solvers & SolverType.FORMULA_TIER2).toBeTruthy();
    // Should NOT include advanced solvers
    expect(solvers & SolverType.CALCULUS).toBeFalsy();
    expect(solvers & SolverType.MULTI_STEP).toBeFalsy();
  });

  test("isSolverRelevant helper works correctly", () => {
    const financialText = "Calculate compound interest";
    expect(isSolverRelevant(financialText, SolverType.ARITHMETIC)).toBe(true);
    expect(isSolverRelevant(financialText, SolverType.FORMULA_TIER4)).toBe(true);
    expect(isSolverRelevant(financialText, SolverType.CALCULUS)).toBe(false);

    const mathText = "Find the derivative";
    expect(isSolverRelevant(mathText, SolverType.CALCULUS)).toBe(true);
  });
});

describe("getDomainWeight", () => {
  test("returns correct weights for complexity routing", () => {
    // High complexity domains
    expect(getDomainWeight("quantum superposition").weight).toBeGreaterThanOrEqual(0.9);
    expect(getDomainWeight("RSA cryptography").weight).toBeGreaterThanOrEqual(0.9);

    // Medium-high complexity
    expect(getDomainWeight("calculate the derivative").weight).toBeGreaterThanOrEqual(0.7);

    // Lower complexity
    expect(getDomainWeight("hello world").weight).toBe(0.5);
  });
});

describe("performance", () => {
  test("O(n) detection is fast", () => {
    const text = "Calculate the compound interest on a $10,000 investment at 5% APR";
    const iterations = 10000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      detectDomainFull(text);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    // Should be sub-millisecond
    expect(avgMs).toBeLessThan(0.1);
    console.log(`Average domain detection time: ${avgMs.toFixed(4)}ms`);
  });
});
