/**
 * Domain-Aware Computation Filtering
 *
 * Filters computations based on domain relevance.
 * Financial context doesn't need calculus, coding context doesn't need probability.
 *
 * Architecture:
 * 1. Map computation methods → SolverType bitmask
 * 2. Get domain's relevant solvers from domain.ts
 * 3. Filter computations that match both
 */

import { detectMetaDomain, getRelevantSolvers, type MetaDomain } from "../domain.ts";
import { type SolverMask, SolverType } from "./classifier.ts";
import type { ExtractedComputation } from "./types.ts";

// =============================================================================
// METHOD → SOLVER TYPE MAPPING
// =============================================================================

/**
 * Maps computation method strings to their SolverType bitmask.
 * Methods returned by solvers are mapped to the solver type that produced them.
 */
const METHOD_TO_SOLVER: Record<string, SolverMask> = {
  // Arithmetic
  arithmetic: SolverType.ARITHMETIC,
  inline_arithmetic: SolverType.ARITHMETIC,

  // Formula Tier 1 (percentage, factorial, modulo, prime, fibonacci)
  percentage: SolverType.FORMULA_TIER1,
  factorial: SolverType.FORMULA_TIER1,
  modulo: SolverType.FORMULA_TIER1,
  prime: SolverType.FORMULA_TIER1,
  fibonacci: SolverType.FORMULA_TIER1,

  // Formula Tier 2 (sqrt, power, gcd, lcm)
  sqrt: SolverType.FORMULA_TIER2,
  power: SolverType.FORMULA_TIER2,
  gcd: SolverType.FORMULA_TIER2,
  lcm: SolverType.FORMULA_TIER2,

  // Formula Tier 3 (log, quadratic, combinations, permutations, last digit)
  logarithm_base10: SolverType.FORMULA_TIER3,
  natural_log: SolverType.FORMULA_TIER3,
  quadratic: SolverType.FORMULA_TIER3,
  quadratic_larger: SolverType.FORMULA_TIER3,
  quadratic_smaller: SolverType.FORMULA_TIER3,
  combinations: SolverType.FORMULA_TIER3,
  permutations: SolverType.FORMULA_TIER3,
  last_digit: SolverType.FORMULA_TIER3,

  // Formula Tier 4 (pythagorean, trailing zeros, series, matrix, interest)
  pythagorean: SolverType.FORMULA_TIER4,
  trailing_zeros: SolverType.FORMULA_TIER4,
  geometric_series: SolverType.FORMULA_TIER4,
  matrix_determinant: SolverType.FORMULA_TIER4,
  compound_interest: SolverType.FORMULA_TIER4,

  // Word problems
  word_twice: SolverType.WORD_PROBLEM,
  word_times: SolverType.WORD_PROBLEM,
  word_triple: SolverType.WORD_PROBLEM,
  word_double: SolverType.WORD_PROBLEM,
  word_half: SolverType.WORD_PROBLEM,
  word_third: SolverType.WORD_PROBLEM,
  word_quarter: SolverType.WORD_PROBLEM,
  word_divide: SolverType.WORD_PROBLEM,
  word_sum: SolverType.WORD_PROBLEM,
  word_plus: SolverType.WORD_PROBLEM,
  word_add: SolverType.WORD_PROBLEM,
  word_total: SolverType.WORD_PROBLEM,
  word_difference: SolverType.WORD_PROBLEM,
  word_minus: SolverType.WORD_PROBLEM,
  word_less_than: SolverType.WORD_PROBLEM,
  word_subtract: SolverType.WORD_PROBLEM,
  word_product: SolverType.WORD_PROBLEM,
  word_quotient: SolverType.WORD_PROBLEM,
  word_more_than: SolverType.WORD_PROBLEM,
  word_squared: SolverType.WORD_PROBLEM,
  word_cubed: SolverType.WORD_PROBLEM,
  word_rate: SolverType.WORD_PROBLEM,
  word_average: SolverType.WORD_PROBLEM,

  // CRT word problems
  crt_bat_ball: SolverType.WORD_PROBLEM,
  crt_lily_pad: SolverType.WORD_PROBLEM,
  crt_widget: SolverType.WORD_PROBLEM,
  crt_harmonic: SolverType.WORD_PROBLEM,
  crt_catchup: SolverType.WORD_PROBLEM,
  crt_pigeonhole: SolverType.WORD_PROBLEM,

  // Multi-step
  multi_step_word: SolverType.MULTI_STEP,
  multi_step_total: SolverType.MULTI_STEP,

  // Calculus
  derivative_eval: SolverType.CALCULUS,
  derivative_symbolic: SolverType.CALCULUS,
  definite_integral: SolverType.CALCULUS,
  numerical_integral: SolverType.CALCULUS,

  // Facts
  math_fact_rationality: SolverType.FACTS,
  math_fact_known_irrational: SolverType.FACTS,
  math_fact_integer: SolverType.FACTS,
  math_fact_fraction: SolverType.FACTS,

  // Logic
  modus_ponens: SolverType.LOGIC,
  modus_tollens: SolverType.LOGIC,
  syllogism: SolverType.LOGIC,
  xor_violation: SolverType.LOGIC,

  // Probability
  fair_coin_independence: SolverType.PROBABILITY,
  fair_coin_direct: SolverType.PROBABILITY,
  independent_event: SolverType.PROBABILITY,
  hot_hand_independence: SolverType.PROBABILITY,

  // Generic formula (from tryLocalCompute pipeline)
  formula: SolverType.FORMULA_TIER1 | SolverType.FORMULA_TIER2,
};

// =============================================================================
// FILTER FUNCTIONS
// =============================================================================

/**
 * Get the SolverType for a computation method.
 * Returns ARITHMETIC as fallback for unknown methods.
 */
export function methodToSolverType(method: string): SolverMask {
  return METHOD_TO_SOLVER[method] ?? SolverType.ARITHMETIC;
}

/**
 * Check if a computation's method is relevant for a domain.
 *
 * @param method - Computation method string (e.g., "derivative_eval")
 * @param relevantMask - Bitmask of relevant solver types
 * @returns True if the method is relevant
 */
export function isMethodRelevant(method: string, relevantMask: SolverMask): boolean {
  const methodMask = methodToSolverType(method);
  return (methodMask & relevantMask) !== 0;
}

/**
 * Filter computations by domain relevance.
 * Keeps only computations whose methods match the domain's relevant solvers.
 *
 * @param computations - Array of extracted computations
 * @param contextText - System prompt or combined context for domain detection
 * @returns Filtered computations + metadata
 */
export function filterByDomainRelevance(
  computations: ExtractedComputation[],
  contextText: string,
): FilterResult {
  // Get domain's relevant solver mask
  const relevantMask = getRelevantSolvers(contextText);
  const meta = detectMetaDomain(contextText);

  // Filter computations
  const relevant: ExtractedComputation[] = [];
  const filtered: ExtractedComputation[] = [];

  for (const comp of computations) {
    if (isMethodRelevant(comp.method, relevantMask)) {
      relevant.push(comp);
    } else {
      filtered.push(comp);
    }
  }

  return {
    relevant,
    filtered,
    meta,
    relevantMask,
    stats: {
      total: computations.length,
      kept: relevant.length,
      removed: filtered.length,
    },
  };
}

/**
 * Filter computations by explicit solver mask (no domain detection).
 * Useful when you already know the relevant solvers.
 *
 * @param computations - Array of extracted computations
 * @param relevantMask - Bitmask of relevant solver types
 * @returns Filtered computations
 */
export function filterByMask(
  computations: ExtractedComputation[],
  relevantMask: SolverMask,
): ExtractedComputation[] {
  return computations.filter((comp) => isMethodRelevant(comp.method, relevantMask));
}

// =============================================================================
// TYPES
// =============================================================================

export interface FilterResult {
  /** Computations that match the domain's relevant solvers */
  relevant: ExtractedComputation[];
  /** Computations that were filtered out */
  filtered: ExtractedComputation[];
  /** Detected meta-domain */
  meta: MetaDomain;
  /** Bitmask of relevant solver types */
  relevantMask: SolverMask;
  /** Statistics */
  stats: {
    total: number;
    kept: number;
    removed: number;
  };
}
