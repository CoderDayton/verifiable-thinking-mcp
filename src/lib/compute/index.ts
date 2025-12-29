/**
 * Local Compute Engine
 *
 * Solves computable problems instantly without LLM calls.
 * Why ask an LLM to compute 17+28 when TypeScript can do it in 0.001ms?
 *
 * Architecture:
 * 1. Classifier: Fast bitmask routing (~0.01ms)
 * 2. Registry: Auto-discovered solvers by type
 * 3. Cache: LRU cache for repeated questions
 *
 * Capabilities:
 * - Arithmetic: basic math expressions
 * - Formulas: pythagorean, quadratic, fibonacci, logarithms, factorial
 * - Word problems: "twice as many", "half of", "sum of X and Y"
 * - Multi-step word problems: entity extraction + dependency resolution
 * - Multi-expression extraction: finds ALL computable parts in text
 * - Context injection: returns augmented prompt with computed values
 * - LRU caching: avoids recomputing identical questions
 * - Confidence scoring: returns likelihood of successful local compute
 * - Domain filtering: filters computations by domain relevance
 */

// Re-export cache utilities
export { clearCache, computeCache, getCacheStats } from "./cache.ts";
// Re-export classifier
export {
  type ClassifierResult,
  classifyQuestion,
  describeMask,
  SolverGroup,
  type SolverMask,
  SolverType,
  shouldTrySolver,
} from "./classifier.ts";
// Re-export confidence
export { computeConfidence, isLikelyComputable } from "./confidence.ts";
// Re-export context-aware compute
export {
  type ContextAwareInput,
  type ContextAwareResult,
  computeWithContext,
  contextAwareCompute,
  wouldKeepComputation,
} from "./context.ts";

// Re-export extraction
export { computeAndReplace, extractAndCompute } from "./extract.ts";
// Re-export filtering
export {
  type FilterResult,
  filterByDomainRelevance,
  filterByMask,
  isMethodRelevant,
  methodToSolverType,
} from "./filter.ts";
// Re-export math helpers (for testing)
export {
  combinations,
  factorial,
  fibonacci,
  formatResult,
  gcd,
  isPrime,
  lcm,
  normalizeUnicodeSuperscripts,
  type ParseResult,
  permutations,
  safeEvaluate,
} from "./math.ts";
// Re-export registry
export {
  getRegistryStats,
  getSolvers,
  getSolversForMask,
  registerSolver,
  runSolvers,
  type Solver,
} from "./registry.ts";
// Re-export solvers (for direct access / testing)
export {
  tryArithmetic,
  tryCalculus,
  tryCRTProblem,
  tryFormula,
  tryLogic,
  tryMathFacts,
  tryMultiStepWordProblem,
  tryProbability,
  tryWordProblem,
} from "./solvers/index.ts";
// Re-export types
export type {
  AugmentedResult,
  CacheStats,
  ComputeConfidence,
  ComputeResult,
  ExtractedComputation,
} from "./types.ts";

// Import for main function
import { computeCache } from "./cache.ts";
import { classifyQuestion } from "./classifier.ts";
import { runSolvers } from "./registry.ts";
import type { ComputeResult } from "./types.ts";

/**
 * Try to solve a question locally without LLM
 * Returns immediately if computable, otherwise returns { solved: false }
 *
 * Flow:
 * 1. Check cache (instant return if hit)
 * 2. Classify question → bitmask of likely solver types
 * 3. Run matching solvers in priority order
 * 4. Cache successful results
 *
 * @param text - The question to solve
 * @param useCache - Whether to use LRU cache (default: true)
 */
export function tryLocalCompute(text: string, useCache = true): ComputeResult {
  // Check cache first
  if (useCache) {
    const cached = computeCache.get(text);
    if (cached) {
      return { ...cached, time_ms: 0 }; // Cache hit is instant
    }
  }

  // Classify question to get solver mask
  const { mask, lower } = classifyQuestion(text);

  // No solvers match → quick exit
  if (mask === 0) {
    return { solved: false, confidence: 0 };
  }

  // Run matching solvers
  const result = runSolvers(text, lower, mask);

  // Cache successful results
  if (result.solved && useCache) {
    computeCache.set(text, result);
  }

  return result;
}
