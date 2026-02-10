/**
 * Derivation Simplification - simplification path and next step suggestions
 *
 * Provides tools for simplifying derivations, suggesting next steps,
 * and computing full simplification paths.
 *
 * @module derivation-simplify
 */

import {
  buildAST,
  compareExpressions,
  formatAST,
  simplifyAST,
  tokenizeMathExpression,
} from "../../domain/verification.ts";
import type { ASTNode } from "../../math/ast.ts";
import { extractDerivationSteps } from "./derivation-core.ts";
import { applyTransformation, TRANSFORM_PATTERNS } from "./derivation-transform.ts";

/** A single step in a simplified derivation */
export interface SimplifiedStep {
  /** Original LHS expression */
  originalLhs: string;
  /** Original RHS expression */
  originalRhs: string;
  /** Simplified LHS (after algebraic simplification) */
  simplifiedLhs: string;
  /** Simplified RHS (after algebraic simplification) */
  simplifiedRhs: string;
  /** Whether this step was simplified (changed from original) */
  wasSimplified: boolean;
  /** Suggestion for improvement, if any */
  suggestion?: string;
}

/** Result of simplifying a derivation */
export interface SimplifyDerivationResult {
  /** Original steps */
  original: Array<{ lhs: string; rhs: string }>;
  /** Simplified steps with suggestions */
  simplified: SimplifiedStep[];
  /** Cleaned derivation chain with redundant steps removed */
  cleaned: Array<{ lhs: string; rhs: string }>;
  /** Number of steps removed as redundant */
  stepsRemoved: number;
  /** Summary of simplifications applied */
  summary: string[];
}

/**
 * Parse an expression string to AST, returning null on failure
 */
export function parseToAST(expr: string): ASTNode | null {
  const { tokens, errors } = tokenizeMathExpression(expr);
  if (errors.length > 0) return null;
  const { ast } = buildAST(tokens);
  return ast;
}

/**
 * Simplify an expression string using AST simplification
 * Returns the simplified string, or original if parsing fails
 */
function simplifyExprString(expr: string): { result: string; changed: boolean } {
  const ast = parseToAST(expr);
  if (!ast) {
    return { result: expr, changed: false };
  }

  const simplified = simplifyAST(ast);
  const result = formatAST(simplified, { spaces: true, minimalParens: true });

  // Check if simplification changed anything
  const changed = result !== formatAST(ast, { spaces: true, minimalParens: true });
  return { result, changed };
}

/**
 * Check if two expression strings are equivalent
 */
function areEquivalent(a: string, b: string): boolean {
  return compareExpressions(a, b);
}

/**
 * Simplify a derivation by applying algebraic simplification to each step
 * and removing redundant steps.
 *
 * A step is considered redundant if:
 * 1. Its simplified LHS equals its simplified RHS (identity step like "x = x")
 * 2. It's equivalent to the previous step after simplification
 *
 * @param steps Array of {lhs, rhs} pairs representing the derivation
 * @returns SimplifyDerivationResult with simplified and cleaned derivation
 */
export function simplifyDerivation(
  steps: Array<{ lhs: string; rhs: string }>,
): SimplifyDerivationResult {
  if (steps.length === 0) {
    return {
      original: [],
      simplified: [],
      cleaned: [],
      stepsRemoved: 0,
      summary: ["No steps to simplify"],
    };
  }

  const simplified: SimplifiedStep[] = [];
  const summary: string[] = [];

  // Phase 1: Simplify each step
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;

    const { lhs, rhs } = step;
    const simplifiedLhs = simplifyExprString(lhs);
    const simplifiedRhs = simplifyExprString(rhs);

    const wasSimplified = simplifiedLhs.changed || simplifiedRhs.changed;

    let suggestion: string | undefined;

    // Generate suggestions
    if (simplifiedLhs.changed && simplifiedRhs.changed) {
      suggestion = `Step ${i + 1}: Both sides simplify (${lhs} → ${simplifiedLhs.result}, ${rhs} → ${simplifiedRhs.result})`;
    } else if (simplifiedLhs.changed) {
      suggestion = `Step ${i + 1}: LHS simplifies: ${lhs} → ${simplifiedLhs.result}`;
    } else if (simplifiedRhs.changed) {
      suggestion = `Step ${i + 1}: RHS simplifies: ${rhs} → ${simplifiedRhs.result}`;
    }

    // Check for identity steps (x = x after simplification)
    if (areEquivalent(simplifiedLhs.result, simplifiedRhs.result)) {
      if (simplifiedLhs.result === simplifiedRhs.result) {
        suggestion = suggestion
          ? `${suggestion}; this is an identity step (${simplifiedLhs.result} = ${simplifiedRhs.result})`
          : `Step ${i + 1}: Identity step (${simplifiedLhs.result} = ${simplifiedRhs.result})`;
      }
    }

    simplified.push({
      originalLhs: lhs,
      originalRhs: rhs,
      simplifiedLhs: simplifiedLhs.result,
      simplifiedRhs: simplifiedRhs.result,
      wasSimplified,
      suggestion,
    });

    if (suggestion) {
      summary.push(suggestion);
    }
  }

  // Phase 2: Remove redundant steps
  // A step is redundant if its simplified form is equivalent to the previous step's result
  const cleaned: Array<{ lhs: string; rhs: string }> = [];
  let lastRhs: string | null = null;

  for (let i = 0; i < simplified.length; i++) {
    const step = simplified[i];
    if (!step) continue;

    const { simplifiedLhs, simplifiedRhs } = step;

    // First step is never redundant
    if (i === 0) {
      cleaned.push({ lhs: simplifiedLhs, rhs: simplifiedRhs });
      lastRhs = simplifiedRhs;
      continue;
    }

    // Check if this step is redundant
    // Redundant if: lastRhs ≈ simplifiedLhs ≈ simplifiedRhs (no actual progress)
    const lhsMatchesLast = lastRhs && areEquivalent(lastRhs, simplifiedLhs);
    const isIdentityStep = areEquivalent(simplifiedLhs, simplifiedRhs);
    const rhsMatchesLast = lastRhs && areEquivalent(lastRhs, simplifiedRhs);

    // Skip if this step makes no progress (both sides equivalent to where we were)
    // or if it's a pure identity step that doesn't advance the derivation
    if (lhsMatchesLast && rhsMatchesLast) {
      summary.push(`Step ${i + 1}: Removed as redundant (no progress from ${lastRhs})`);
      continue;
    }

    // Also skip pure identity steps in the middle that don't add information
    if (isIdentityStep && lhsMatchesLast) {
      summary.push(`Step ${i + 1}: Removed identity step (${simplifiedLhs} = ${simplifiedRhs})`);
      continue;
    }

    // Keep the step
    cleaned.push({ lhs: simplifiedLhs, rhs: simplifiedRhs });
    lastRhs = simplifiedRhs;
  }

  const stepsRemoved = steps.length - cleaned.length;

  if (stepsRemoved > 0) {
    summary.push(`Removed ${stepsRemoved} redundant step${stepsRemoved > 1 ? "s" : ""}`);
  }

  if (summary.length === 0) {
    summary.push("Derivation is already in simplified form");
  }

  return {
    original: steps,
    simplified,
    cleaned,
    stepsRemoved,
    summary,
  };
}

/**
 * Simplify a derivation from text and return the cleaned version
 *
 * @param text Text containing a derivation (e.g., "x + 0 = x = x * 1 = x")
 * @returns SimplifyDerivationResult or null if no derivation found
 */
export function simplifyDerivationText(text: string): SimplifyDerivationResult | null {
  const steps = extractDerivationSteps(text);
  if (steps.length === 0) {
    return null;
  }
  return simplifyDerivation(steps);
}

/** Result of suggesting the next step */
export interface NextStepSuggestion {
  /** Whether a suggestion was found */
  hasSuggestion: boolean;
  /** The suggested transformation */
  transformation?: string;
  /** Human-readable description */
  description?: string;
  /** The current expression (last RHS) */
  currentExpression?: string;
  /** All applicable transformations in priority order */
  allApplicable: Array<{ name: string; description: string }>;
}

/**
 * Suggest the next logical simplification step for a derivation
 *
 * Analyzes the last expression in the derivation chain and identifies
 * applicable algebraic transformations, returning the highest-priority one.
 *
 * @param steps Array of {lhs, rhs} pairs representing the derivation so far
 * @returns NextStepSuggestion with the recommended transformation
 */
export function suggestNextStep(steps: Array<{ lhs: string; rhs: string }>): NextStepSuggestion {
  if (steps.length === 0) {
    return { hasSuggestion: false, allApplicable: [] };
  }

  // Get the last expression (RHS of last step)
  const lastStep = steps[steps.length - 1];
  if (!lastStep) {
    return { hasSuggestion: false, allApplicable: [] };
  }

  const currentExpr = lastStep.rhs;

  // Parse to AST
  const ast = parseToAST(currentExpr);
  if (!ast) {
    return { hasSuggestion: false, allApplicable: [], currentExpression: currentExpr };
  }

  // Find all applicable transformations
  const applicable: Array<{ name: string; description: string; priority: number }> = [];

  for (const pattern of TRANSFORM_PATTERNS) {
    if (pattern.applies(ast)) {
      applicable.push({
        name: pattern.name,
        description: pattern.description,
        priority: pattern.priority,
      });
    }
  }

  // Sort by priority (highest first)
  applicable.sort((a, b) => b.priority - a.priority);

  if (applicable.length === 0) {
    return {
      hasSuggestion: false,
      currentExpression: currentExpr,
      allApplicable: [],
    };
  }

  const best = applicable[0]!;

  return {
    hasSuggestion: true,
    transformation: best.name,
    description: best.description,
    currentExpression: currentExpr,
    allApplicable: applicable.map(({ name, description }) => ({ name, description })),
  };
}

/**
 * Suggest next step from text containing a derivation
 *
 * @param text Text containing a derivation
 * @returns NextStepSuggestion or null if no derivation found
 */
export function suggestNextStepFromText(text: string): NextStepSuggestion | null {
  const steps = extractDerivationSteps(text);
  if (steps.length === 0) {
    return null;
  }
  return suggestNextStep(steps);
}

/** A single step in a simplification path */
export interface SimplificationStep {
  /** Step number (1-indexed) */
  step: number;
  /** The transformation applied */
  transformation: string;
  /** Human-readable description */
  description: string;
  /** Expression before this step */
  before: string;
  /** Expression after this step */
  after: string;
}

/** Result of computing a full simplification path */
export interface SimplificationPath {
  /** Whether simplification was possible */
  success: boolean;
  /** Original expression */
  original: string;
  /** Final simplified expression */
  simplified: string;
  /** Sequence of transformation steps */
  steps: SimplificationStep[];
  /** Whether the expression is fully simplified */
  isFullySimplified: boolean;
  /** Total number of transformations applied */
  transformationCount: number;
}

/**
 * Compute a complete simplification path for an expression
 *
 * Iteratively applies transformations until the expression cannot be
 * simplified further, recording each step along the way.
 *
 * @param expression The expression to simplify
 * @param maxSteps Maximum number of simplification steps (default: 50)
 * @returns SimplificationPath with the complete sequence of transformations
 */
export function suggestSimplificationPath(expression: string, maxSteps = 50): SimplificationPath {
  const ast = parseToAST(expression);

  if (!ast) {
    return {
      success: false,
      original: expression,
      simplified: expression,
      steps: [],
      isFullySimplified: false,
      transformationCount: 0,
    };
  }

  const steps: SimplificationStep[] = [];
  let currentAst = ast;
  let currentExpr = expression;
  let stepCount = 0;

  while (stepCount < maxSteps) {
    // Find applicable transformations for current AST
    const applicable: Array<{ name: string; description: string; priority: number }> = [];

    for (const pattern of TRANSFORM_PATTERNS) {
      if (pattern.applies(currentAst)) {
        applicable.push({
          name: pattern.name,
          description: pattern.description,
          priority: pattern.priority,
        });
      }
    }

    if (applicable.length === 0) {
      // No more transformations possible
      break;
    }

    // Sort by priority and try to apply the highest-priority transformation
    applicable.sort((a, b) => b.priority - a.priority);

    let appliedAny = false;

    for (const transform of applicable) {
      const { transformed, applied } = applyTransformation(currentAst, transform.name);

      if (applied) {
        const beforeExpr = currentExpr;
        currentAst = transformed;
        currentExpr = formatAST(transformed, { spaces: true, minimalParens: true });
        stepCount++;

        steps.push({
          step: stepCount,
          transformation: transform.name,
          description: transform.description,
          before: beforeExpr,
          after: currentExpr,
        });

        appliedAny = true;
        break; // Apply one transformation at a time
      }
    }

    if (!appliedAny) {
      // Transformations detected but none could be applied (edge case)
      break;
    }
  }

  // Check if fully simplified (no more applicable transformations)
  const remainingTransforms: Array<{ name: string }> = [];
  for (const pattern of TRANSFORM_PATTERNS) {
    if (pattern.applies(currentAst)) {
      remainingTransforms.push({ name: pattern.name });
    }
  }

  return {
    success: true,
    original: expression,
    simplified: currentExpr,
    steps,
    isFullySimplified: remainingTransforms.length === 0,
    transformationCount: steps.length,
  };
}
