/**
 * Statistics Solver - Mean, median, standard error, expected value
 *
 * Handles:
 * - Mean/average of a list of numbers
 * - Median of a list
 * - Standard error (SE = SD / sqrt(n))
 * - Expected value calculations
 * - Permutations with repetition (MISSISSIPPI problem)
 * - Handshake/combination counting
 */

import { SolverType } from "../classifier.ts";
import { factorial } from "../math.ts";
import type { ComputeResult, Solver } from "../types.ts";

// =============================================================================
// HELPERS
// =============================================================================

function solved(result: string | number, method: string, start: number): ComputeResult {
  return {
    solved: true,
    result,
    method,
    confidence: 1.0,
    time_ms: performance.now() - start,
  };
}

/**
 * Extract numbers from text, handling various formats
 * - "$30k" → 30000
 * - "$1M" → 1000000
 * - "30,000" → 30000
 */
function extractNumbers(text: string): number[] {
  const numbers: number[] = [];

  // Match currency with k/M suffix: $30k, $1M
  const currencyMatches = text.matchAll(/\$(\d+(?:\.\d+)?)\s*([kKmMbB])?/g);
  for (const m of currencyMatches) {
    let val = parseFloat(m[1] || "0");
    const suffix = m[2]?.toLowerCase();
    if (suffix === "k") val *= 1000;
    else if (suffix === "m") val *= 1000000;
    else if (suffix === "b") val *= 1000000000;
    numbers.push(val);
  }

  // If we found currency, return those
  if (numbers.length > 0) return numbers;

  // Match plain numbers (with optional commas)
  const plainMatches = text.matchAll(/(?<!\$)(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g);
  for (const m of plainMatches) {
    const val = parseFloat((m[1] || "0").replace(/,/g, ""));
    if (!Number.isNaN(val)) numbers.push(val);
  }

  return numbers;
}

// =============================================================================
// MEAN / AVERAGE
// =============================================================================

const MEAN_PATTERNS = [
  /(?:mean|average)\s+(?:of\s+)?(?:income|value|number)s?[:\s]*(.+?)(?:\?|$)/i,
  /(?:what\s+is\s+the\s+)?(?:mean|average)[:\s]+(.+?)(?:\?|$)/i,
  /incomes?[:\s]+(.+?)\.\s*(?:mean|average)/i,
];

function tryMean(text: string, lower: string): ComputeResult | null {
  if (!lower.includes("mean") && !lower.includes("average")) return null;

  const start = performance.now();

  for (const pattern of MEAN_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const numbers = extractNumbers(match[1]);
      if (numbers.length >= 2) {
        const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        // Check if asking for thousands
        if (lower.includes("thousand") || lower.includes("in thousands")) {
          return solved(Math.round(mean / 1000), "mean_thousands", start);
        }
        return solved(Math.round(mean * 100) / 100, "mean", start);
      }
    }
  }

  // Fallback: extract all numbers from text if "mean" is mentioned
  const numbers = extractNumbers(text);
  if (numbers.length >= 2 && (lower.includes("mean") || lower.includes("average"))) {
    const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    if (lower.includes("thousand") || lower.includes("in thousands")) {
      return solved(Math.round(mean / 1000), "mean_thousands", start);
    }
    return solved(Math.round(mean * 100) / 100, "mean", start);
  }

  return null;
}

// =============================================================================
// STANDARD ERROR
// =============================================================================

function tryStandardError(text: string, lower: string): ComputeResult | null {
  if (!lower.includes("standard error")) return null;

  const start = performance.now();

  // Pattern: "SD 10, n=100" or "standard deviation 10, sample size 100"
  const sdMatch = text.match(/(?:sd|standard\s+deviation)[:\s=]*(\d+(?:\.\d+)?)/i);
  // Must match "n=" or "n:" or standalone "n " at word boundary, or "sample size"
  const nMatch = text.match(/(?:\bn\s*[=:]\s*|sample\s+size[:\s=]*)(\d+)/i);

  if (sdMatch?.[1] && nMatch?.[1]) {
    const sd = parseFloat(sdMatch[1]);
    const n = parseInt(nMatch[1], 10);
    if (n > 0) {
      const se = sd / Math.sqrt(n);
      return solved(Math.round(se * 1000) / 1000, "standard_error", start);
    }
  }

  return null;
}

// =============================================================================
// EXPECTED VALUE
// =============================================================================

function tryExpectedValue(text: string, lower: string): ComputeResult | null {
  if (!lower.includes("expected value") && !lower.includes("expected")) return null;

  const start = performance.now();

  // Lottery pattern: "1/N chance of $X" → EV = X/N
  const lotteryMatch = text.match(/1\/(\d+(?:,\d{3})*)\s*chance\s+(?:of\s+)?\$?(\d+(?:,\d{3})*)/i);
  if (lotteryMatch?.[1] && lotteryMatch[2]) {
    const odds = parseInt(lotteryMatch[1].replace(/,/g, ""), 10);
    const prize = parseInt(lotteryMatch[2].replace(/,/g, ""), 10);
    const ev = prize / odds;

    // Check for unit conversion
    if (lower.includes("cents") || lower.includes("in cents")) {
      return solved(Math.round(ev * 100), "expected_value_cents", start);
    }
    return solved(Math.round(ev * 100) / 100, "expected_value", start);
  }

  return null;
}

// =============================================================================
// PERMUTATIONS WITH REPETITION (MISSISSIPPI)
// =============================================================================

function tryPermutationsWithRepetition(text: string, lower: string): ComputeResult | null {
  if (!lower.includes("arrange") && !lower.includes("permutation") && !lower.includes("ways")) {
    return null;
  }

  const start = performance.now();

  // Pattern: "arrange the letters in WORD" or "arrangements of WORD"
  const wordMatch = text.match(
    /(?:arrange|arrangement|permutation|ways\s+to\s+arrange).*?(?:letters?\s+(?:in|of)\s+)?([A-Z]{4,})/i,
  );

  if (wordMatch?.[1]) {
    const word = wordMatch[1].toUpperCase();
    const n = word.length;

    // Count letter frequencies
    const freq: Record<string, number> = {};
    for (const char of word) {
      freq[char] = (freq[char] || 0) + 1;
    }

    // Formula: n! / (n1! * n2! * ... * nk!)
    let denominator = 1;
    for (const count of Object.values(freq)) {
      denominator *= factorial(count);
    }

    const result = factorial(n) / denominator;
    return solved(result, "permutations_repetition", start);
  }

  return null;
}

// =============================================================================
// HANDSHAKE PROBLEM
// =============================================================================

function tryHandshake(text: string, lower: string): ComputeResult | null {
  if (!lower.includes("handshake") && !lower.includes("shakes hands")) {
    return null;
  }

  const start = performance.now();

  // Pattern: "N people, each shakes hands with everyone else"
  const match = text.match(
    /(\d+)\s*(?:people|persons?|guests?|members?).*?(?:handshake|shakes?\s+hands)/i,
  );

  if (match?.[1]) {
    const n = parseInt(match[1], 10);
    // Handshake formula: n choose 2 = n(n-1)/2
    const result = (n * (n - 1)) / 2;
    return solved(result, "handshake", start);
  }

  return null;
}

// =============================================================================
// MAIN SOLVER
// =============================================================================

export function tryStatistics(text: string): ComputeResult {
  const lower = text.toLowerCase();

  // Try standard error FIRST (before mean, since SE questions often contain "mean")
  const se = tryStandardError(text, lower);
  if (se) return se;

  // Then try mean/average
  const mean = tryMean(text, lower);
  if (mean) return mean;

  const ev = tryExpectedValue(text, lower);
  if (ev) return ev;

  const perm = tryPermutationsWithRepetition(text, lower);
  if (perm) return perm;

  const handshake = tryHandshake(text, lower);
  if (handshake) return handshake;

  return { solved: false, confidence: 0 };
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solver: Solver = {
  name: "statistics",
  description:
    "Statistics: mean, standard error, expected value, permutations with repetition, handshake problem",
  types: SolverType.FORMULA_TIER3 | SolverType.WORD_PROBLEM,
  priority: 25, // After formula, before word problems
  solve: (text, _lower) => tryStatistics(text),
};
