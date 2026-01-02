/**
 * Unit tests for LocalCompute engine
 * Tests: Arithmetic, Formula, Word Problems, Multi-step, Cache, Calculus,
 * Combinatorics, Matrix, Finance, Logic, Statistics, Probability, Classifier, Registry
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  classifyQuestion,
  describeMask,
  SolverGroup,
  SolverType,
  shouldTrySolver,
} from "../src/lib/compute/classifier";
import {
  clearCache,
  computeAndReplace,
  computeConfidence,
  extractAndCompute,
  getCacheStats,
  isLikelyComputable,
  tryArithmetic,
  tryFormula,
  tryLocalCompute,
  tryLogic,
  tryMultiStepWordProblem,
  tryProbability,
  tryWordProblem,
} from "../src/lib/compute/index";
import { getRegistryStats, getSolvers, getSolversForMask } from "../src/lib/compute/registry";
import { tryStatistics } from "../src/lib/compute/solvers/statistics";

describe("LocalCompute - tryArithmetic", () => {
  test("basic addition: 17 + 28", () => {
    const result = tryArithmetic("What is 17 + 28?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(45);
    expect(result.method).toBe("arithmetic");
    expect(result.confidence).toBe(1.0);
    expect(result.time_ms).toBeLessThan(10);
  });

  test("basic subtraction: 100 - 37", () => {
    const result = tryArithmetic("Calculate 100 - 37");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(63);
  });

  test("multiplication: 12 * 15", () => {
    const result = tryArithmetic("Compute 12 * 15");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(180);
  });

  test("division: 144 / 12", () => {
    const result = tryArithmetic("Evaluate 144 / 12");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(12);
  });

  test("complex expression: (5 * 12) / 4", () => {
    const result = tryArithmetic("What is (5 * 12) / 4?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(15);
  });

  test("decimal result: 10 / 3", () => {
    const result = tryArithmetic("10 / 3");
    expect(result.solved).toBe(true);
    expect(result.result).toBeCloseTo(3.3333333333, 5);
  });

  test("raw expression: 2 + 3 * 4", () => {
    const result = tryArithmetic("2 + 3 * 4");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(14); // Respects operator precedence
  });

  test("expression with = ?: 25 + 17 = ?", () => {
    const result = tryArithmetic("25 + 17 = ?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(42);
  });

  test("rejects unsafe characters", () => {
    const result = tryArithmetic("What is alert('hack')");
    expect(result.solved).toBe(false);
  });

  test("rejects empty parentheses", () => {
    const result = tryArithmetic("What is () + 5");
    expect(result.solved).toBe(false);
  });

  test("rejects non-numeric text", () => {
    const result = tryArithmetic("What is the meaning of life?");
    expect(result.solved).toBe(false);
  });
});

describe("LocalCompute - tryFormula", () => {
  describe("Pythagorean Theorem", () => {
    test("legs 5 and 12, hypotenuse", () => {
      const result = tryFormula("A right triangle has legs 5 and 12. What is the hypotenuse?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(13);
      expect(result.method).toBe("pythagorean");
    });

    test("sides 3 and 4, hypotenuse", () => {
      const result = tryFormula("Triangle with sides 3 and 4, find hypotenuse");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(5);
    });

    test("legs 8 and 15, hypotenuse", () => {
      const result = tryFormula("Right triangle legs 8 and 15. Hypotenuse?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });
  });

  describe("Quadratic Formula", () => {
    test("x² - 5x + 6 = 0, larger root", () => {
      const result = tryFormula("Solve x² - 5x + 6 = 0. What is the larger root?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(3);
      expect(result.method).toBe("quadratic_larger");
    });

    test("x² - 5x + 6 = 0, smaller root", () => {
      const result = tryFormula("Solve x² - 5x + 6 = 0. What is the smaller root?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("quadratic_smaller");
    });

    test("x² + 3x - 4 = 0, both roots", () => {
      const result = tryFormula("Solve x² + 3x - 4 = 0");
      expect(result.solved).toBe(true);
      expect(result.method).toBe("quadratic");
      // Roots: 1 and -4
    });

    test("x² - 4x + 4 = 0, double root", () => {
      const result = tryFormula("Solve x² - 4x + 4 = 0");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2); // Double root
    });
  });

  describe("Fibonacci", () => {
    test("8th Fibonacci number", () => {
      const result = tryFormula("What is the 8th Fibonacci number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(21);
      expect(result.method).toBe("fibonacci");
    });

    test("1st Fibonacci number", () => {
      const result = tryFormula("What is the 1st Fibonacci number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
    });

    test("10th Fibonacci number", () => {
      const result = tryFormula("10th Fibonacci number");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(55);
    });

    test("rejects n > 100", () => {
      const result = tryFormula("What is the 150th Fibonacci number?");
      expect(result.solved).toBe(false);
    });
  });

  describe("Factorial", () => {
    test("5!", () => {
      const result = tryFormula("What is 5!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(120);
      expect(result.method).toBe("factorial");
    });

    test("factorial of 6", () => {
      const result = tryFormula("Calculate the factorial of 6");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(720);
    });

    test("0!", () => {
      const result = tryFormula("What is 0!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
    });

    test("10!", () => {
      const result = tryFormula("10!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(3628800);
    });
  });

  describe("Logarithms", () => {
    test("log₁₀(100)", () => {
      const result = tryFormula("What is log₁₀(100)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("logarithm_base10");
    });

    test("log₁₀(100) + log₁₀(1000)", () => {
      const result = tryFormula("log₁₀(100) + log₁₀(1000)");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(5);
    });

    test("ln(e) approximation", () => {
      const result = tryFormula("What is ln(2.718281828)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBeCloseTo(1, 3);
      expect(result.method).toBe("natural_log");
    });
  });

  describe("Square Root", () => {
    test("√144", () => {
      const result = tryFormula("√144");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
      expect(result.method).toBe("square_root");
    });

    test("sqrt(81)", () => {
      const result = tryFormula("What is sqrt(81)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9);
    });

    test("square root of 2", () => {
      const result = tryFormula("Calculate the square root of 2");
      expect(result.solved).toBe(true);
      expect(result.result).toBeCloseTo(Math.SQRT2, 4);
    });
  });

  describe("Powers", () => {
    test("2^10", () => {
      const result = tryFormula("What is 2^10?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1024);
      expect(result.method).toBe("power");
    });

    test("3**4", () => {
      const result = tryFormula("Calculate 3**4");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(81);
    });

    test("5 to the power of 3", () => {
      const result = tryFormula("What is 5 to the power of 3?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(125);
    });
  });

  describe("Percentages", () => {
    test("15% of 200", () => {
      const result = tryFormula("What is 15% of 200?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(30);
      expect(result.method).toBe("percentage");
    });

    test("25% of 80", () => {
      const result = tryFormula("25% of 80");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("7.5% of 1000", () => {
      const result = tryFormula("Calculate 7.5% of 1000");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(75);
    });
  });

  describe("Modulo", () => {
    test("17 mod 5", () => {
      const result = tryFormula("What is 17 mod 5?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("modulo");
    });

    test("100 modulo 7", () => {
      const result = tryFormula("100 modulo 7");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
    });

    test("remainder of 23 divided by 4", () => {
      const result = tryFormula("What is the remainder of 23 divided by 4?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(3);
    });
  });

  describe("GCD and LCM", () => {
    test("GCD of 12 and 18", () => {
      const result = tryFormula("What is the GCD of 12 and 18?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6);
      expect(result.method).toBe("gcd");
    });

    test("greatest common divisor of 48 and 36", () => {
      const result = tryFormula("Find the greatest common divisor of 48 and 36");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
    });

    test("LCM of 4 and 6", () => {
      const result = tryFormula("What is the LCM of 4 and 6?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
      expect(result.method).toBe("lcm");
    });

    test("least common multiple of 15 and 20", () => {
      const result = tryFormula("Find the least common multiple of 15 and 20");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(60);
    });
  });

  describe("Primality", () => {
    test("is 91 prime - NO (7 * 13)", () => {
      const result = tryFormula("Is 91 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("primality");
    });

    test("is 97 prime - YES", () => {
      const result = tryFormula("Is 97 a prime number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("is 2 prime - YES", () => {
      const result = tryFormula("Is 2 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("is 1 prime - NO", () => {
      const result = tryFormula("Is 1 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
    });

    test("is 104729 prime - YES (10000th prime)", () => {
      const result = tryFormula("Is 104729 prime?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("rejects numbers > 1M", () => {
      const result = tryFormula("Is 1000001 prime?");
      expect(result.solved).toBe(false);
    });
  });

  describe("Trailing zeros in factorial", () => {
    test("trailing zeros in 100!", () => {
      const result = tryFormula("How many trailing zeros in 100!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(24);
      expect(result.method).toBe("trailing_zeros");
    });

    test("trailing zeros in 25 factorial", () => {
      const result = tryFormula("trailing zeros in 25 factorial");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6);
    });

    test("trailing zeros in 5!", () => {
      const result = tryFormula("trailing zeros 5!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
    });

    test("trailing zeros in 1000!", () => {
      const result = tryFormula("trailing zeros in 1000!");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(249);
    });
  });

  describe("Geometric series sum", () => {
    test("1 + 1/2 + 1/4 + ... sum", () => {
      const result = tryFormula("What is 1 + 1/2 + 1/4 + ... infinite sum?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(2);
      expect(result.method).toBe("geometric_series");
    });

    test("sum 1 + 1/3 + 1/9 + ...", () => {
      const result = tryFormula("sum of 1 + 1/3 + 1/9 + ...");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1.5);
    });
  });

  describe("Last digit of power", () => {
    test("7^100 mod 10", () => {
      const result = tryFormula("What is 7^100 mod 10?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("last_digit");
    });

    test("last digit of 3^50", () => {
      const result = tryFormula("What is the last digit of 3^50?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9);
    });

    test("2^10 mod 10", () => {
      const result = tryFormula("2^10 mod 10");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(4);
    });

    test("last digit of 9^99", () => {
      const result = tryFormula("last digit of 9^99");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9); // 9^odd = 9
    });
  });
});

describe("LocalCompute - tryLocalCompute", () => {
  test("routes arithmetic correctly", () => {
    const result = tryLocalCompute("What is 25 + 37?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(62);
    expect(result.method).toBe("arithmetic");
  });

  test("routes formula correctly", () => {
    const result = tryLocalCompute("What is the 6th Fibonacci number?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(8);
    expect(result.method).toBe("fibonacci");
  });

  test("returns unsolved for non-computable", () => {
    const result = tryLocalCompute("What is the capital of France?");
    expect(result.solved).toBe(false);
  });
});

describe("LocalCompute - isLikelyComputable", () => {
  test("positive: what is + number", () => {
    expect(isLikelyComputable("What is 5 + 3?")).toBe(true);
  });

  test("positive: calculate", () => {
    expect(isLikelyComputable("Calculate the sum")).toBe(true);
  });

  test("positive: fibonacci", () => {
    expect(isLikelyComputable("10th Fibonacci number")).toBe(true);
  });

  test("positive: factorial", () => {
    expect(isLikelyComputable("factorial of 5")).toBe(true);
  });

  test("positive: sqrt", () => {
    expect(isLikelyComputable("sqrt(16)")).toBe(true);
  });

  test("positive: power", () => {
    expect(isLikelyComputable("2 to the power of 8")).toBe(true);
  });

  test("positive: percent", () => {
    expect(isLikelyComputable("20% of 50")).toBe(true);
  });

  test("positive: gcd", () => {
    expect(isLikelyComputable("GCD of 12 and 8")).toBe(true);
  });

  test("positive: is N prime", () => {
    expect(isLikelyComputable("Is 91 prime?")).toBe(true);
  });

  test("negative: prove", () => {
    expect(isLikelyComputable("Prove that 2 + 2 = 4")).toBe(false);
  });

  test("negative: why", () => {
    expect(isLikelyComputable("Why is 5 + 3 = 8?")).toBe(false);
  });

  test("negative: explain", () => {
    expect(isLikelyComputable("Explain how to calculate this")).toBe(false);
  });

  test("negative: compare", () => {
    expect(isLikelyComputable("Compare algorithm A and B")).toBe(false);
  });

  test("negative: no compute signals", () => {
    expect(isLikelyComputable("Tell me about machine learning")).toBe(false);
  });

  test("positive: word problems", () => {
    expect(isLikelyComputable("What is twice 50?")).toBe(true);
    expect(isLikelyComputable("Half of 100")).toBe(true);
    expect(isLikelyComputable("Sum of 5 and 10")).toBe(true);
    expect(isLikelyComputable("5 plus 3")).toBe(true);
    expect(isLikelyComputable("10 minus 4")).toBe(true);
    expect(isLikelyComputable("Average of 10, 20, 30")).toBe(true);
  });

  test("positive: trailing zeros", () => {
    expect(isLikelyComputable("How many trailing zeros in 100!")).toBe(true);
  });

  test("positive: infinite/geometric series", () => {
    expect(isLikelyComputable("1 + 1/2 + 1/4 infinite sum")).toBe(true);
    expect(isLikelyComputable("geometric series 1 + 1/3 + ...")).toBe(true);
  });

  test("positive: last digit", () => {
    expect(isLikelyComputable("What is the last digit of 7^100?")).toBe(true);
  });
});

describe("LocalCompute - tryWordProblem", () => {
  describe("Multiplication words", () => {
    test("twice 50", () => {
      const result = tryWordProblem("What is twice 50?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(100);
      expect(result.method).toBe("word_twice");
    });

    test("twice as many as 25", () => {
      const result = tryWordProblem("She has twice as many as 25 apples");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
    });

    test("5 times 7", () => {
      const result = tryWordProblem("What is 5 times 7?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(35);
    });

    test("double of 30", () => {
      const result = tryWordProblem("Double of 30");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(60);
    });

    test("triple of 15", () => {
      const result = tryWordProblem("Triple of 15");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(45);
    });
  });

  describe("Division words", () => {
    test("half of 100", () => {
      const result = tryWordProblem("Half of 100");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
    });

    test("one third of 90", () => {
      const result = tryWordProblem("One third of 90");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(30);
    });

    test("quarter of 80", () => {
      const result = tryWordProblem("Quarter of 80");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("20 divided by 4", () => {
      const result = tryWordProblem("20 divided by 4");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(5);
    });
  });

  describe("Addition words", () => {
    test("sum of 15 and 25", () => {
      const result = tryWordProblem("Sum of 15 and 25");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(40);
    });

    test("10 plus 7", () => {
      const result = tryWordProblem("10 plus 7");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });

    test("5 added to 12", () => {
      const result = tryWordProblem("5 added to 12");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });

    test("total of 8 and 9", () => {
      const result = tryWordProblem("Total of 8 and 9");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(17);
    });

    test("5 more than 20", () => {
      const result = tryWordProblem("5 more than 20");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(25);
    });
  });

  describe("Subtraction words", () => {
    test("difference between 50 and 30", () => {
      const result = tryWordProblem("Difference between 50 and 30");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("20 minus 8", () => {
      const result = tryWordProblem("20 minus 8");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12);
    });

    test("5 less than 20 (reversed)", () => {
      const result = tryWordProblem("5 less than 20");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(15); // 20 - 5
    });

    test("subtract 7 from 25 (reversed)", () => {
      const result = tryWordProblem("Subtract 7 from 25");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(18); // 25 - 7
    });
  });

  describe("Other operations", () => {
    test("product of 6 and 7", () => {
      const result = tryWordProblem("Product of 6 and 7");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(42);
    });

    test("quotient of 100 and 5", () => {
      const result = tryWordProblem("Quotient of 100 and 5");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("5 squared", () => {
      const result = tryWordProblem("5 squared");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(25);
    });

    test("3 cubed", () => {
      const result = tryWordProblem("3 cubed");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(27);
    });

    test("average of 10, 20, 30", () => {
      const result = tryWordProblem("Average of 10, 20, 30");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
    });

    test("5 items at $10 each (rate calculation)", () => {
      const result = tryWordProblem("5 items at $10 each");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
      expect(result.method).toBe("word_rate");
    });

    test("12 things for 3 per item", () => {
      const result = tryWordProblem("12 things for 3 apiece");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(36);
    });
  });
});

describe("LocalCompute - extractAndCompute", () => {
  test("extracts single arithmetic expression", () => {
    const result = extractAndCompute("The answer is 5 + 3 in this case");
    expect(result.hasComputations).toBe(true);
    expect(result.computations.length).toBe(1);
    expect(result.computations[0].result).toBe(8);
    expect(result.augmented).toContain("[=8]");
  });

  test("extracts multiple arithmetic expressions", () => {
    const result = extractAndCompute("Calculate 10 + 5 and then 20 * 3");
    expect(result.computations.length).toBe(2);
    expect(result.augmented).toContain("[=15]");
    expect(result.augmented).toContain("[=60]");
  });

  test("extracts word problems", () => {
    const result = extractAndCompute("She has twice 50 apples");
    expect(result.hasComputations).toBe(true);
    expect(result.computations.some((c) => c.result === 100)).toBe(true);
  });

  test("handles mixed expressions", () => {
    const result = extractAndCompute("First 5 + 3 then half of 100");
    expect(result.computations.length).toBeGreaterThanOrEqual(2);
  });

  test("handles multiple word computations with proper injection", () => {
    const result = extractAndCompute("She has twice 50 and also half of 100 plus double 25");
    expect(result.hasComputations).toBe(true);
    expect(result.computations.length).toBe(3);
    // Check augmented text has all injections
    expect(result.augmented).toContain("[=100]");
    expect(result.augmented).toContain("[=50]");
  });

  test("returns empty for no computations", () => {
    const result = extractAndCompute("This is just text with no math");
    expect(result.hasComputations).toBe(false);
    expect(result.computations.length).toBe(0);
  });

  // New tests for formula extraction
  describe("formula extraction", () => {
    test("extracts sqrt expressions", () => {
      const result = extractAndCompute("The value sqrt(16) is important");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 4)).toBe(true);
      expect(result.augmented).toContain("[=4]");
    });

    test("extracts factorial expressions", () => {
      const result = extractAndCompute("Calculate 5! for the answer");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 120)).toBe(true);
      expect(result.augmented).toContain("[=120]");
    });

    test("extracts power expressions", () => {
      const result = extractAndCompute("We need 2^10 bytes");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 1024)).toBe(true);
      expect(result.augmented).toContain("[=1024]");
    });

    test("extracts percentage expressions", () => {
      const result = extractAndCompute("That's 15% of 200 dollars");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 30)).toBe(true);
      expect(result.augmented).toContain("[=30]");
    });

    test("extracts combinations", () => {
      const result = extractAndCompute("We have 5 choose 2 options");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 10)).toBe(true);
      expect(result.augmented).toContain("[=10]");
    });

    test("extracts multiple formulas in text", () => {
      const result = extractAndCompute("First sqrt(9) then 3! gives us the total");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.length).toBeGreaterThanOrEqual(2);
      expect(result.augmented).toContain("[=3]");
      expect(result.augmented).toContain("[=6]");
    });

    test("handles derivative at point", () => {
      const result = extractAndCompute("The derivative of x^2 at x=3 is needed");
      expect(result.hasComputations).toBe(true);
      expect(result.computations.some((c) => c.result === 6)).toBe(true);
    });
  });
});

describe("LocalCompute - tryLocalCompute with word problems", () => {
  test("solves word problem via tryLocalCompute", () => {
    const result = tryLocalCompute("What is twice 50?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(100);
  });

  test("prefers arithmetic over word problem", () => {
    // "5 + 3" should match arithmetic before word patterns
    const result = tryLocalCompute("What is 5 + 3?");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(8);
    expect(result.method).toBe("arithmetic");
  });
});

// =============================================================================
// S1: LRU CACHE TESTS
// =============================================================================

describe("LocalCompute - LRU Cache", () => {
  beforeEach(() => {
    clearCache();
  });

  test("caches repeated computations", () => {
    // First call - cache miss
    const result1 = tryLocalCompute("What is 17 + 28?");
    expect(result1.solved).toBe(true);
    expect(result1.result).toBe(45);

    const stats1 = getCacheStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.size).toBe(1);

    // Second call - cache hit (time_ms should be 0)
    const result2 = tryLocalCompute("What is 17 + 28?");
    expect(result2.solved).toBe(true);
    expect(result2.result).toBe(45);
    expect(result2.time_ms).toBe(0); // Cache hit is instant

    const stats2 = getCacheStats();
    expect(stats2.hits).toBe(1);
  });

  test("normalizes cache keys (case insensitive)", () => {
    clearCache();
    tryLocalCompute("What is 5 + 3?");
    tryLocalCompute("WHAT IS 5 + 3?");
    tryLocalCompute("what is 5 + 3?");

    const stats = getCacheStats();
    expect(stats.size).toBe(1); // All normalized to same key
    expect(stats.hits).toBe(2);
  });

  test("can bypass cache", () => {
    clearCache();
    tryLocalCompute("What is 10 + 20?", true); // Use cache
    tryLocalCompute("What is 10 + 20?", false); // Bypass cache

    const stats = getCacheStats();
    expect(stats.hits).toBe(0); // No hit because bypassed
  });

  test("calculates hit rate", () => {
    clearCache();
    tryLocalCompute("What is 1 + 1?");
    tryLocalCompute("What is 1 + 1?");
    tryLocalCompute("What is 2 + 2?");
    tryLocalCompute("What is 1 + 1?");

    const stats = getCacheStats();
    expect(stats.hitRate).toBeCloseTo(0.5); // 2 hits out of 4 calls
  });
});

// =============================================================================
// S2: MULTI-STEP WORD PROBLEM TESTS
// =============================================================================

describe("LocalCompute - tryMultiStepWordProblem", () => {
  test("solves simple dependency: twice as many", () => {
    const result = tryMultiStepWordProblem(
      "Mary has 5 apples. John has twice as many as Mary. How many does John have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(10);
    expect(result.method).toBe("multi_step_word");
  });

  test("solves half as many", () => {
    const result = tryMultiStepWordProblem(
      "Bob has 20 oranges. Alice has half as many as Bob. How many does Alice have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(10);
  });

  test("solves N more than", () => {
    const result = tryMultiStepWordProblem(
      "Tom has 15 books. Sarah has 7 more than Tom. How many does Sarah have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(22);
  });

  test("solves N less than", () => {
    const result = tryMultiStepWordProblem(
      "Mike has 30 coins. Lisa has 12 fewer than Mike. How many does Lisa have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(18);
  });

  test("solves triple", () => {
    const result = tryMultiStepWordProblem(
      "Sam has 8 stickers. Emma has triple as many as Sam. How many does Emma have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(24);
  });

  test("solves chain dependencies", () => {
    const result = tryMultiStepWordProblem(
      "Alice has 10 candies. Bob has twice as many as Alice. Carol has 5 more than Bob. How many does Carol have?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(25); // 10 * 2 + 5
  });

  test("solves total questions", () => {
    const result = tryMultiStepWordProblem(
      "John has 5 apples. Mary has 8 oranges. What is the total?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(13);
    expect(result.method).toBe("multi_step_total");
  });

  test("returns unsolved for unresolvable dependencies", () => {
    const result = tryMultiStepWordProblem(
      "John has twice as many as Mary. How many does John have?",
    );
    // Mary's value is unknown, so John can't be computed
    expect(result.solved).toBe(false);
  });

  test("handles various verb forms", () => {
    const result = tryMultiStepWordProblem(
      "Alex bought 12 toys. Ben earned 6 coins. What is the total?",
    );
    expect(result.solved).toBe(true);
    expect(result.result).toBe(18);
  });
});

// =============================================================================
// S3: CONFIDENCE SCORING TESTS
// =============================================================================

describe("LocalCompute - computeConfidence", () => {
  test("high confidence for pure arithmetic", () => {
    const conf = computeConfidence("17 + 28");
    expect(conf.score).toBeGreaterThan(0.9);
    expect(conf.recommendation).toBe("local_only");
    expect(conf.signals.positive).toContain("pure_arithmetic");
  });

  test("high confidence for explicit what is + arithmetic", () => {
    const conf = computeConfidence("What is 5 + 3?");
    expect(conf.score).toBeGreaterThan(0.85);
    expect(conf.recommendation).toBe("local_only");
  });

  test("high confidence for factorial", () => {
    const conf = computeConfidence("What is 5!");
    expect(conf.score).toBeGreaterThan(0.8);
    expect(conf.signals.positive).toContain("factorial");
  });

  test("medium confidence for word problems", () => {
    const conf = computeConfidence("What is twice 50?");
    expect(conf.score).toBeGreaterThan(0.6);
    expect(conf.score).toBeLessThan(0.9);
    expect(conf.recommendation).toBe("try_local_first");
  });

  test("lower confidence for entity-based problems", () => {
    const conf = computeConfidence("John has twice as many as Mary. How many does John have?");
    expect(conf.score).toBeGreaterThan(0.3);
    expect(conf.score).toBeLessThan(0.7);
  });

  test("reduces confidence for reasoning signals", () => {
    const confBase = computeConfidence("What is 5 + 3?");
    const confWhy = computeConfidence("Why is 5 + 3 = 8?");

    expect(confWhy.score).toBeLessThan(confBase.score);
    expect(confWhy.signals.negative).toContain("why");
  });

  test("low confidence for prove questions", () => {
    const conf = computeConfidence("Prove that 2 + 2 = 4");
    expect(conf.score).toBeLessThan(0.3);
    expect(conf.recommendation).toBe("skip");
  });

  test("handles rationality questions as computable", () => {
    // Rationality questions are now handled by the math facts solver
    const conf = computeConfidence("Is sqrt(2) rational or irrational?");
    expect(conf.signals.positive).toContain("rationality");
    expect(conf.score).toBeGreaterThanOrEqual(0.85); // High confidence for known facts
  });

  test("provides signal breakdown", () => {
    const conf = computeConfidence("Calculate the factorial of 5");
    expect(conf.signals.positive.length).toBeGreaterThan(0);
    expect(Array.isArray(conf.signals.negative)).toBe(true);
  });

  test("low confidence for non-math (no strong compute signals)", () => {
    const conf = computeConfidence("What is the capital of France?");
    expect(conf.score).toBeLessThanOrEqual(0.3); // Only weak "what is" signal
    expect(conf.signals.positive).not.toContain("explicit_arithmetic");
    expect(conf.signals.positive).not.toContain("factorial");
  });
});

// =============================================================================
// S1: Tests for isLikelyComputable/tryLocalCompute interaction
// These prevent regressions where classification questions trigger computation
// =============================================================================

describe("LocalCompute - Classification vs Computation", () => {
  // Classification questions have different handling:
  // - Some (like rationality) ARE computable via math facts solver
  // - Some (like true/false reasoning) are NOT computable

  describe("Rationality questions (ARE computable via math facts solver)", () => {
    test("sqrt rationality is computable", () => {
      const q1 = "Is sqrt(2) rational or irrational? Answer RATIONAL or IRRATIONAL.";
      expect(isLikelyComputable(q1)).toBe(true);

      const result1 = tryLocalCompute(q1);
      expect(result1.solved).toBe(true);
      expect(result1.result).toBe("IRRATIONAL");
      expect(result1.method).toBe("math_fact_rationality");

      const q2 = "Is pi rational or irrational?";
      expect(isLikelyComputable(q2)).toBe(true);

      const result2 = tryLocalCompute(q2);
      expect(result2.solved).toBe(true);
      expect(result2.result).toBe("IRRATIONAL");

      // Perfect squares have rational roots
      const q3 = "Is sqrt(4) rational or irrational?";
      const result3 = tryLocalCompute(q3);
      expect(result3.solved).toBe(true);
      expect(result3.result).toBe("RATIONAL");
    });

    test("computeConfidence gives high score for rationality", () => {
      const conf = computeConfidence("Is sqrt(2) rational or irrational?");
      expect(conf.score).toBeGreaterThanOrEqual(0.85);
      expect(conf.signals.positive).toContain("rationality");
      expect(conf.recommendation).toBe("local_only");
    });
  });

  describe("True/false classification (NOT computable - requires reasoning)", () => {
    test("true or false classification", () => {
      const q1 = "True or false: sqrt(4) = 2";
      expect(isLikelyComputable(q1)).toBe(false);

      const q2 = "Is it true or false that 2^10 > 1000?";
      expect(isLikelyComputable(q2)).toBe(false);
    });
  });

  describe("Computation questions (SHOULD be computable)", () => {
    test("pure sqrt computation", () => {
      expect(isLikelyComputable("What is sqrt(16)?")).toBe(true);
      expect(isLikelyComputable("Calculate sqrt(144)")).toBe(true);

      const result = tryLocalCompute("What is sqrt(16)?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(4);
    });

    test("primality test (yes/no computation)", () => {
      // This IS computable because we can definitively answer YES/NO
      expect(isLikelyComputable("Is 91 prime? Answer YES or NO.")).toBe(true);

      const result = tryLocalCompute("Is 91 prime? Answer YES or NO.");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
    });

    test("arithmetic with sqrt", () => {
      expect(isLikelyComputable("What is sqrt(9) + sqrt(16)?")).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("sqrt rationality is now computable via math facts solver", () => {
      // Has sqrt AND rationality - now IS computable via math facts solver
      const q = "Is sqrt(2) rational or irrational";
      expect(isLikelyComputable(q)).toBe(true);

      const result = tryLocalCompute(q);
      expect(result.solved).toBe(true);
      expect(result.result).toBe("IRRATIONAL");
      expect(result.method).toBe("math_fact_rationality");
    });

    test("similar-looking questions have different answer types", () => {
      // These look similar but produce different answer types
      const compute = "What is sqrt(2)?";
      const classify = "Is sqrt(2) rational or irrational?";

      expect(isLikelyComputable(compute)).toBe(true);
      expect(isLikelyComputable(classify)).toBe(true); // Now also computable!

      // Compute question gets numeric answer
      const computeResult = tryLocalCompute(compute);
      expect(computeResult.solved).toBe(true);
      expect(typeof computeResult.result).toBe("number");

      // Classification question gets string answer
      const classifyResult = tryLocalCompute(classify);
      expect(classifyResult.solved).toBe(true);
      expect(classifyResult.result).toBe("IRRATIONAL");
    });

    test("fibonacci computation vs sequence questions", () => {
      // Computable: specific value
      expect(isLikelyComputable("What is the 10th Fibonacci number?")).toBe(true);

      const result = tryLocalCompute("What is the 10th Fibonacci number?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(55);
    });
  });

  describe("Confidence scoring for routing decisions", () => {
    test("high confidence for pure arithmetic", () => {
      const conf = computeConfidence("What is 17 + 28?");
      expect(conf.score).toBeGreaterThanOrEqual(0.85);
      expect(conf.recommendation).toBe("local_only");
    });

    test("medium confidence for word problems", () => {
      const conf = computeConfidence("What is twice 50?");
      expect(conf.score).toBeGreaterThanOrEqual(0.6);
      expect(["try_local_first", "local_only"]).toContain(conf.recommendation);
    });

    test("low confidence when reasoning signals present", () => {
      const conf = computeConfidence("Prove that sqrt(2) is irrational");
      expect(conf.score).toBeLessThan(0.3);
      expect(conf.recommendation).toBe("skip");
      expect(conf.signals.negative).toContain("prove");
    });

    test("negative signals reduce confidence", () => {
      const pureCompute = computeConfidence("sqrt(16)");
      const withWhy = computeConfidence("Why is sqrt(16) = 4?");

      expect(pureCompute.score).toBeGreaterThan(withWhy.score);
    });
  });
});

// =============================================================================
// S1: Tests for new Calculus and Combinatorics functions
// =============================================================================

describe("LocalCompute - Calculus", () => {
  describe("Derivatives", () => {
    test("derivative of x^3 at x=2", () => {
      const result = tryLocalCompute("derivative of x^3 at x=2");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(12); // d/dx(x^3) = 3x^2, at x=2: 3*4=12
      expect(result.method).toBe("derivative_eval");
    });

    test("d/dx of x^2 at x=3", () => {
      const result = tryLocalCompute("d/dx of x^2 at x=3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6); // 2x at x=3
    });

    test("derivative of 3x^2 + 2x - 5", () => {
      const result = tryLocalCompute("derivative of 3x^2 + 2x - 5");
      expect(result.solved).toBe(true);
      expect(result.method).toBe("derivative_symbolic");
      // Should return "6x + 2" or similar
      expect(String(result.result)).toMatch(/6.*x.*2/);
    });

    test("isLikelyComputable for derivative questions", () => {
      expect(isLikelyComputable("derivative of x^3 at x=2")).toBe(true);
      expect(isLikelyComputable("d/dx of x^2")).toBe(true);
      expect(isLikelyComputable("differentiate 3x^2")).toBe(true);
    });
  });

  describe("Definite Integrals", () => {
    test("integral of 2x from 0 to 3", () => {
      const result = tryLocalCompute("integral of 2x from 0 to 3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(9); // ∫2x dx from 0 to 3 = x^2 from 0 to 3 = 9-0=9
      expect(result.method).toBe("definite_integral");
    });

    test("integrate x^2 from 0 to 2", () => {
      const result = tryLocalCompute("integrate x^2 from 0 to 2");
      expect(result.solved).toBe(true);
      // ∫x^2 dx = x^3/3, from 0 to 2 = 8/3 - 0 = 2.666...
      expect(result.result).toBeCloseTo(8 / 3, 5);
    });

    test("integral of 3x^2 + 2x from 1 to 2", () => {
      const result = tryLocalCompute("integral of 3x^2 + 2x from 1 to 2");
      expect(result.solved).toBe(true);
      // ∫(3x^2 + 2x)dx = x^3 + x^2
      // F(2) = 8 + 4 = 12
      // F(1) = 1 + 1 = 2
      // Result = 12 - 2 = 10
      expect(result.result).toBe(10);
    });

    test("isLikelyComputable for integral questions", () => {
      expect(isLikelyComputable("integral of 2x from 0 to 3")).toBe(true);
      expect(isLikelyComputable("integrate x^2 from 1 to 4")).toBe(true);
    });
  });
});

describe("LocalCompute - Combinatorics", () => {
  describe("Combinations (n choose k)", () => {
    test("10 choose 3", () => {
      const result = tryLocalCompute("10 choose 3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(120);
      expect(result.method).toBe("combinations");
    });

    test("How many ways to choose 3 items from 10", () => {
      const result = tryLocalCompute("How many ways to choose 3 items from 10?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(120);
    });

    test("5 C 2", () => {
      const result = tryLocalCompute("5 C 2");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(10);
    });

    test("edge cases: n choose 0 and n choose n", () => {
      expect(tryLocalCompute("5 choose 0").result).toBe(1);
      expect(tryLocalCompute("5 choose 5").result).toBe(1);
    });
  });

  describe("Permutations (n P k)", () => {
    test("5 P 3", () => {
      const result = tryLocalCompute("5 P 3");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(60); // 5*4*3
      expect(result.method).toBe("permutations");
    });

    test("10 P 2", () => {
      const result = tryLocalCompute("10 P 2");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(90); // 10*9
    });
  });
});

describe("LocalCompute - Matrix and Finance", () => {
  describe("2x2 Matrix Determinant", () => {
    test("determinant of [[1,2],[3,4]]", () => {
      const result = tryLocalCompute("determinant of [[1,2],[3,4]]");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(-2); // 1*4 - 2*3 = -2
      expect(result.method).toBe("determinant_2x2");
    });

    test("det([[5,3],[2,4]])", () => {
      const result = tryLocalCompute("What is the det([[5,3],[2,4]])?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(14); // 5*4 - 3*2 = 14
    });
  });

  describe("3x3 Matrix Determinant", () => {
    test("determinant of [[1,2,3],[4,5,6],[7,8,9]]", () => {
      const result = tryLocalCompute("determinant of [[1,2,3],[4,5,6],[7,8,9]]");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(0); // Singular matrix
      expect(result.method).toBe("determinant_3x3");
    });

    test("det([[6,1,1],[4,-2,5],[2,8,7]])", () => {
      const result = tryLocalCompute("What is the determinant of [[6,1,1],[4,-2,5],[2,8,7]]?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(-306); // 6*(-14-40) - 1*(28-10) + 1*(32+4) = -306
      expect(result.method).toBe("determinant_3x3");
    });
  });

  describe("4x4 Matrix Determinant", () => {
    test("determinant of identity matrix 4x4", () => {
      const result = tryLocalCompute("determinant of [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("determinant_4x4");
    });
  });

  describe("Compound Interest", () => {
    test("$1000 at 5% compound interest for 10 years", () => {
      const result = tryLocalCompute("$1000 at 5% compound interest for 10 years");
      expect(result.solved).toBe(true);
      // 1000 * (1.05)^10 ≈ 1628.89
      expect(result.result).toBe(1629);
      expect(result.method).toBe("compound_interest");
    });

    test("$500 at 10% annual compound interest for 5 years", () => {
      const result = tryLocalCompute("$500 at 10% annual compound interest for 5 years");
      expect(result.solved).toBe(true);
      // 500 * (1.1)^5 ≈ 805.26
      expect(result.result).toBe(805);
    });
  });
});

describe("LocalCompute - Unicode superscripts", () => {
  test("derivative of x³ at x=2 (unicode)", () => {
    const result = tryLocalCompute("derivative of x³ at x=2");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(12); // 3x² at x=2 = 3*4 = 12
  });

  test("x² + 2x - 1 (unicode)", () => {
    const result = tryLocalCompute("derivative of x² + 2x - 1 at x=3");
    expect(result.solved).toBe(true);
    expect(result.result).toBe(8); // 2x + 2 at x=3 = 8
  });
});

describe("LocalCompute - Confidence for new patterns", () => {
  test("high confidence for derivatives", () => {
    const conf = computeConfidence("derivative of x^3 at x=2");
    expect(conf.score).toBeGreaterThanOrEqual(0.8);
    expect(conf.signals.positive).toContain("derivative");
  });

  test("high confidence for combinations", () => {
    const conf = computeConfidence("10 choose 3");
    expect(conf.score).toBeGreaterThanOrEqual(0.85);
    expect(conf.signals.positive).toContain("combinations");
  });

  test("high confidence for integrals", () => {
    const conf = computeConfidence("integral of 2x from 0 to 3");
    expect(conf.score).toBeGreaterThanOrEqual(0.8);
    expect(conf.signals.positive).toContain("definite_integral");
  });
});

// =============================================================================
// LOGIC SOLVER TESTS
// =============================================================================

describe("LocalCompute - Logic", () => {
  describe("Modus Ponens", () => {
    test("basic modus ponens - raining/wet", () => {
      const result = tryLogic(
        "If it rains, the ground is wet. It's raining. Is the ground wet? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("modus_ponens");
    });
  });

  describe("Modus Tollens", () => {
    test("basic modus tollens - ground dry", () => {
      const result = tryLogic(
        "If it rains, the ground is wet. Ground is dry. Is it raining? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("modus_tollens");
    });
  });

  describe("Syllogism", () => {
    test("valid syllogism - A/B/C", () => {
      const result = tryLogic("All A are B. All B are C. Therefore all A are C. Valid? YES or NO.");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("syllogism");
    });
  });

  describe("XOR Violation", () => {
    test("exclusive or with both - violated", () => {
      const result = tryLogic(
        "You can have cake or ice cream (exclusive). You have both. Violated? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("xor_violation");
    });
  });

  describe("tryLocalCompute integration", () => {
    test("modus ponens via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "If it rains, the ground is wet. It's raining. Is the ground wet? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });

    test("syllogism via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "All A are B. All B are C. Therefore all A are C. Valid? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
    });
  });

  describe("Affirming the Consequent (invalid)", () => {
    test("ground is wet therefore it rained - invalid", () => {
      const result = tryLogic(
        "If it rains, ground is wet. Ground is wet. Therefore it rained. Valid reasoning? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("affirming_consequent");
    });

    test("can we conclude pattern", () => {
      const result = tryLogic(
        "If it rains, the ground is wet. The ground is wet. Can we conclude it rained?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("affirming_consequent");
    });

    test("P then Q pattern", () => {
      const result = tryLogic("If P then Q. Q is true. Therefore P is true. Valid?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("affirming_consequent");
    });
  });

  describe("Denying the Antecedent (invalid)", () => {
    test("not raining therefore ground is dry - invalid", () => {
      const result = tryLogic(
        "If it rains, ground is wet. It's not raining. Therefore ground is dry. Valid? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("denying_antecedent");
    });
  });

  describe("De Morgan's Laws", () => {
    test("NOT(A AND B) = (NOT A) OR (NOT B)", () => {
      const result = tryLogic(
        "NOT(A AND B) is equivalent to (NOT A) ___ (NOT B). Fill: AND or OR.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("OR");
      expect(result.method).toBe("de_morgan_and");
    });

    test("NOT(A OR B) = (NOT A) AND (NOT B)", () => {
      const result = tryLogic("NOT(A OR B) is equivalent to (NOT A) ___ (NOT B). Fill: AND or OR.");
      expect(result.solved).toBe(true);
      expect(result.result).toBe("AND");
      expect(result.method).toBe("de_morgan_or");
    });
  });

  describe("Invalid Syllogism with Some", () => {
    test("some A are B, some B are C - invalid conclusion", () => {
      const result = tryLogic(
        "Some A are B. Some B are C. Therefore some A are C. Valid? YES or NO.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("NO");
      expect(result.method).toBe("invalid_syllogism_some");
    });
  });

  describe("Contrapositive", () => {
    test("All A are B equivalent to All non-B are non-A", () => {
      const result = tryLogic(
        '"All dogs are mammals" is equivalent to "All non-mammals are non-dogs"? YES or NO.',
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("YES");
      expect(result.method).toBe("contrapositive");
    });
  });
});

// =============================================================================
// STATISTICS SOLVER TESTS
// =============================================================================

describe("LocalCompute - Statistics", () => {
  describe("Mean / Average", () => {
    test("mean with currency notation ($30k, $1M)", () => {
      const result = tryStatistics(
        "Incomes: $30k, $30k, $30k, $30k, $1M. Mean income in thousands?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(224);
      expect(result.method).toBe("mean_thousands");
    });

    test("average of plain numbers", () => {
      const result = tryStatistics("What is the average of 10, 20, 30?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(20);
      expect(result.method).toBe("mean");
    });
  });

  describe("Standard Error", () => {
    test("SE = SD / sqrt(n)", () => {
      const result = tryStatistics("Sample mean 100, SD 10, n=100. Standard error of mean?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("standard_error");
    });

    test("standard deviation 20, sample size 400", () => {
      const result = tryStatistics(
        "Standard deviation 20, sample size 400. What is the standard error?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(1);
      expect(result.method).toBe("standard_error");
    });
  });

  describe("Expected Value", () => {
    test("lottery expected value in cents", () => {
      const result = tryStatistics(
        "Lottery: $1 ticket, 1/1000000 chance of $500000. Expected value per ticket in cents?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(50);
      expect(result.method).toBe("expected_value_cents");
    });

    test("lottery expected value in dollars", () => {
      const result = tryStatistics("1/1000 chance of $100. Expected value?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(0.1);
      expect(result.method).toBe("expected_value");
    });
  });

  describe("Permutations with Repetition", () => {
    test("MISSISSIPPI arrangements", () => {
      const result = tryStatistics("How many ways to arrange the letters in MISSISSIPPI?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(34650);
      expect(result.method).toBe("permutations_repetition");
    });

    test("AABB arrangements", () => {
      // 4! / (2! * 2!) = 24 / 4 = 6
      const result = tryStatistics("How many ways to arrange the letters in AABB?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(6);
      expect(result.method).toBe("permutations_repetition");
    });
  });

  describe("Handshake Problem", () => {
    test("10 people handshakes", () => {
      const result = tryStatistics(
        "10 people at a party, each shakes hands with everyone else exactly once. Total number of handshakes?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(45);
      expect(result.method).toBe("handshake");
    });

    test("5 people handshakes", () => {
      const result = tryStatistics("5 people each shakes hands with everyone else. Total?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(10);
      expect(result.method).toBe("handshake");
    });
  });

  describe("tryLocalCompute integration", () => {
    test("mean via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "Incomes: $30k, $30k, $30k, $30k, $1M. Mean income in thousands?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(224);
    });

    test("handshake via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "10 people at a party, each shakes hands with everyone else exactly once. Total number of handshakes?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe(45);
    });

    test("MISSISSIPPI via tryLocalCompute", () => {
      const result = tryLocalCompute("How many ways to arrange the letters in MISSISSIPPI?");
      expect(result.solved).toBe(true);
      expect(result.result).toBe(34650);
    });
  });
});

// =============================================================================
// PROBABILITY SOLVER TESTS
// =============================================================================

describe("LocalCompute - Probability", () => {
  describe("Fair Coin Independence", () => {
    test("fair coin after streak - percentage", () => {
      const result = tryProbability(
        "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
      // Method can be fair_coin_independence or fair_coin_direct depending on which pattern matches first
      expect(result.method).toMatch(/fair_coin/);
    });

    test("fair coin after streak - decimal", () => {
      const result = tryProbability(
        "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("0.5");
    });

    test("fair coin tails after heads", () => {
      const result = tryProbability(
        "A fair coin has come up heads 5 times. What's the chance the next flip is tails? Answer as a percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
    });
  });

  describe("Independent Events", () => {
    test("basketball shots independent with 50%", () => {
      const result = tryProbability(
        "A basketball player has made 5 shots in a row. Assuming shots are independent with 50% success rate, what's the probability they make the next shot? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
      // Method can be hot_hand_independence or independent_event depending on which pattern matches first
      expect(result.method).toMatch(/independent/);
    });

    test("independent events with stated probability", () => {
      const result = tryProbability(
        "Each trial is independent with 75% probability of success. What's the probability the next trial succeeds? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("75");
      expect(result.method).toBe("independent_event");
    });
  });

  describe("Birthday Paradox", () => {
    test("23 people - classic case (~50.7%)", () => {
      const result = tryProbability(
        "In a room of 23 people, what's the probability at least two share a birthday? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.method).toBe("birthday_paradox");
      // 23 people gives ~50.7%
      expect(result.result).toBe("51");
    });

    test("50 people - high probability (~97%)", () => {
      const result = tryProbability(
        "50 people in a room. Probability that at least two share a birthday?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("97");
    });

    test("70 people - very high probability (~99.9%)", () => {
      const result = tryProbability(
        "What's the probability that at least 2 of 70 students share a birthday?",
      );
      expect(result.solved).toBe(true);
      // Should be ~99.9%
      expect(parseInt(result.result as string, 10)).toBeGreaterThanOrEqual(99);
    });

    test("1 person - 0%", () => {
      const result = tryProbability(
        "In a room with 1 person, what's the probability at least two share a birthday?",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("0");
    });
  });

  describe("Non-matching questions", () => {
    test("conditional probability - not solvable", () => {
      const result = tryProbability(
        "Given sum is 9 when rolling two dice, what's the probability the first die is 6?",
      );
      expect(result.solved).toBe(false);
    });
  });

  describe("tryLocalCompute integration", () => {
    test("fair coin via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
    });

    test("independent events via tryLocalCompute", () => {
      const result = tryLocalCompute(
        "Shots are independent with 50% success rate. What's the probability of making the next shot? Answer as percentage.",
      );
      expect(result.solved).toBe(true);
      expect(result.result).toBe("50");
    });
  });

  describe("Classifier integration", () => {
    test("fair coin question classified as PROBABILITY", () => {
      const { mask } = classifyQuestion(
        "A fair coin has landed heads 10 times. What's the probability the next flip is heads?",
      );
      expect(mask & SolverType.PROBABILITY).toBeTruthy();
    });

    test("independent events classified as PROBABILITY", () => {
      const { mask } = classifyQuestion(
        "Shots are independent with 50% success. What's the probability of the next shot?",
      );
      expect(mask & SolverType.PROBABILITY).toBeTruthy();
    });

    test("streak probability classified as PROBABILITY", () => {
      const { mask } = classifyQuestion(
        "Made 5 shots in a row. What's the probability of the next shot?",
      );
      expect(mask & SolverType.PROBABILITY).toBeTruthy();
    });
  });
});

// =============================================================================
// CLASSIFIER TESTS
// =============================================================================

describe("LocalCompute - Classifier", () => {
  describe("classifyQuestion - arithmetic", () => {
    test("pure arithmetic expression", () => {
      const { mask } = classifyQuestion("5 + 3");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });

    test("multiplication", () => {
      const { mask } = classifyQuestion("12 * 7");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });

    test("complex expression", () => {
      const { mask } = classifyQuestion("(10 + 5) * 2 - 3");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });

    test("bare number falls back to arithmetic", () => {
      const { mask } = classifyQuestion("42");
      expect(mask & SolverType.ARITHMETIC).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier1", () => {
    test("percentage", () => {
      const { mask } = classifyQuestion("What is 25% of 80?");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("factorial with !", () => {
      const { mask } = classifyQuestion("5!");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("factorial word", () => {
      const { mask } = classifyQuestion("factorial of 6");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("modulo", () => {
      const { mask } = classifyQuestion("17 mod 5");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("remainder", () => {
      const { mask } = classifyQuestion("remainder of 17 divided by 5");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("prime", () => {
      const { mask } = classifyQuestion("Is 17 prime?");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });

    test("fibonacci", () => {
      const { mask } = classifyQuestion("10th fibonacci number");
      expect(mask & SolverType.FORMULA_TIER1).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier2", () => {
    test("sqrt", () => {
      const { mask } = classifyQuestion("sqrt(144)");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("square root word", () => {
      const { mask } = classifyQuestion("square root of 144");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("power with caret", () => {
      const { mask } = classifyQuestion("2^10");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("power word", () => {
      const { mask } = classifyQuestion("2 to the power of 10");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("gcd", () => {
      const { mask } = classifyQuestion("gcd(12, 18)");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("greatest common divisor", () => {
      const { mask } = classifyQuestion("greatest common divisor of 12 and 18");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });

    test("lcm", () => {
      const { mask } = classifyQuestion("lcm(4, 6)");
      expect(mask & SolverType.FORMULA_TIER2).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier3", () => {
    test("logarithm", () => {
      const { mask } = classifyQuestion("log base 2 of 8");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("natural log", () => {
      const { mask } = classifyQuestion("ln(e)");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("combinations - choose", () => {
      const { mask } = classifyQuestion("10 choose 3");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("combinations - C notation", () => {
      const { mask } = classifyQuestion("10 C 3");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("permutations - P notation", () => {
      const { mask } = classifyQuestion("10 P 3");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });

    test("last digit", () => {
      const { mask } = classifyQuestion("What is the last digit of 7^100?");
      expect(mask & SolverType.FORMULA_TIER3).toBeTruthy();
    });
  });

  describe("classifyQuestion - formula tier4", () => {
    test("hypotenuse", () => {
      const { mask } = classifyQuestion("hypotenuse of 3 and 4");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("trailing zeros", () => {
      const { mask } = classifyQuestion("trailing zeros in 100!");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("infinite series", () => {
      const { mask } = classifyQuestion("sum of infinite series 1 + 1/2 + 1/4 + ...");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("matrix determinant", () => {
      const { mask } = classifyQuestion("determinant of [[1,2],[3,4]]");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("compound interest", () => {
      const { mask } = classifyQuestion("$1000 at 5% interest for 10 years");
      expect(mask & SolverType.FORMULA_TIER4).toBeTruthy();
    });
  });

  describe("classifyQuestion - word problems", () => {
    test("twice", () => {
      const { mask } = classifyQuestion("twice 15");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("double", () => {
      const { mask } = classifyQuestion("double 25");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("half of", () => {
      const { mask } = classifyQuestion("half of 50");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("sum of", () => {
      const { mask } = classifyQuestion("sum of 10 and 20");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("product of", () => {
      const { mask } = classifyQuestion("product of 5 and 7");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });

    test("squared", () => {
      const { mask } = classifyQuestion("5 squared");
      expect(mask & SolverType.WORD_PROBLEM).toBeTruthy();
    });
  });

  describe("classifyQuestion - multi-step", () => {
    test("entity with twice", () => {
      const { mask } = classifyQuestion("Alice has 10 apples. Bob has twice as many.");
      expect(mask & SolverType.MULTI_STEP).toBeTruthy();
    });

    test("entity with more than", () => {
      const { mask } = classifyQuestion("Alice has 10. Bob has 5 more than Alice.");
      expect(mask & SolverType.MULTI_STEP).toBeTruthy();
    });

    test("how many does entity have", () => {
      const { mask } = classifyQuestion("How many does Bob have?");
      expect(mask & SolverType.MULTI_STEP).toBeTruthy();
    });
  });

  describe("classifyQuestion - calculus", () => {
    test("derivative", () => {
      const { mask } = classifyQuestion("derivative of x^3 at x=2");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("differentiate", () => {
      const { mask } = classifyQuestion("differentiate x^2 + 3x");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("d/dx notation", () => {
      const { mask } = classifyQuestion("d/dx of x^3");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("integral", () => {
      const { mask } = classifyQuestion("integral of 2x from 0 to 3");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });

    test("integrate", () => {
      const { mask } = classifyQuestion("integrate x^2");
      expect(mask & SolverType.CALCULUS).toBeTruthy();
    });
  });

  describe("classifyQuestion - logic", () => {
    test("modus ponens - if then with yes/no", () => {
      const { mask } = classifyQuestion(
        "If it rains, the ground is wet. It's raining. Is the ground wet? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });

    test("modus tollens - if then with negation", () => {
      const { mask } = classifyQuestion(
        "If it rains, the ground is wet. Ground is dry. Is it raining? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });

    test("syllogism - all A are B pattern", () => {
      const { mask } = classifyQuestion(
        "All A are B. All B are C. Therefore all A are C. Valid? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });

    test("XOR violation", () => {
      const { mask } = classifyQuestion(
        "You can have cake or ice cream (exclusive). You have both. Violated? YES or NO.",
      );
      expect(mask & SolverType.LOGIC).toBeTruthy();
    });
  });

  describe("classifyQuestion - precomputed values", () => {
    test("returns lowercase text", () => {
      const { lower } = classifyQuestion("What Is 5 + 3?");
      expect(lower).toBe("what is 5 + 3?");
    });

    test("detects digit presence", () => {
      const { chars } = classifyQuestion("5 + 3");
      expect(chars.hasDigit).toBe(true);
    });

    test("detects no digits", () => {
      const { chars } = classifyQuestion("hello world");
      expect(chars.hasDigit).toBe(false);
    });

    test("detects percent", () => {
      const { chars } = classifyQuestion("25% of 80");
      expect(chars.hasPercent).toBe(true);
    });

    test("detects caret", () => {
      const { chars } = classifyQuestion("2^10");
      expect(chars.hasCaret).toBe(true);
    });

    test("detects bracket", () => {
      const { chars } = classifyQuestion("[[1,2],[3,4]]");
      expect(chars.hasBracket).toBe(true);
    });

    test("detects dollar", () => {
      const { chars } = classifyQuestion("$1000");
      expect(chars.hasDollar).toBe(true);
    });

    test("detects exclamation", () => {
      const { chars } = classifyQuestion("5!");
      expect(chars.hasExclaim).toBe(true);
    });

    test("detects x variable", () => {
      const { chars } = classifyQuestion("x^2 + 3x");
      expect(chars.hasX).toBe(true);
    });
  });

  describe("classifyQuestion - no match", () => {
    test("pure text without numbers returns 0 mask", () => {
      const { mask } = classifyQuestion("hello world");
      expect(mask).toBe(0);
    });

    test("question without math keywords", () => {
      const { mask } = classifyQuestion("What is the capital of France?");
      expect(mask).toBe(0);
    });
  });

  describe("classifyQuestion - DERIVATION type", () => {
    test("prove keyword triggers DERIVATION", () => {
      const { mask } = classifyQuestion("prove that x + x = 2x");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("show that keyword triggers DERIVATION", () => {
      const { mask } = classifyQuestion("show that (a+b)² = a² + 2ab + b²");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("verify keyword triggers DERIVATION", () => {
      const { mask } = classifyQuestion("verify: x² - y² = (x+y)(x-y)");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("multiple equals signs trigger DERIVATION", () => {
      const { mask } = classifyQuestion("x + x = 2x = 2*x");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(true);
    });

    test("arrow symbols trigger DERIVATION", () => {
      expect(shouldTrySolver(classifyQuestion("a ⟹ b").mask, SolverType.DERIVATION)).toBe(true);
      expect(shouldTrySolver(classifyQuestion("x → y").mask, SolverType.DERIVATION)).toBe(true);
      expect(shouldTrySolver(classifyQuestion("p => q").mask, SolverType.DERIVATION)).toBe(true);
    });

    test("simple equation does not trigger DERIVATION", () => {
      const { mask } = classifyQuestion("what is 2 + 2");
      expect(shouldTrySolver(mask, SolverType.DERIVATION)).toBe(false);
    });
  });

  describe("shouldTrySolver", () => {
    test("returns true when type is in mask", () => {
      const mask = SolverType.ARITHMETIC | SolverType.FORMULA_TIER1;
      expect(shouldTrySolver(mask, SolverType.ARITHMETIC)).toBe(true);
      expect(shouldTrySolver(mask, SolverType.FORMULA_TIER1)).toBe(true);
    });

    test("returns false when type not in mask", () => {
      const mask = SolverType.ARITHMETIC;
      expect(shouldTrySolver(mask, SolverType.CALCULUS)).toBe(false);
    });
  });

  describe("describeMask", () => {
    test("single type", () => {
      expect(describeMask(SolverType.ARITHMETIC)).toEqual(["arithmetic"]);
    });

    test("multiple types", () => {
      const mask = SolverType.ARITHMETIC | SolverType.CALCULUS;
      const desc = describeMask(mask);
      expect(desc).toContain("arithmetic");
      expect(desc).toContain("calculus");
      expect(desc.length).toBe(2);
    });

    test("all formula tiers", () => {
      const desc = describeMask(SolverGroup.FORMULA_ALL);
      expect(desc).toContain("formula_tier1");
      expect(desc).toContain("formula_tier2");
      expect(desc).toContain("formula_tier3");
      expect(desc).toContain("formula_tier4");
    });

    test("empty mask", () => {
      expect(describeMask(0)).toEqual([]);
    });
  });

  describe("SolverGroup constants", () => {
    test("FORMULA_ALL includes all tiers", () => {
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER1).toBeTruthy();
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER2).toBeTruthy();
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER3).toBeTruthy();
      expect(SolverGroup.FORMULA_ALL & SolverType.FORMULA_TIER4).toBeTruthy();
    });

    test("WORD_ALL includes word and multi-step", () => {
      expect(SolverGroup.WORD_ALL & SolverType.WORD_PROBLEM).toBeTruthy();
      expect(SolverGroup.WORD_ALL & SolverType.MULTI_STEP).toBeTruthy();
    });

    test("ALL includes everything", () => {
      // 12 solver types: ARITHMETIC, CALCULUS, FORMULA (4 tiers), WORD_PROBLEM, MULTI_STEP, FACTS, LOGIC, PROBABILITY, DERIVATION
      expect(SolverGroup.ALL).toBe(0xfff);
    });
  });
});

// =============================================================================
// REGISTRY TESTS
// =============================================================================

describe("LocalCompute - Registry", () => {
  describe("getSolvers", () => {
    test("returns registered solvers", () => {
      const solvers = getSolvers();
      expect(solvers.length).toBeGreaterThan(0);
    });

    test("solvers are sorted by priority", () => {
      const solvers = getSolvers();
      for (let i = 1; i < solvers.length; i++) {
        expect(solvers[i].priority).toBeGreaterThanOrEqual(solvers[i - 1].priority);
      }
    });

    test("includes expected built-in solvers", () => {
      const solvers = getSolvers();
      const names = solvers.map((s) => s.name);
      expect(names).toContain("arithmetic");
      expect(names).toContain("formula");
      expect(names).toContain("word_problem");
      expect(names).toContain("multi_step_word");
      expect(names).toContain("calculus");
    });
  });

  describe("getSolversForMask", () => {
    test("returns only matching solvers for arithmetic", () => {
      const solvers = getSolversForMask(SolverType.ARITHMETIC);
      expect(solvers.length).toBeGreaterThan(0);
      expect(solvers.every((s) => (s.types & SolverType.ARITHMETIC) !== 0)).toBe(true);
    });

    test("returns formula solver for any formula tier", () => {
      const solvers = getSolversForMask(SolverType.FORMULA_TIER1);
      const names = solvers.map((s) => s.name);
      expect(names).toContain("formula");
    });

    test("returns calculus solver for calculus mask", () => {
      const solvers = getSolversForMask(SolverType.CALCULUS);
      const names = solvers.map((s) => s.name);
      expect(names).toContain("calculus");
    });

    test("returns empty array for mask 0", () => {
      const solvers = getSolversForMask(0);
      expect(solvers).toEqual([]);
    });

    test("returns multiple solvers for combined mask", () => {
      const solvers = getSolversForMask(SolverType.ARITHMETIC | SolverType.CALCULUS);
      const names = solvers.map((s) => s.name);
      expect(names).toContain("arithmetic");
      expect(names).toContain("calculus");
    });
  });

  describe("getRegistryStats", () => {
    test("returns count and byType", () => {
      const stats = getRegistryStats();
      expect(stats.count).toBeGreaterThan(0);
      expect(typeof stats.byType).toBe("object");
    });

    test("byType includes arithmetic", () => {
      const stats = getRegistryStats();
      expect(stats.byType.arithmetic).toBeGreaterThanOrEqual(1);
    });

    test("byType includes formula tiers", () => {
      const stats = getRegistryStats();
      // Formula solver covers all tiers
      expect(stats.byType.formula_tier1).toBeGreaterThanOrEqual(1);
      expect(stats.byType.formula_tier2).toBeGreaterThanOrEqual(1);
      expect(stats.byType.formula_tier3).toBeGreaterThanOrEqual(1);
      expect(stats.byType.formula_tier4).toBeGreaterThanOrEqual(1);
    });

    test("byType includes calculus", () => {
      const stats = getRegistryStats();
      expect(stats.byType.calculus).toBeGreaterThanOrEqual(1);
    });
  });
});

// =============================================================================
// CLASSIFIER PERFORMANCE TESTS
// =============================================================================

describe("LocalCompute - Classifier Performance", () => {
  test("classifyQuestion runs under 1ms", () => {
    const questions = [
      "5 + 3",
      "What is 25% of 80?",
      "derivative of x^3 at x=2",
      "Alice has 10 apples. Bob has twice as many.",
      "determinant of [[1,2],[3,4]]",
    ];

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      for (const q of questions) {
        classifyQuestion(q);
      }
    }

    const elapsed = performance.now() - start;
    const avgPerCall = elapsed / (iterations * questions.length);

    // Should be well under 0.1ms per call
    expect(avgPerCall).toBeLessThan(0.1);
  });
});

// =============================================================================
// PERFORMANCE REGRESSION TESTS
// =============================================================================

describe("LocalCompute - extractAndCompute Performance", () => {
  test("maintains O(n) complexity: μs/char < 0.5", () => {
    // Text with multiple formula types to stress-test the combined regex
    const baseText = "The sqrt(16) is 4 and 5! is 120. Calculate 2^10 bytes. ";

    // Test at multiple sizes to verify linear scaling
    const sizes = [500, 2000, 5000];
    const results: Array<{ size: number; usPerChar: number }> = [];

    for (const size of sizes) {
      const text = baseText.repeat(Math.ceil(size / baseText.length)).slice(0, size);

      // Warm-up run
      extractAndCompute(text);

      // Timed run (multiple iterations for stability)
      const iterations = 50;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        extractAndCompute(text);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;
      const usPerChar = (avgMs / text.length) * 1000;

      results.push({ size, usPerChar });
    }

    // Assert all sizes stay under 0.5 μs/char threshold
    for (const { usPerChar } of results) {
      expect(usPerChar).toBeLessThan(0.5);
    }

    // Assert linear scaling: largest size shouldn't be >2x slower per char than smallest
    const smallestUsPerChar = results[0]!.usPerChar;
    const largestUsPerChar = results[results.length - 1]!.usPerChar;
    const scalingRatio = largestUsPerChar / smallestUsPerChar;

    // Allow up to 3x variation (accounts for cache effects, GC, etc.)
    expect(scalingRatio).toBeLessThan(3);
  });

  test("computeAndReplace convenience function works", () => {
    const input = "Calculate sqrt(16) and 5!";
    const output = computeAndReplace(input);

    expect(output).toContain("[=4]");
    expect(output).toContain("[=120]");
    expect(typeof output).toBe("string");
  });
});
