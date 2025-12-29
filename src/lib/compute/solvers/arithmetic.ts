/**
 * Arithmetic solver - safe evaluation of math expressions
 * Uses recursive descent parser instead of eval/Function
 */

import { SolverType } from "../classifier.ts";
import { safeEvaluate } from "../math.ts";
import { ARITHMETIC } from "../patterns.ts";
import type { ComputeResult, Solver } from "../types.ts";

/**
 * Safe arithmetic evaluation using recursive descent parser
 * Supports: +, -, *, /, ^, (), negative numbers, decimals
 */
export function tryArithmetic(text: string): ComputeResult {
  const start = performance.now();

  const patterns = [
    ARITHMETIC.whatIs,
    ARITHMETIC.calculate,
    ARITHMETIC.compute,
    ARITHMETIC.evaluate,
    ARITHMETIC.equalsQuestion,
    ARITHMETIC.bareExpression,
  ];

  let expr: string | null = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      expr = match[1].trim();
      break;
    }
  }

  if (!expr) return { solved: false, confidence: 0 };

  // Use safe recursive descent parser instead of new Function()
  const result = safeEvaluate(expr);

  if (result.success && result.value !== undefined) {
    const time_ms = performance.now() - start;
    return {
      solved: true,
      result: Number.isInteger(result.value) ? result.value : +result.value.toFixed(10),
      method: "arithmetic",
      confidence: 1.0,
      time_ms,
    };
  }

  return { solved: false, confidence: 0 };
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solver: Solver = {
  name: "arithmetic",
  description: "Safe evaluation of math expressions (+, -, *, /, ^, parentheses)",
  types: SolverType.ARITHMETIC,
  priority: 10,
  solve: (text, _lower) => tryArithmetic(text),
};
