/**
 * Mathematical Facts Solver
 * Handles questions about known mathematical properties/facts
 * that don't require computation - just knowledge lookup
 */

import { SolverType } from "../classifier.ts";
import type { ComputeResult, Solver } from "../types.ts";

/**
 * Known irrational numbers (common ones asked about)
 */
const KNOWN_IRRATIONALS = new Set([
  "sqrt(2)",
  "√2",
  "sqrt2",
  "sqrt(3)",
  "√3",
  "sqrt3",
  "sqrt(5)",
  "√5",
  "sqrt5",
  "sqrt(7)",
  "√7",
  "sqrt7",
  "sqrt(11)",
  "√11",
  "sqrt11",
  "pi",
  "π",
  "e",
  "euler",
  "phi",
  "φ",
  "golden ratio",
]);

/**
 * Perfect squares (sqrt is rational)
 */
const PERFECT_SQUARES = new Set([1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144, 169, 196, 225]);

/**
 * Try to answer rationality questions
 * "Is sqrt(2) rational or irrational?"
 * "Is pi rational?"
 */
export function tryMathFacts(text: string): ComputeResult {
  const start = performance.now();
  const lower = text.toLowerCase();

  // Check for rationality questions
  if (lower.includes("rational") || lower.includes("irrational")) {
    // Check for sqrt(n), √n, or "square root of n" patterns
    const sqrtMatch = text.match(/sqrt\s*\(?\s*(\d+)\s*\)?|√(\d+)|square\s+root\s+of\s+(\d+)/i);
    if (sqrtMatch) {
      const n = parseInt(sqrtMatch[1] || sqrtMatch[2] || sqrtMatch[3] || "", 10);
      if (!Number.isNaN(n)) {
        const isRational = PERFECT_SQUARES.has(n);
        return {
          solved: true,
          result: isRational ? "RATIONAL" : "IRRATIONAL",
          method: "math_fact_rationality",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }

    // Check for known irrationals by name
    for (const irrational of KNOWN_IRRATIONALS) {
      if (lower.includes(irrational.toLowerCase())) {
        return {
          solved: true,
          result: "IRRATIONAL",
          method: "math_fact_known_irrational",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }

    // Check for integer rationality
    const intMatch = lower.match(/is\s+(\d+)\s+rational/);
    if (intMatch) {
      return {
        solved: true,
        result: "RATIONAL",
        method: "math_fact_integer",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }

    // Check for fraction rationality
    if (lower.includes("fraction") || /\d+\s*\/\s*\d+/.test(text)) {
      return {
        solved: true,
        result: "RATIONAL",
        method: "math_fact_fraction",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  return { solved: false, confidence: 0 };
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solver: Solver = {
  name: "facts",
  description: "Mathematical facts: rationality of sqrt, pi, e, integers, fractions",
  types: SolverType.FACTS,
  priority: 5, // Runs first - instant lookups
  solve: (text, _lower) => tryMathFacts(text),
};
