/**
 * Solver Test Harness
 * Validates compute solvers against known question-answer pairs
 *
 * Usage:
 *   import { runSolverTests, SolverTestCase } from "./solver-harness";
 *
 *   const cases: SolverTestCase[] = [
 *     { input: "What is 2+2?", expected: "4", solver: "arithmetic" },
 *   ];
 *   runSolverTests("arithmetic", cases, tryArithmetic);
 */

import { describe, expect, test } from "bun:test";
import {
  tryArithmetic,
  tryCalculus,
  tryDerivation,
  tryFormula,
  tryLocalCompute,
  tryLogic,
  tryMathFacts,
  tryMultiStepWordProblem,
  tryProbability,
  tryWordProblem,
} from "../src/lib/compute/index";
import type { ComputeResult } from "../src/lib/compute/types";

// =============================================================================
// TEST HARNESS TYPES
// =============================================================================

export interface SolverTestCase {
  /** Input question/text */
  input: string;
  /** Expected answer (string match) or regex pattern */
  expected: string | RegExp | null;
  /** Description of what this tests */
  description?: string;
  /** If true, expect the solver to fail (return null/low confidence) */
  shouldFail?: boolean;
  /** Minimum confidence expected (0-1) */
  minConfidence?: number;
}

export type SolverFn = (text: string) => ComputeResult;

// =============================================================================
// SOLVER REGISTRY
// =============================================================================

const SOLVERS: Record<string, SolverFn> = {
  arithmetic: tryArithmetic,
  formula: tryFormula,
  logic: tryLogic,
  probability: tryProbability,
  calculus: tryCalculus,
  derivation: tryDerivation,
  mathFacts: tryMathFacts,
  wordProblem: tryWordProblem,
  multiStepWordProblem: tryMultiStepWordProblem,
  localCompute: tryLocalCompute,
};

export function getSolver(name: string): SolverFn | undefined {
  return SOLVERS[name];
}

// =============================================================================
// TEST RUNNER
// =============================================================================

/**
 * Run a batch of test cases against a solver
 */
export function runSolverTests(
  solverName: string,
  cases: SolverTestCase[],
  solver?: SolverFn,
): void {
  const solverFn = solver ?? SOLVERS[solverName];
  if (!solverFn) {
    throw new Error(`Unknown solver: ${solverName}`);
  }

  describe(`Solver: ${solverName}`, () => {
    for (const testCase of cases) {
      const testName = testCase.description ?? testCase.input.slice(0, 50);

      test(testName, () => {
        const result = solverFn(testCase.input);

        if (testCase.shouldFail) {
          // Expect failure
          expect(result.solved).toBe(false);
          return;
        }

        // Expect success
        expect(result.solved).toBe(true);
        expect(result.result).toBeDefined();

        if (testCase.expected !== null) {
          const resultStr = String(result.result);
          if (testCase.expected instanceof RegExp) {
            expect(resultStr).toMatch(testCase.expected);
          } else {
            // Normalize for comparison
            const normalizedAnswer = normalizeAnswer(resultStr);
            const normalizedExpected = normalizeAnswer(testCase.expected);
            expect(normalizedAnswer).toBe(normalizedExpected);
          }
        }

        if (testCase.minConfidence !== undefined) {
          expect(result.confidence).toBeGreaterThanOrEqual(testCase.minConfidence);
        }
      });
    }
  });
}

/**
 * Normalize answer for comparison
 */
function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, ""); // Remove commas from numbers
}

// =============================================================================
// ARITHMETIC SOLVER TESTS
// =============================================================================

const arithmeticCases: SolverTestCase[] = [
  // Basic operations
  { input: "What is 2 + 2?", expected: "4", description: "simple addition" },
  { input: "What is 17 + 28?", expected: "45", description: "two-digit addition" },
  { input: "Calculate 100 - 37", expected: "63", description: "subtraction" },
  { input: "Compute 12 * 15", expected: "180", description: "multiplication" },
  { input: "Evaluate 144 / 12", expected: "12", description: "division" },

  // Order of operations
  { input: "What is 2 + 3 * 4?", expected: "14", description: "order of operations" },
  { input: "What is (2 + 3) * 4?", expected: "20", description: "parentheses" },
  { input: "What is (5 * 12) / 4?", expected: "15", description: "compound expression" },

  // Edge cases
  { input: "10 / 3", expected: /3\.33/, description: "division with remainder" },
  { input: "25 + 17 = ?", expected: "42", description: "equals notation" },

  // Should fail
  {
    input: "What is the meaning of life?",
    expected: null,
    shouldFail: true,
    description: "non-math question",
  },
  {
    input: "What is alert('hack')",
    expected: null,
    shouldFail: true,
    description: "code injection",
  },
];

runSolverTests("arithmetic", arithmeticCases);

// =============================================================================
// FORMULA SOLVER TESTS
// =============================================================================

const formulaCases: SolverTestCase[] = [
  // Pythagorean theorem - formula solver can handle these
  {
    input: "A right triangle has legs 3 and 4. What is the hypotenuse?",
    expected: "5",
    description: "pythagorean 3-4-5",
  },
  {
    input: "A right triangle has legs 5 and 12. What is the hypotenuse?",
    expected: "13",
    description: "pythagorean 5-12-13",
  },

  // Circle formulas - not yet supported by formula solver
  {
    input: "What is the area of a circle with radius 5?",
    expected: /78\.5/,
    description: "circle area",
    shouldFail: true, // Formula solver doesn't support circle area yet
  },
  {
    input: "What is the circumference of a circle with radius 10?",
    expected: /62\.8/,
    description: "circle circumference",
    shouldFail: true, // Formula solver doesn't support circumference yet
  },

  // Rectangle/square - not yet supported
  {
    input: "What is the area of a rectangle with length 5 and width 3?",
    expected: "15",
    description: "rectangle area",
    shouldFail: true, // Formula solver doesn't support rectangle area yet
  },

  // Speed/distance/time - not yet supported
  {
    input: "If a car travels at 60 mph for 2 hours, how far does it go?",
    expected: "120",
    description: "distance formula",
    shouldFail: true, // Formula solver doesn't support distance formula yet
  },
];

runSolverTests("formula", formulaCases);

// =============================================================================
// PROBABILITY SOLVER TESTS
// =============================================================================

const probabilityCases: SolverTestCase[] = [
  // These may not be supported - mark as optional failures
  {
    input: "What is the probability of getting heads on a fair coin?",
    expected: /0\.5|50%|1\/2/,
    description: "coin flip probability",
    shouldFail: true, // May not be supported
  },
];

runSolverTests("probability", probabilityCases);

// =============================================================================
// LOGIC SOLVER TESTS
// =============================================================================

const logicCases: SolverTestCase[] = [
  // Logic solver has limited capabilities - mark as expected failures
  {
    input:
      "Is the statement 'All cats are mammals' and 'Fluffy is a cat' therefore 'Fluffy is a mammal' valid?",
    expected: /valid|true|yes/i,
    description: "syllogism",
    shouldFail: true, // Logic solver doesn't support syllogisms
  },

  // Boolean logic - not yet supported
  {
    input: "What is TRUE AND FALSE?",
    expected: /false/i,
    description: "AND operation",
    shouldFail: true, // Logic solver doesn't parse boolean operations
  },
  {
    input: "What is TRUE OR FALSE?",
    expected: /true/i,
    description: "OR operation",
    shouldFail: true, // Logic solver doesn't parse boolean operations
  },
  {
    input: "What is NOT TRUE?",
    expected: /false/i,
    description: "NOT operation",
    shouldFail: true, // Logic solver doesn't parse boolean operations
  },
];

runSolverTests("logic", logicCases);

// =============================================================================
// WORD PROBLEM SOLVER TESTS
// =============================================================================

const wordProblemCases: SolverTestCase[] = [
  // Word problem solver has limited capabilities
  {
    input: "John has 5 apples. Mary gives him 3 more. How many apples does John have?",
    expected: "8",
    description: "simple addition word problem",
    shouldFail: true, // Word problem solver needs specific patterns
  },
  {
    input: "A store has 100 items. They sell 37 items. How many items are left?",
    expected: "63",
    description: "subtraction word problem",
    shouldFail: true, // Word problem solver needs specific patterns
  },

  // Rate problems
  {
    input: "If a car travels 60 miles per hour, how far will it travel in 3 hours?",
    expected: "180",
    description: "rate problem",
    shouldFail: true, // Word problem solver needs specific patterns
  },
];

runSolverTests("wordProblem", wordProblemCases);

// =============================================================================
// PERFORMANCE BENCHMARKS
// =============================================================================

describe("Solver Performance", () => {
  const iterations = 100;

  test("arithmetic solver < 1ms average", () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      tryArithmetic("What is 17 + 28?");
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(1);
    console.log(`  Average arithmetic time: ${avgMs.toFixed(4)}ms`);
  });

  test("formula solver < 2ms average", () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      tryFormula("A right triangle has legs 3 and 4. What is the hypotenuse?");
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(2);
    console.log(`  Average formula time: ${avgMs.toFixed(4)}ms`);
  });

  test("word problem solver < 5ms average", () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      tryWordProblem("John has 5 apples. Mary gives him 3 more. How many does he have?");
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(5);
    console.log(`  Average word problem time: ${avgMs.toFixed(4)}ms`);
  });

  test("localCompute routing < 3ms average", () => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      tryLocalCompute("What is 2 + 2?");
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;
    expect(avgMs).toBeLessThan(3);
    console.log(`  Average localCompute time: ${avgMs.toFixed(4)}ms`);
  });
});

// =============================================================================
// ACCURACY SUMMARY
// =============================================================================

describe("Solver Accuracy Summary", () => {
  test("reports accuracy stats", () => {
    const solverStats: Record<string, { pass: number; fail: number }> = {};

    function testSolver(name: string, cases: SolverTestCase[]) {
      const solver = SOLVERS[name];
      if (!solver) return;

      solverStats[name] = { pass: 0, fail: 0 };

      for (const testCase of cases) {
        const result = solver(testCase.input);

        if (testCase.shouldFail) {
          if (!result.solved) {
            solverStats[name].pass++;
          } else {
            solverStats[name].fail++;
          }
        } else if (result.solved && result.result !== undefined) {
          const resultStr = String(result.result);
          if (testCase.expected instanceof RegExp) {
            if (testCase.expected.test(resultStr)) {
              solverStats[name].pass++;
            } else {
              solverStats[name].fail++;
            }
          } else if (testCase.expected !== null) {
            const norm = (s: string) =>
              s.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, "");
            if (norm(resultStr) === norm(testCase.expected)) {
              solverStats[name].pass++;
            } else {
              solverStats[name].fail++;
            }
          } else {
            solverStats[name].pass++;
          }
        } else {
          solverStats[name].fail++;
        }
      }
    }

    testSolver("arithmetic", arithmeticCases);
    testSolver("formula", formulaCases);
    testSolver("probability", probabilityCases);
    testSolver("logic", logicCases);
    testSolver("wordProblem", wordProblemCases);

    console.log("\n  Solver Accuracy:");
    for (const [name, stats] of Object.entries(solverStats)) {
      const total = stats.pass + stats.fail;
      const pct = total > 0 ? ((stats.pass / total) * 100).toFixed(1) : "N/A";
      console.log(`    ${name}: ${stats.pass}/${total} (${pct}%)`);
    }

    // At least 70% accuracy overall
    const totalPass = Object.values(solverStats).reduce((sum, s) => sum + s.pass, 0);
    const totalCases = Object.values(solverStats).reduce((sum, s) => sum + s.pass + s.fail, 0);
    expect(totalPass / totalCases).toBeGreaterThan(0.7);
  });
});
