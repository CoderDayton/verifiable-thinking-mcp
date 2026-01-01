/**
 * Derivation solver - verifies multi-step algebraic derivations
 *
 * Uses compareExpressions to check that each step in a derivation is
 * algebraically equivalent to the previous step. Catches "magic" steps
 * in proofs where the transformation isn't valid.
 *
 * Example derivation that should PASS:
 *   x + x = 2x
 *   2x + 3 = 2x + 3
 *   (verified: each RHS equals previous step or is equivalent)
 *
 * Example derivation that should FAIL:
 *   x + x = 2x
 *   2x = 3x  <-- invalid step (2x ≠ 3x)
 */

import {
  type ASTNode,
  type BinaryNode,
  buildAST,
  compareExpressions,
  formatAST,
  simplifyAST,
  tokenizeMathExpression,
} from "../../verification.ts";
import type { ComputeResult } from "../types.ts";

/** Result of verifying a single derivation step */
export interface StepVerification {
  step: number;
  lhs: string;
  rhs: string;
  valid: boolean;
  error?: string;
}

/** Result of verifying a complete derivation */
export interface DerivationResult {
  valid: boolean;
  steps: StepVerification[];
  invalidStep?: number;
  error?: string;
}

/**
 * Extract derivation steps from text
 * Looks for patterns like:
 *   expr1 = expr2
 *   expr3 = expr4
 *   ...
 *
 * Or chained: expr1 = expr2 = expr3 = ...
 *
 * Or sentence-separated: expr1 = expr2, then expr3 = expr4
 *
 * @internal
 */
function extractDerivationSteps(text: string): Array<{ lhs: string; rhs: string }> {
  const steps: Array<{ lhs: string; rhs: string }> = [];

  // Pre-process: split on sentence boundaries (comma, semicolon, "then", "so", etc.)
  // to handle multi-step derivations in a single line
  const segments = text
    .split(/[,;]|\bthen\b|\bso\b|\btherefore\b|\bhence\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  // Process each segment
  for (const segment of segments) {
    // Pattern 1: Chained equalities (a = b = c = d)
    // Split on "=" and pair consecutive terms
    const chainedMatch = segment.match(
      /([^=\n]+(?:=[^=\n]+){2,})/g, // 3+ terms connected by =
    );

    if (chainedMatch) {
      for (const chain of chainedMatch) {
        const parts = chain
          .split("=")
          .map((p) => cleanExpressionPart(p))
          .filter(Boolean);
        for (let i = 0; i < parts.length - 1; i++) {
          const lhs = parts[i];
          const rhs = parts[i + 1];
          if (lhs && rhs) {
            steps.push({ lhs, rhs });
          }
        }
      }
      continue; // Move to next segment
    }

    // Pattern 2: Simple equality (expr = expr)
    const simpleMatch = segment.match(/^\s*([^=\n]+?)\s*=\s*([^=\n]+?)\s*$/);
    if (simpleMatch) {
      const lhs = cleanExpressionPart(simpleMatch[1] ?? "");
      const rhs = cleanExpressionPart(simpleMatch[2] ?? "");
      if (lhs && rhs) {
        steps.push({ lhs, rhs });
      }
    }
  }

  // If no steps found via segment processing, try original line-by-line approach
  if (steps.length === 0) {
    // Pattern 3: Line-by-line equalities
    const linePattern = /^\s*([^=\n]+?)\s*=\s*([^=\n]+?)\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(text)) !== null) {
      const lhs = cleanExpressionPart(match[1] ?? "");
      const rhs = cleanExpressionPart(match[2] ?? "");
      if (lhs && rhs) {
        steps.push({ lhs, rhs });
      }
    }
  }

  return steps;
}

/**
 * Clean an expression part by removing non-math prefixes
 * E.g., "prove: x + x" → "x + x"
 * @internal
 */
function cleanExpressionPart(part: string): string {
  let cleaned = part.trim();

  // Remove common prefixes like "prove:", "show that", "verify:", etc.
  cleaned = cleaned.replace(
    /^(?:prove|show(?:\s+that)?|verify|therefore|thus|hence|so|then)[:.]?\s*/i,
    "",
  );

  // Remove leading non-math characters (but keep negative signs)
  // Match from start: letters/punctuation that aren't part of a variable
  cleaned = cleaned.replace(/^[^a-zA-Z0-9\-.(]+/, "");

  return cleaned.trim();
}

/**
 * Verify that each step in a derivation is algebraically valid
 *
 * For each step "A = B", we verify:
 * 1. A and B are equivalent (within the same step)
 *
 * For consecutive steps, we verify:
 * 2. The RHS of step N equals the LHS of step N+1 (continuity)
 *
 * @param steps Array of {lhs, rhs} pairs representing the derivation
 * @returns DerivationResult with validity and error details
 */
export function verifyDerivationSteps(
  steps: Array<{ lhs: string; rhs: string }>,
): DerivationResult {
  if (steps.length === 0) {
    return { valid: false, steps: [], error: "No derivation steps found" };
  }

  const verifiedSteps: StepVerification[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;

    const { lhs, rhs } = step;
    const stepNum = i + 1;

    // Check 1: LHS and RHS of this step are equivalent
    const equivalent = compareExpressions(lhs, rhs);

    if (!equivalent) {
      verifiedSteps.push({
        step: stepNum,
        lhs,
        rhs,
        valid: false,
        error: `Step ${stepNum}: "${lhs}" is not equivalent to "${rhs}"`,
      });
      return {
        valid: false,
        steps: verifiedSteps,
        invalidStep: stepNum,
        error: `Invalid step ${stepNum}: ${lhs} ≠ ${rhs}`,
      };
    }

    // Check 2: Continuity with previous step
    // The LHS of this step should equal the RHS of the previous step
    if (i > 0) {
      const prevStep = steps[i - 1];
      if (prevStep) {
        const continuous = compareExpressions(prevStep.rhs, lhs);
        if (!continuous) {
          verifiedSteps.push({
            step: stepNum,
            lhs,
            rhs,
            valid: false,
            error: `Step ${stepNum} doesn't follow from step ${stepNum - 1}: "${prevStep.rhs}" → "${lhs}"`,
          });
          return {
            valid: false,
            steps: verifiedSteps,
            invalidStep: stepNum,
            error: `Discontinuity at step ${stepNum}: previous RHS "${prevStep.rhs}" ≠ current LHS "${lhs}"`,
          };
        }
      }
    }

    verifiedSteps.push({
      step: stepNum,
      lhs,
      rhs,
      valid: true,
    });
  }

  return {
    valid: true,
    steps: verifiedSteps,
  };
}

/**
 * Try to verify a derivation in text
 *
 * Extracts derivation steps and verifies each one is algebraically valid.
 * Useful for checking mathematical proofs and simplification chains.
 *
 * @example
 * // Valid derivation
 * tryDerivation("x + x = 2x = 2*x")
 * // { solved: true, result: "Valid derivation (2 steps)", ... }
 *
 * @example
 * // Invalid derivation
 * tryDerivation("x + x = 2x = 3x")
 * // { solved: true, result: "Invalid step 2: 2x ≠ 3x", ... }
 */
export function tryDerivation(text: string): ComputeResult {
  const start = performance.now();
  const lower = text.toLowerCase();

  // Guard: Only try derivation if text looks like a proof/derivation
  const hasDerivationKeywords =
    lower.includes("show") ||
    lower.includes("prove") ||
    lower.includes("verify") ||
    lower.includes("derivation") ||
    lower.includes("simplif") ||
    lower.includes("therefore") ||
    lower.includes("thus") ||
    lower.includes("hence") ||
    text.includes("⟹") ||
    text.includes("→") ||
    text.includes("=>") ||
    // Multiple equals signs suggest a derivation chain
    (text.match(/=/g)?.length ?? 0) >= 2;

  if (!hasDerivationKeywords) {
    return { solved: false, confidence: 0 };
  }

  const steps = extractDerivationSteps(text);

  if (steps.length < 1) {
    return { solved: false, confidence: 0 };
  }

  const result = verifyDerivationSteps(steps);
  const time_ms = performance.now() - start;

  if (result.valid) {
    return {
      solved: true,
      result: `Valid derivation (${result.steps.length} steps verified)`,
      method: "derivation_verification",
      confidence: 1.0,
      time_ms,
    };
  }

  return {
    solved: true,
    result: result.error ?? "Invalid derivation",
    method: "derivation_verification",
    confidence: 0.9, // Slightly lower confidence for invalid results
    time_ms,
  };
}

// =============================================================================
// DERIVATION SIMPLIFICATION
// =============================================================================

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
 * @internal
 */
function parseToAST(expr: string): ASTNode | null {
  const { tokens, errors } = tokenizeMathExpression(expr);
  if (errors.length > 0) return null;
  const { ast } = buildAST(tokens);
  return ast;
}

/**
 * Simplify an expression string using AST simplification
 * Returns the simplified string, or original if parsing fails
 * @internal
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
 * @internal
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
 *
 * @example
 * // Simplify a derivation with redundant steps
 * simplifyDerivation([
 *   { lhs: "x + 0", rhs: "x" },           // x + 0 simplifies to x
 *   { lhs: "x", rhs: "x * 1" },           // x * 1 simplifies to x (redundant)
 *   { lhs: "x * 1", rhs: "x + x - x" },   // x + x - x simplifies to x (redundant)
 *   { lhs: "x", rhs: "2 * x / 2" },       // actual transformation
 * ])
 * // Returns cleaned chain: [{ lhs: "x", rhs: "x" }, { lhs: "x", rhs: "x" }]
 * // with suggestions about simplifications
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
 *
 * @example
 * simplifyDerivationText("prove: x + 0 = x = x * 1")
 * // Returns simplified derivation with redundant identity step removed
 */
export function simplifyDerivationText(text: string): SimplifyDerivationResult | null {
  const steps = extractDerivationSteps(text);
  if (steps.length === 0) {
    return null;
  }
  return simplifyDerivation(steps);
}

/**
 * Check for chain rule error: d/dx f(g(x)) missing the inner derivative
 * Common error: d/dx sin(x^2) = cos(x^2) instead of cos(x^2) * 2x
 *
 * Patterns detected:
 * - "d/dx sin(x^2) = cos(x^2)" (missing * 2x)
 * - "d/dx (x^2 + 1)^3 = 3(x^2 + 1)^2" (missing * 2x)
 * - "d/dx e^(2x) = e^(2x)" (missing * 2)
 *
 * @internal
 */
function checkChainRuleError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  _rhsAst: ASTNode | null,
): DetectedMistake | null {
  // Match derivative of composite function patterns
  const derivPatterns = [
    // d/dx sin(inner) where inner is not just x
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*sin\s*\(\s*([^)]+)\s*\)/i,
      outer: "sin",
      outerDeriv: "cos",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    // d/dx cos(inner)
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*cos\s*\(\s*([^)]+)\s*\)/i,
      outer: "cos",
      outerDeriv: "-sin",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    // d/dx e^(inner) or exp(inner)
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*(?:e\^|exp)\s*\(\s*([^)]+)\s*\)/i,
      outer: "e^",
      outerDeriv: "e^",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    // d/dx ln(inner)
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*ln\s*\(\s*([^)]+)\s*\)/i,
      outer: "ln",
      outerDeriv: "1/",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    // d/dx (inner)^n - composite power
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*\(\s*([^)]+)\s*\)\s*\^\s*(\d+)/i,
      outer: "power",
      outerDeriv: null,
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
      getExp: (m: RegExpMatchArray) => parseInt(m[2]!, 10),
    },
  ];

  for (const { pattern, outer, outerDeriv: _outerDeriv, getInner, getExp } of derivPatterns) {
    const match = lhs.match(pattern);
    if (!match) continue;

    const inner = getInner(match);

    // Skip if inner is just a single variable (not composite)
    if (/^[a-zA-Z]$/.test(inner)) continue;

    // Check if the inner function needs chain rule
    // Look for patterns like x^2, 2x, x+1, etc.
    const hasComposite = /[+\-*/^]|\d[a-zA-Z]|[a-zA-Z]\d/.test(inner);
    if (!hasComposite) continue;

    // Compute the inner derivative (simplified heuristics)
    let innerDeriv: string | null = null;

    // x^n -> nx^(n-1)
    const powerMatch = inner.match(/^([a-zA-Z])\s*\^\s*(\d+)$/);
    if (powerMatch) {
      const v = powerMatch[1]!;
      const n = parseInt(powerMatch[2]!, 10);
      innerDeriv = n === 2 ? `2${v}` : `${n}${v}^${n - 1}`;
    }

    // ax -> a (linear)
    const linearMatch = inner.match(/^(\d+)\s*([a-zA-Z])$/);
    if (linearMatch) {
      innerDeriv = linearMatch[1]!;
    }

    // If we can't determine inner derivative, skip
    if (!innerDeriv) continue;

    // Now check if the RHS is missing the chain rule factor
    // For sin(x^2), wrong answer is cos(x^2), correct is cos(x^2) * 2x

    if (outer === "sin") {
      // Check if RHS is just cos(inner) without * innerDeriv
      const wrongPattern = new RegExp(`^-?cos\\s*\\(\\s*${escapeRegex(inner)}\\s*\\)$`, "i");
      if (wrongPattern.test(rhs.trim())) {
        const expectedResult = `cos(${inner}) * ${innerDeriv}`;
        return {
          type: "chain_rule_error",
          stepNumber: 0,
          confidence: 0.9,
          found: rhs,
          expected: expectedResult,
          explanation: `Chain rule error. When differentiating sin(f(x)), multiply by the derivative of the inner function.`,
          suggestion: `d/dx sin(${inner}) = cos(${inner}) · (d/dx of ${inner}) = cos(${inner}) · ${innerDeriv}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }
    }

    if (outer === "cos") {
      // Check if RHS is just -sin(inner) or sin(inner) without * innerDeriv
      const wrongPattern = new RegExp(`^-?sin\\s*\\(\\s*${escapeRegex(inner)}\\s*\\)$`, "i");
      if (wrongPattern.test(rhs.trim())) {
        const expectedResult = `-sin(${inner}) * ${innerDeriv}`;
        return {
          type: "chain_rule_error",
          stepNumber: 0,
          confidence: 0.9,
          found: rhs,
          expected: expectedResult,
          explanation: `Chain rule error. When differentiating cos(f(x)), multiply by the derivative of the inner function.`,
          suggestion: `d/dx cos(${inner}) = -sin(${inner}) · (d/dx of ${inner}) = -sin(${inner}) · ${innerDeriv}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }
    }

    if (outer === "e^") {
      // Check if RHS is just e^(inner) without * innerDeriv
      const wrongPattern = new RegExp(`^e\\^\\s*\\(\\s*${escapeRegex(inner)}\\s*\\)$`, "i");
      if (wrongPattern.test(rhs.trim())) {
        const expectedResult = `e^(${inner}) * ${innerDeriv}`;
        return {
          type: "chain_rule_error",
          stepNumber: 0,
          confidence: 0.9,
          found: rhs,
          expected: expectedResult,
          explanation: `Chain rule error. When differentiating e^(f(x)), multiply by the derivative of the inner function.`,
          suggestion: `d/dx e^(${inner}) = e^(${inner}) · (d/dx of ${inner}) = e^(${inner}) · ${innerDeriv}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }
    }

    if (outer === "power" && getExp) {
      const n = getExp(match);
      // Check if RHS is just n(inner)^(n-1) without * innerDeriv
      const wrongPattern = new RegExp(
        `^${n}\\s*\\(\\s*${escapeRegex(inner)}\\s*\\)\\s*\\^\\s*${n - 1}$`,
        "i",
      );
      if (wrongPattern.test(rhs.trim())) {
        const expectedResult = `${n}(${inner})^${n - 1} * ${innerDeriv}`;
        return {
          type: "chain_rule_error",
          stepNumber: 0,
          confidence: 0.9,
          found: rhs,
          expected: expectedResult,
          explanation: `Chain rule error. When differentiating (f(x))^n, multiply by the derivative of the inner function.`,
          suggestion: `d/dx (${inner})^${n} = ${n}(${inner})^${n - 1} · (d/dx of ${inner}) = ${n}(${inner})^${n - 1} · ${innerDeriv}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }
    }
  }

  return null;
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check for product rule error: d/dx (f * g) missing one term
 * Common error: d/dx (x^2 * sin(x)) = 2x * cos(x) (missing f*g' or f'*g)
 *
 * Patterns detected:
 * - "d/dx x^2 * sin(x) = 2x * cos(x)" (missing x^2 * cos(x))
 * - "d/dx x * e^x = e^x" (missing x * e^x)
 *
 * @internal
 */
function checkProductRuleError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  _rhsAst: ASTNode | null,
): DetectedMistake | null {
  // Match derivative of product patterns
  // d/dx f * g or d/dx f·g
  const productPattern = /(?:d\/dx|derivative\s+of)\s+(.+?)\s*[*·]\s*(.+?)(?:\s*=|$)/i;
  const match = lhs.match(productPattern);

  if (!match) return null;

  const f = match[1]!.trim();
  const g = match[2]!.trim();

  // Try to compute f' and g' for common cases
  let fDeriv: string | null = null;
  let gDeriv: string | null = null;

  // x^n -> nx^(n-1)
  const computePowerDeriv = (expr: string): string | null => {
    const powerMatch = expr.match(/^([a-zA-Z])\s*\^\s*(\d+)$/);
    if (powerMatch) {
      const v = powerMatch[1]!;
      const n = parseInt(powerMatch[2]!, 10);
      if (n === 1) return "1";
      if (n === 2) return `2${v}`;
      return `${n}${v}^${n - 1}`;
    }
    // Just x -> 1
    if (/^[a-zA-Z]$/.test(expr)) return "1";
    return null;
  };

  // sin(x) -> cos(x), cos(x) -> -sin(x), e^x -> e^x
  const computeTrigExpDeriv = (expr: string): string | null => {
    if (/^sin\s*\(\s*[a-zA-Z]\s*\)$/i.test(expr)) {
      const v = expr.match(/\(([a-zA-Z])\)/)?.[1] || "x";
      return `cos(${v})`;
    }
    if (/^cos\s*\(\s*[a-zA-Z]\s*\)$/i.test(expr)) {
      const v = expr.match(/\(([a-zA-Z])\)/)?.[1] || "x";
      return `-sin(${v})`;
    }
    if (/^e\s*\^\s*[a-zA-Z]$/i.test(expr)) {
      return expr;
    }
    return null;
  };

  fDeriv = computePowerDeriv(f) ?? computeTrigExpDeriv(f);
  gDeriv = computePowerDeriv(g) ?? computeTrigExpDeriv(g);

  // If we can't compute derivatives, skip
  if (!fDeriv || !gDeriv) return null;

  // Product rule: f'g + fg'
  // Check if RHS only has one term (missing the other)

  // Build expected terms
  const term1 = fDeriv === "1" ? g : `${fDeriv} * ${g}`;
  const term2 = gDeriv === "1" ? f : `${f} * ${gDeriv}`;
  const expectedResult = `${term1} + ${term2}`;

  // Normalize RHS for comparison (remove spaces around operators)
  const rhsNorm = rhs.replace(/\s*([*·+-])\s*/g, " $1 ").trim();

  // Check for common product rule errors:
  // 1. Only f'g (missing fg')
  // 2. Only fg' (missing f'g)
  // 3. f' * g' (multiplied derivatives instead of product rule)

  // Check if RHS is f' * g' (common mistake: differentiate each separately and multiply)
  const isFPrimeGPrime =
    !rhsNorm.includes("+") &&
    rhsNorm.includes(fDeriv) &&
    rhsNorm.includes(gDeriv) &&
    !rhsNorm.includes(f) &&
    !rhsNorm.includes(g);

  if (isFPrimeGPrime) {
    return {
      type: "product_rule_error",
      stepNumber: 0,
      confidence: 0.9,
      found: rhs,
      expected: expectedResult,
      explanation: `Product rule error. You cannot differentiate each factor separately and multiply. Use the product rule: (fg)' = f'g + fg'.`,
      suggestion: `d/dx (${f} · ${g}) = (${fDeriv})·(${g}) + (${f})·(${gDeriv}) = ${term1} + ${term2}. You computed ${fDeriv} · ${gDeriv} = ${rhs}, which is wrong.`,
      suggestedFix: `${lhs} = ${expectedResult}`,
    };
  }

  // Check if RHS contains only one of the terms (approximately)
  const hasOnlyTerm1 =
    !rhsNorm.includes("+") &&
    (rhsNorm.includes(fDeriv) || fDeriv === "1") &&
    !rhsNorm.includes(gDeriv);
  const hasOnlyTerm2 =
    !rhsNorm.includes("+") &&
    !rhsNorm.includes(fDeriv) &&
    (rhsNorm.includes(gDeriv) || gDeriv === "1");

  if (hasOnlyTerm1) {
    return {
      type: "product_rule_error",
      stepNumber: 0,
      confidence: 0.85,
      found: rhs,
      expected: expectedResult,
      explanation: `Product rule error. When differentiating f·g, you need both f'·g AND f·g'.`,
      suggestion: `d/dx (${f} · ${g}) = (${fDeriv})·(${g}) + (${f})·(${gDeriv}) = ${term1} + ${term2}. You're missing the ${term2} term.`,
      suggestedFix: `${lhs} = ${expectedResult}`,
    };
  }

  if (hasOnlyTerm2) {
    return {
      type: "product_rule_error",
      stepNumber: 0,
      confidence: 0.85,
      found: rhs,
      expected: expectedResult,
      explanation: `Product rule error. When differentiating f·g, you need both f'·g AND f·g'.`,
      suggestion: `d/dx (${f} · ${g}) = (${fDeriv})·(${g}) + (${f})·(${gDeriv}) = ${term1} + ${term2}. You're missing the ${term1} term.`,
      suggestedFix: `${lhs} = ${expectedResult}`,
    };
  }

  return null;
}

/**
 * Check if an AST node contains a specific pattern
 * @internal
 */
function containsPattern(node: ASTNode, predicate: (n: ASTNode) => boolean): boolean {
  if (predicate(node)) return true;
  switch (node.type) {
    case "number":
    case "variable":
      return false;
    case "unary":
      return containsPattern(node.operand, predicate);
    case "binary":
      return containsPattern(node.left, predicate) || containsPattern(node.right, predicate);
  }
}

/**
 * Check if node is a binary operation with given operator
 * @internal
 */
function isBinaryOp(node: ASTNode, op: string): node is BinaryNode {
  if (node.type !== "binary") return false;
  const normalized =
    node.operator === "−"
      ? "-"
      : node.operator === "×" || node.operator === "·"
        ? "*"
        : node.operator === "÷"
          ? "/"
          : node.operator;
  return normalized === op;
}

/**
 * Check if two AST nodes are structurally equal
 * @internal
 */
function nodesEqual(a: ASTNode, b: ASTNode): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "number":
      return a.value === (b as typeof a).value;
    case "variable":
      return a.name === (b as typeof a).name;
    case "unary":
      return (
        a.operator === (b as typeof a).operator && nodesEqual(a.operand, (b as typeof a).operand)
      );
    case "binary":
      return (
        a.operator === (b as typeof a).operator &&
        nodesEqual(a.left, (b as typeof a).left) &&
        nodesEqual(a.right, (b as typeof a).right)
      );
  }
}

/** Pattern for transformation suggestions */
interface TransformPattern {
  name: string;
  description: string;
  priority: number;
  applies: (ast: ASTNode) => boolean;
}

/** Transformation patterns in priority order */
const TRANSFORM_PATTERNS: TransformPattern[] = [
  // Constant folding (highest priority - immediate simplification)
  {
    name: "constant_fold",
    description: "Evaluate numeric operations",
    priority: 100,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (n.type !== "binary" || n.left.type !== "number" || n.right.type !== "number") {
          return false;
        }
        // Exclude 0^0 (indeterminate)
        if (normalizeOperator(n.operator) === "^" && n.left.value === 0 && n.right.value === 0) {
          return false;
        }
        return true;
      }),
  },

  // Identity elimination
  {
    name: "add_zero",
    description: "Remove addition of zero (x + 0 = x)",
    priority: 90,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "+")) return false;
        const bn = n as BinaryNode;
        return (
          (bn.left.type === "number" && bn.left.value === 0) ||
          (bn.right.type === "number" && bn.right.value === 0)
        );
      }),
  },
  {
    name: "multiply_one",
    description: "Remove multiplication by one (x * 1 = x)",
    priority: 90,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "*")) return false;
        const bn = n as BinaryNode;
        return (
          (bn.left.type === "number" && bn.left.value === 1) ||
          (bn.right.type === "number" && bn.right.value === 1)
        );
      }),
  },
  {
    name: "multiply_zero",
    description: "Simplify multiplication by zero (x * 0 = 0)",
    priority: 90,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "*")) return false;
        const bn = n as BinaryNode;
        return (
          (bn.left.type === "number" && bn.left.value === 0) ||
          (bn.right.type === "number" && bn.right.value === 0)
        );
      }),
  },
  {
    name: "power_one",
    description: "Remove exponent of one (x^1 = x)",
    priority: 90,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "^")) return false;
        const bn = n as BinaryNode;
        return bn.right.type === "number" && bn.right.value === 1;
      }),
  },
  {
    name: "power_zero",
    description: "Simplify exponent of zero (x^0 = 1, except 0^0)",
    priority: 90,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "^")) return false;
        const bn = n as BinaryNode;
        // x^0 where x is not 0
        if (bn.right.type === "number" && bn.right.value === 0) {
          // Exclude 0^0 (indeterminate)
          if (bn.left.type === "number" && bn.left.value === 0) return false;
          return true;
        }
        return false;
      }),
  },
  {
    name: "indeterminate_zero_power_zero",
    description: "Warning: 0^0 is indeterminate",
    priority: 95, // Higher priority to catch before other transformations
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "^")) return false;
        const bn = n as BinaryNode;
        return (
          bn.left.type === "number" &&
          bn.left.value === 0 &&
          bn.right.type === "number" &&
          bn.right.value === 0
        );
      }),
  },
  {
    name: "base_one",
    description: "Simplify base of one (1^x = 1, (1^a)^b = 1)",
    priority: 90,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "^")) return false;
        const bn = n as BinaryNode;
        // Direct: 1^x
        if (bn.left.type === "number" && bn.left.value === 1) return true;
        // Nested: (1^a)^b where inner base is 1
        if (
          bn.left.type === "binary" &&
          normalizeOperator(bn.left.operator) === "^" &&
          bn.left.left.type === "number" &&
          bn.left.left.value === 1
        ) {
          return true;
        }
        return false;
      }),
  },

  // Self-cancellation
  {
    name: "subtract_self",
    description: "Simplify self-subtraction (x - x = 0)",
    priority: 85,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "-")) return false;
        const bn = n as BinaryNode;
        return nodesEqual(bn.left, bn.right);
      }),
  },
  {
    name: "divide_self",
    description: "Simplify self-division (x / x = 1)",
    priority: 85,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "/")) return false;
        const bn = n as BinaryNode;
        return nodesEqual(bn.left, bn.right);
      }),
  },

  // Combine like terms
  {
    name: "combine_like_terms",
    description: "Combine like terms (x + x = 2x, ax + bx = (a+b)x)",
    priority: 70,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "+")) return false;
        const bn = n as BinaryNode;
        // x + x pattern
        if (nodesEqual(bn.left, bn.right)) return true;
        // ax + bx pattern (coefficient * same base)
        if (
          bn.left.type === "binary" &&
          bn.right.type === "binary" &&
          isBinaryOp(bn.left, "*") &&
          isBinaryOp(bn.right, "*")
        ) {
          const leftBin = bn.left as BinaryNode;
          const rightBin = bn.right as BinaryNode;
          return nodesEqual(leftBin.right, rightBin.right);
        }
        return false;
      }),
  },

  // Distributive law expansion
  {
    name: "distribute",
    description: "Apply distributive law (a(b + c) = ab + ac)",
    priority: 60,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "*")) return false;
        const bn = n as BinaryNode;
        return (
          isBinaryOp(bn.left, "+") ||
          isBinaryOp(bn.left, "-") ||
          isBinaryOp(bn.right, "+") ||
          isBinaryOp(bn.right, "-")
        );
      }),
  },

  // Factor common terms
  {
    name: "factor_common",
    description: "Factor out common terms (ab + ac = a(b + c))",
    priority: 55,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "+") && !isBinaryOp(n, "-")) return false;
        const bn = n as BinaryNode;
        // Check if both sides share a common factor
        // Simple check: both are multiplications with a shared operand
        if (bn.left.type === "binary" && bn.right.type === "binary") {
          if (isBinaryOp(bn.left, "*") && isBinaryOp(bn.right, "*")) {
            const leftBin = bn.left as BinaryNode;
            const rightBin = bn.right as BinaryNode;
            return (
              nodesEqual(leftBin.left, rightBin.left) ||
              nodesEqual(leftBin.left, rightBin.right) ||
              nodesEqual(leftBin.right, rightBin.left) ||
              nodesEqual(leftBin.right, rightBin.right)
            );
          }
        }
        return false;
      }),
  },

  // Double negation
  {
    name: "double_negation",
    description: "Remove double negation (--x = x)",
    priority: 80,
    applies: (ast) =>
      containsPattern(
        ast,
        (n) =>
          n.type === "unary" &&
          (n.operator === "-" || n.operator === "−") &&
          n.operand.type === "unary" &&
          (n.operand.operator === "-" || n.operand.operator === "−"),
      ),
  },

  // Fraction simplification
  {
    name: "simplify_fraction",
    description: "Simplify fraction (reduce common factors)",
    priority: 50,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "/")) return false;
        const bn = n as BinaryNode;
        return (
          bn.left.type === "number" &&
          bn.right.type === "number" &&
          bn.right.value !== 0 &&
          gcd(Math.abs(bn.left.value), Math.abs(bn.right.value)) > 1
        );
      }),
  },

  // Power rules
  {
    name: "power_of_power",
    description: "Simplify power of power ((x^a)^b = x^(a*b))",
    priority: 45,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "^")) return false;
        const bn = n as BinaryNode;
        return isBinaryOp(bn.left, "^");
      }),
  },
  {
    name: "multiply_powers",
    description: "Combine powers with same base (x^a * x^b = x^(a+b))",
    priority: 45,
    applies: (ast) =>
      containsPattern(ast, (n) => {
        if (!isBinaryOp(n, "*")) return false;
        const bn = n as BinaryNode;
        const leftIsPower = isBinaryOp(bn.left, "^");
        const rightIsPower = isBinaryOp(bn.right, "^");
        if (leftIsPower && rightIsPower) {
          const leftBin = bn.left as BinaryNode;
          const rightBin = bn.right as BinaryNode;
          return nodesEqual(leftBin.left, rightBin.left);
        }
        // x * x^a or x^a * x
        if (leftIsPower) {
          const leftBin = bn.left as BinaryNode;
          return nodesEqual(leftBin.left, bn.right);
        }
        if (rightIsPower) {
          const rightBin = bn.right as BinaryNode;
          return nodesEqual(rightBin.left, bn.left);
        }
        return false;
      }),
  },
];

/**
 * Greatest common divisor (for fraction simplification check)
 * @internal
 */
function gcd(a: number, b: number): number {
  a = Math.abs(Math.floor(a));
  b = Math.abs(Math.floor(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
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
 *
 * @example
 * suggestNextStep([{ lhs: "x + x", rhs: "x + x" }])
 * // Returns: { hasSuggestion: true, transformation: "combine_like_terms",
 * //           description: "Combine like terms (x + x = 2x)" }
 *
 * @example
 * suggestNextStep([{ lhs: "x * 1", rhs: "x * 1" }])
 * // Returns: { hasSuggestion: true, transformation: "multiply_one",
 * //           description: "Remove multiplication by one (x * 1 = x)" }
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

// =============================================================================
// DERIVATION ERROR EXPLANATION
// =============================================================================

/** Human-readable explanation of a derivation error */
export interface DerivationErrorExplanation {
  /** Short summary of the error */
  summary: string;
  /** Detailed explanation suitable for display */
  explanation: string;
  /** The problematic step (1-indexed) */
  stepNumber: number;
  /** What was expected */
  expected?: string;
  /** What was found */
  found?: string;
  /** Specific suggestions to fix the error */
  fixSuggestions: string[];
}

/**
 * Generate a human-readable explanation for a derivation verification error
 *
 * Analyzes the DerivationResult and produces clear, actionable feedback
 * about what went wrong and how to fix it.
 *
 * @param result The DerivationResult from verifyDerivationSteps
 * @returns DerivationErrorExplanation with detailed feedback, or null if valid
 *
 * @example
 * const result = verifyDerivationSteps([
 *   { lhs: "x + x", rhs: "2x" },
 *   { lhs: "2x", rhs: "3x" }  // Invalid!
 * ]);
 * const explanation = explainDerivationError(result);
 * // Returns: {
 * //   summary: "Invalid algebraic transformation at step 2",
 * //   explanation: "The expression '2x' cannot be transformed to '3x'...",
 * //   stepNumber: 2,
 * //   expected: "2x",
 * //   found: "3x",
 * //   fixSuggestions: ["Check if you meant '2x = 2x'", ...]
 * // }
 */
export function explainDerivationError(
  result: DerivationResult,
): DerivationErrorExplanation | null {
  // No error to explain if derivation is valid
  if (result.valid) {
    return null;
  }

  const invalidStep = result.invalidStep ?? 1;
  const errorStep = result.steps.find((s) => !s.valid);

  if (!errorStep) {
    // Generic error (no steps found, etc.)
    return {
      summary: result.error ?? "Derivation verification failed",
      explanation:
        result.error ??
        "The derivation could not be verified. Ensure each step follows logically from the previous.",
      stepNumber: 0,
      fixSuggestions: [
        "Check that the derivation contains valid mathematical expressions",
        "Ensure each line follows the format 'expression = expression'",
        "Verify that equals signs (=) are used correctly",
      ],
    };
  }

  const { lhs, rhs, error } = errorStep;

  // Determine error type and generate appropriate explanation
  const isDiscontinuity = error?.includes("doesn't follow") || error?.includes("Discontinuity");

  if (isDiscontinuity) {
    // Continuity error: previous RHS doesn't match current LHS
    return {
      summary: `Derivation breaks at step ${invalidStep}`,
      explanation:
        `Step ${invalidStep} doesn't follow from the previous step. ` +
        `The left side of step ${invalidStep} ('${lhs}') should equal the right side of step ${invalidStep - 1}. ` +
        `Each step must connect to the previous step to form a valid chain.`,
      stepNumber: invalidStep,
      expected: `Continue from previous result`,
      found: lhs,
      fixSuggestions: [
        `Ensure step ${invalidStep} starts with the result from step ${invalidStep - 1}`,
        `Check for typos or missing intermediate steps`,
        `If changing variables, show the substitution explicitly`,
      ],
    };
  }

  // Equivalence error: LHS and RHS of the same step are not equivalent
  return {
    summary: `Invalid algebraic transformation at step ${invalidStep}`,
    explanation:
      `The expression '${lhs}' is not algebraically equivalent to '${rhs}'. ` +
      `This transformation cannot be justified by standard algebraic rules. ` +
      `The two expressions evaluate to different values.`,
    stepNumber: invalidStep,
    expected: lhs,
    found: rhs,
    fixSuggestions: [
      `Verify the algebraic manipulation from '${lhs}' to '${rhs}'`,
      `Check for sign errors or incorrect coefficient handling`,
      `Consider adding intermediate steps to make the transformation clearer`,
      `If this is a substitution, ensure the substituted value is correct`,
    ],
  };
}

// =============================================================================
// LATEX CONVERSION
// =============================================================================

/** Options for LaTeX derivation formatting */
export interface DerivationLatexOptions {
  /** Use align environment for multi-step (default: true) */
  useAlign?: boolean;
  /** Add step numbers as comments (default: false) */
  showStepNumbers?: boolean;
  /** Include "therefore" symbol before final step (default: false) */
  showTherefore?: boolean;
  /** Custom label for the derivation (default: none) */
  label?: string;
}

/**
 * Convert a derivation chain to LaTeX format with aligned equations
 *
 * Produces LaTeX code suitable for mathematical documents with proper
 * alignment of equals signs and optional step numbering.
 *
 * @param steps Array of {lhs, rhs} pairs representing the derivation
 * @param options Formatting options
 * @returns LaTeX string
 *
 * @example
 * derivationToLatex([
 *   { lhs: "x + x", rhs: "2x" },
 *   { lhs: "2x", rhs: "2 * x" }
 * ])
 * // Returns:
 * // \begin{align}
 * //   x + x &= 2x \\
 * //   &= 2 \cdot x
 * // \end{align}
 *
 * @example
 * derivationToLatex([{ lhs: "a^2", rhs: "a * a" }], { showStepNumbers: true })
 * // Returns:
 * // \begin{align}
 * //   a^{2} &= a \cdot a && \text{(1)}
 * // \end{align}
 */
export function derivationToLatex(
  steps: Array<{ lhs: string; rhs: string }>,
  options: DerivationLatexOptions = {},
): string {
  const { useAlign = true, showStepNumbers = false, showTherefore = false, label } = options;

  if (steps.length === 0) {
    return "";
  }

  // Convert expression to LaTeX
  const toLatex = (expr: string): string => {
    let result = expr;

    // Convert multiplication: * or · → \cdot
    result = result.replace(/\s*[*·×]\s*/g, " \\cdot ");

    // Convert division: ÷ → \div (or could use \frac)
    result = result.replace(/\s*÷\s*/g, " \\div ");

    // Convert powers: x^2 → x^{2}, x^10 → x^{10}
    result = result.replace(/\^(\d+)/g, "^{$1}");
    result = result.replace(/\^([a-zA-Z])/g, "^{$1}");

    // Convert sqrt: sqrt(x) → \sqrt{x}
    result = result.replace(/sqrt\(([^)]+)\)/gi, "\\sqrt{$1}");

    // Convert common functions
    result = result.replace(/\b(sin|cos|tan|log|ln|exp)\b/g, "\\$1");

    // Convert pi → \pi
    result = result.replace(/\bpi\b/gi, "\\pi");

    // Convert fractions: a/b → \frac{a}{b} (simple cases only)
    result = result.replace(/(\d+)\s*\/\s*(\d+)/g, "\\frac{$1}{$2}");

    // Handle minus signs for better rendering
    result = result.replace(/−/g, "-");

    return result;
  };

  const lines: string[] = [];

  if (useAlign) {
    const envStart = label ? `\\begin{align}\\label{${label}}` : "\\begin{align}";
    lines.push(envStart);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      const isFirst = i === 0;
      const isLast = i === steps.length - 1;

      const lhsLatex = toLatex(step.lhs);
      const rhsLatex = toLatex(step.rhs);

      let line: string;

      if (isFirst) {
        // First line shows full equation
        line = `  ${lhsLatex} &= ${rhsLatex}`;
      } else {
        // Subsequent lines only show RHS (aligned at =)
        if (showTherefore && isLast) {
          line = `  &\\therefore ${rhsLatex}`;
        } else {
          line = `  &= ${rhsLatex}`;
        }
      }

      // Add step number comment
      if (showStepNumbers) {
        line += ` && \\text{(${i + 1})}`;
      }

      // Add line continuation (except last line)
      if (!isLast) {
        line += " \\\\";
      }

      lines.push(line);
    }

    lines.push("\\end{align}");
  } else {
    // Simple equation environment (no alignment)
    const allExprs = steps.map((s) => `${toLatex(s.lhs)} = ${toLatex(s.rhs)}`);
    lines.push("\\begin{equation}");
    lines.push(`  ${allExprs.join(" = ")}`);
    lines.push("\\end{equation}");
  }

  return lines.join("\n");
}

/**
 * Convert text containing a derivation to LaTeX
 *
 * @param text Text containing a derivation
 * @param options Formatting options
 * @returns LaTeX string or null if no derivation found
 */
export function derivationTextToLatex(
  text: string,
  options: DerivationLatexOptions = {},
): string | null {
  const steps = extractDerivationSteps(text);
  if (steps.length === 0) {
    return null;
  }
  return derivationToLatex(steps, options);
}

// =============================================================================
// SIMPLIFICATION PATH
// =============================================================================

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
 * Apply a single transformation to an AST and return the result
 * @internal
 */
function applyTransformation(
  ast: ASTNode,
  transformName: string,
): { transformed: ASTNode; applied: boolean } {
  // Deep clone the AST to avoid mutation
  const clone = JSON.parse(JSON.stringify(ast)) as ASTNode;

  let applied = false;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AST transformation requires exhaustive pattern matching
  const transform = (node: ASTNode): ASTNode => {
    if (applied) return node; // Only apply once per call

    switch (node.type) {
      case "number":
      case "variable":
        return node;

      case "unary": {
        // Handle double negation
        if (
          transformName === "double_negation" &&
          node.operator === "-" &&
          node.operand.type === "unary" &&
          node.operand.operator === "-"
        ) {
          applied = true;
          return node.operand.operand;
        }
        return { ...node, operand: transform(node.operand) };
      }

      case "binary": {
        const op = normalizeOperator(node.operator);

        // Constant folding
        if (
          transformName === "constant_fold" &&
          node.left.type === "number" &&
          node.right.type === "number"
        ) {
          const l = node.left.value;
          const r = node.right.value;
          let result: number | null = null;

          switch (op) {
            case "+":
              result = l + r;
              break;
            case "-":
              result = l - r;
              break;
            case "*":
              result = l * r;
              break;
            case "/":
              if (r !== 0) result = l / r;
              break;
            case "^":
              // Skip 0^0 - it's indeterminate
              if (l === 0 && r === 0) {
                result = null;
              } else {
                result = l ** r;
              }
              break;
          }

          if (result !== null && Number.isFinite(result)) {
            applied = true;
            return { type: "number", value: result };
          }
        }

        // Add zero: x + 0 = x or 0 + x = x
        if (transformName === "add_zero" && op === "+") {
          if (node.right.type === "number" && node.right.value === 0) {
            applied = true;
            return node.left;
          }
          if (node.left.type === "number" && node.left.value === 0) {
            applied = true;
            return node.right;
          }
        }

        // Multiply one: x * 1 = x or 1 * x = x
        if (transformName === "multiply_one" && op === "*") {
          if (node.right.type === "number" && node.right.value === 1) {
            applied = true;
            return node.left;
          }
          if (node.left.type === "number" && node.left.value === 1) {
            applied = true;
            return node.right;
          }
        }

        // Multiply zero: x * 0 = 0 or 0 * x = 0
        if (transformName === "multiply_zero" && op === "*") {
          if (
            (node.right.type === "number" && node.right.value === 0) ||
            (node.left.type === "number" && node.left.value === 0)
          ) {
            applied = true;
            return { type: "number", value: 0 };
          }
        }

        // Power one: x^1 = x
        if (transformName === "power_one" && op === "^") {
          if (node.right.type === "number" && node.right.value === 1) {
            applied = true;
            return node.left;
          }
        }

        // Power zero: x^0 = 1 (except 0^0 which is indeterminate)
        if (transformName === "power_zero" && op === "^") {
          if (node.right.type === "number" && node.right.value === 0) {
            // Skip 0^0 - it's indeterminate
            if (node.left.type === "number" && node.left.value === 0) {
              return { ...node, left: transform(node.left), right: transform(node.right) };
            }
            applied = true;
            return { type: "number", value: 1 };
          }
        }

        // Indeterminate form: 0^0 - cannot simplify
        // Returns applied=false so suggestSimplificationPath knows to stop
        if (transformName === "indeterminate_zero_power_zero" && op === "^") {
          if (
            node.left.type === "number" &&
            node.left.value === 0 &&
            node.right.type === "number" &&
            node.right.value === 0
          ) {
            // Don't set applied=true - this is a terminal state, not a transformation
            return node;
          }
        }

        // Base one: 1^x = 1, also handles nested (1^a)^b = 1
        if (transformName === "base_one" && op === "^") {
          // Direct case: 1^x = 1
          if (node.left.type === "number" && node.left.value === 1) {
            applied = true;
            return { type: "number", value: 1 };
          }
          // Nested case: (1^a)^b = 1 (base is a power with base 1)
          if (
            node.left.type === "binary" &&
            normalizeOperator(node.left.operator) === "^" &&
            node.left.left.type === "number" &&
            node.left.left.value === 1
          ) {
            applied = true;
            return { type: "number", value: 1 };
          }
        }

        // Subtract self: x - x = 0
        if (transformName === "subtract_self" && op === "-") {
          if (nodesEqual(node.left, node.right)) {
            applied = true;
            return { type: "number", value: 0 };
          }
        }

        // Divide self: x / x = 1
        if (transformName === "divide_self" && op === "/") {
          if (nodesEqual(node.left, node.right)) {
            applied = true;
            return { type: "number", value: 1 };
          }
        }

        // Combine like terms: x + x = 2x
        if (transformName === "combine_like_terms" && op === "+") {
          if (nodesEqual(node.left, node.right)) {
            applied = true;
            return {
              type: "binary",
              operator: "*",
              left: { type: "number", value: 2 },
              right: node.left,
            };
          }
        }

        // Simplify fraction: 4/2 = 2
        if (
          transformName === "simplify_fraction" &&
          op === "/" &&
          node.left.type === "number" &&
          node.right.type === "number"
        ) {
          const num = node.left.value;
          const den = node.right.value;
          if (den !== 0 && num % den === 0) {
            applied = true;
            return { type: "number", value: num / den };
          }
        }

        // Recurse into children
        return {
          ...node,
          left: transform(node.left),
          right: transform(node.right),
        };
      }
    }
  };

  const result = transform(clone);
  return { transformed: result, applied };
}

/**
 * Normalize operator symbols
 * @internal
 */
function normalizeOperator(op: string): string {
  if (op === "−") return "-";
  if (op === "×" || op === "·") return "*";
  if (op === "÷") return "/";
  return op;
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
 *
 * @example
 * suggestSimplificationPath("(x + 0) * 1")
 * // Returns: {
 * //   success: true,
 * //   original: "(x + 0) * 1",
 * //   simplified: "x",
 * //   steps: [
 * //     { step: 1, transformation: "add_zero", before: "(x + 0) * 1", after: "x * 1" },
 * //     { step: 2, transformation: "multiply_one", before: "x * 1", after: "x" }
 * //   ],
 * //   isFullySimplified: true,
 * //   transformationCount: 2
 * // }
 *
 * @example
 * suggestSimplificationPath("2 + 3 * 4")
 * // Returns: {
 * //   success: true,
 * //   original: "2 + 3 * 4",
 * //   simplified: "14",
 * //   steps: [
 * //     { step: 1, transformation: "constant_fold", before: "2 + 3 * 4", after: "2 + 12" },
 * //     { step: 2, transformation: "constant_fold", before: "2 + 12", after: "14" }
 * //   ],
 * //   isFullySimplified: true,
 * //   transformationCount: 2
 * // }
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

// =============================================================================
// COMMON MISTAKE DETECTION
// =============================================================================

/** Types of common algebraic mistakes */
export type MistakeType =
  | "sign_error"
  | "distribution_error"
  | "subtraction_distribution_error"
  | "cancellation_error"
  | "coefficient_error"
  | "exponent_error"
  | "order_of_operations"
  | "fraction_error"
  | "like_terms_error"
  | "power_rule_error"
  | "chain_rule_error"
  | "product_rule_error";

/** A detected common mistake */
export interface DetectedMistake {
  /** Type of mistake */
  type: MistakeType;
  /** Step number where mistake occurred (1-indexed) */
  stepNumber: number;
  /** Confidence that this is the actual mistake (0-1) */
  confidence: number;
  /** What the student wrote */
  found: string;
  /** What was likely intended or correct */
  expected?: string;
  /** Human-readable explanation */
  explanation: string;
  /** Specific fix suggestion */
  suggestion: string;
  /** The corrected derivation step (e.g., "2x + 3x = 5x") */
  suggestedFix?: string;
}

/** Result of mistake detection */
export interface MistakeDetectionResult {
  /** Whether any mistakes were detected */
  hasMistakes: boolean;
  /** List of detected mistakes */
  mistakes: DetectedMistake[];
  /** Overall assessment */
  summary: string;
}

/**
 * Check for sign error: -a + b claimed equal to -(a + b) or similar
 * @internal
 */
function checkSignError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Check if negating the RHS makes it equal to LHS
  const negatedRhs: ASTNode = { type: "unary", operator: "-", operand: rhsAst };
  const negatedRhsStr = formatAST(negatedRhs, { spaces: true, minimalParens: true });

  if (compareExpressions(lhs, negatedRhsStr)) {
    const expectedVal = negatedRhsStr.replace(/^-\(/, "(").replace(/\)$/, ")");
    return {
      type: "sign_error",
      stepNumber: 0, // Will be filled in by caller
      confidence: 0.9,
      found: rhs,
      expected: expectedVal, // Clean up display
      explanation: `Sign error detected. The expression '${rhs}' has the opposite sign of what was expected.`,
      suggestion: "Check your negative signs. Remember that -(a + b) = -a - b, not -a + b.",
      suggestedFix: `${lhs} = ${expectedVal}`,
    };
  }

  // Check for common pattern: a - b written as b - a
  if (lhsAst.type === "binary" && rhsAst.type === "binary") {
    const lhsOp = normalizeOperator(lhsAst.operator);
    const rhsOp = normalizeOperator(rhsAst.operator);

    if (lhsOp === "-" && rhsOp === "-") {
      // Check if operands are swapped
      if (nodesEqual(lhsAst.left, rhsAst.right) && nodesEqual(lhsAst.right, rhsAst.left)) {
        return {
          type: "sign_error",
          stepNumber: 0,
          confidence: 0.95,
          found: rhs,
          expected: lhs,
          explanation: `Operands appear to be swapped in subtraction. Note that a - b ≠ b - a.`,
          suggestion: "Subtraction is not commutative. Check the order of your operands.",
          suggestedFix: `${lhs} = ${lhs}`,
        };
      }
    }
  }

  return null;
}

/**
 * Check for distribution error: a(b + c) ≠ ab + c
 * @internal
 */
function checkDistributionError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Look for pattern: a * (b + c) on LHS
  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "*") {
    const multiplier = lhsAst.left;
    const inner = lhsAst.right;

    if (inner.type === "binary" && (inner.operator === "+" || inner.operator === "-")) {
      // LHS is a * (b ± c), check if RHS only distributed to one term
      // Common error: a(b + c) = ab + c instead of ab + ac

      if (rhsAst.type === "binary" && (rhsAst.operator === "+" || rhsAst.operator === "-")) {
        // Check if one side of RHS matches a*b and other matches just c
        const leftIsProduct =
          rhsAst.left.type === "binary" && normalizeOperator(rhsAst.left.operator) === "*";
        const rightIsProduct =
          rhsAst.right.type === "binary" && normalizeOperator(rhsAst.right.operator) === "*";

        // If only one side is a product, might be incomplete distribution
        if (leftIsProduct !== rightIsProduct) {
          // Check if the non-product side matches one of the inner terms
          const nonProduct = leftIsProduct ? rhsAst.right : rhsAst.left;
          if (nodesEqual(nonProduct, inner.left) || nodesEqual(nonProduct, inner.right)) {
            const mStr = formatAST(multiplier, { spaces: true });
            const innerLeftStr = formatAST(inner.left, { spaces: true });
            const innerRightStr = formatAST(inner.right, { spaces: true });
            const correctRhs = `${mStr}*${innerLeftStr} ${inner.operator} ${mStr}*${innerRightStr}`;
            return {
              type: "distribution_error",
              stepNumber: 0,
              confidence: 0.85,
              found: rhs,
              expected: correctRhs,
              explanation: `Incomplete distribution. When distributing, multiply ALL terms inside the parentheses.`,
              suggestion: `Remember: a(b + c) = ab + ac, not ab + c. Distribute '${mStr}' to both terms.`,
              suggestedFix: `${lhs} = ${correctRhs}`,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check for FOIL error: (x + a)(x + b) = x^2 + ab instead of x^2 + (a+b)x + ab
 * Common error: forgetting the middle terms (Outer + Inner)
 *
 * Handles all four binomial multiplication patterns:
 * - (x + a)(x + b) = x² + (a+b)x + ab
 * - (x - a)(x + b) = x² + (b-a)x - ab
 * - (x + a)(x - b) = x² + (a-b)x - ab
 * - (x - a)(x - b) = x² - (a+b)x + ab
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: FOIL detection requires exhaustive pattern matching for all sign combinations
function checkFOILError(
  _lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Look for pattern: (expr1 ± a) * (expr2 ± b) where expr1 and expr2 share a variable
  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "*") {
    const left = lhsAst.left;
    const right = lhsAst.right;

    // Both factors should be binary + or -
    if (
      left.type === "binary" &&
      right.type === "binary" &&
      (left.operator === "+" || left.operator === "-") &&
      (right.operator === "+" || right.operator === "-")
    ) {
      // We have (A ± B)(C ± D)
      // Full expansion should have 4 terms: A*C, A*D, B*C, B*D
      // Common error: only get A*C and B*D (First and Last, missing Outer and Inner)

      // Track the operators for sign calculations
      const leftOp = normalizeOperator(left.operator); // + or -
      const rightOp = normalizeOperator(right.operator); // + or -

      // Count terms in RHS
      const rhsTerms = flattenAddSubDistributed(rhsAst);

      // If RHS has only 2 terms, might be missing middle terms
      if (rhsTerms.length === 2) {
        // Check if one term looks like a product of the "first" terms
        // and another looks like a product of the "last" terms

        // Extract the four components
        const A = left.left;
        const B = left.right;
        const C = right.left;
        const D = right.right;

        // Expected terms: AC, AD, BC, BD
        // FOIL error typically gives: AC + BD (First and Last only)

        // Check if both A and C contain the same variable (typical case: (x+2)(x+3))
        const aStr = formatAST(A, { spaces: false });
        const cStr = formatAST(C, { spaces: false });

        // If A and C are the same variable (e.g., both "x")
        if (aStr === cStr && A.type === "variable") {
          // This is (x ± b)(x ± d) pattern
          // Sign of middle term depends on the operators

          // Check if RHS matches the error pattern
          const bStr = formatAST(B, { spaces: false });
          const dStr = formatAST(D, { spaces: false });

          // Look for x^2 term and constant term in RHS
          let hasSquaredTerm = false;
          let hasConstantProduct = false;

          for (const term of rhsTerms) {
            // Check for x^2
            if (term.node.type === "binary" && normalizeOperator(term.node.operator) === "^") {
              if (
                nodesEqual(term.node.left, A) &&
                term.node.right.type === "number" &&
                term.node.right.value === 2
              ) {
                hasSquaredTerm = true;
              }
            }
            // Check for constant (number)
            if (term.node.type === "number") {
              hasConstantProduct = true;
            }
            // Check for product of B and D
            if (term.node.type === "binary" && normalizeOperator(term.node.operator) === "*") {
              if (
                (nodesEqual(term.node.left, B) && nodesEqual(term.node.right, D)) ||
                (nodesEqual(term.node.left, D) && nodesEqual(term.node.right, B))
              ) {
                hasConstantProduct = true;
              }
            }
          }

          if (hasSquaredTerm && hasConstantProduct) {
            // Likely missing middle terms
            // Calculate correct middle coefficient based on signs
            // (x + b)(x + d): middle = b + d
            // (x - b)(x + d): middle = d - b
            // (x + b)(x - d): middle = b - d
            // (x - b)(x - d): middle = -(b + d)

            let middleCoeffStr: string;
            let constantSignStr: string;

            if (B.type === "number" && D.type === "number") {
              const bVal = B.value;
              const dVal = D.value;

              // Calculate middle coefficient with signs
              // First factor contributes: leftOp === "+" ? +b : -b to middle
              // Second factor contributes: rightOp === "+" ? +d : -d to middle
              const bContrib = leftOp === "+" ? bVal : -bVal;
              const dContrib = rightOp === "+" ? dVal : -dVal;
              const middleCoeff = bContrib + dContrib;

              // Calculate constant term sign
              // Constant = (sign of b) * (sign of d) * b * d
              const constantSign = (leftOp === "-") !== (rightOp === "-") ? -1 : 1;
              const constantVal = constantSign * bVal * dVal;

              middleCoeffStr =
                middleCoeff >= 0
                  ? `${middleCoeff}`
                  : `(${middleCoeff})`.replace("(", "").replace(")", "-").slice(0, -1);
              // Simplify display
              if (middleCoeff === 0) {
                middleCoeffStr = "0";
              } else if (middleCoeff > 0) {
                middleCoeffStr = `${middleCoeff}`;
              } else {
                middleCoeffStr = `${middleCoeff}`;
              }

              constantSignStr =
                constantVal >= 0 ? `+ ${Math.abs(constantVal)}` : `- ${Math.abs(constantVal)}`;
            } else {
              // Symbolic case - show formula
              if (leftOp === "+" && rightOp === "+") {
                middleCoeffStr = `(${bStr} + ${dStr})`;
                constantSignStr = `+ ${bStr}·${dStr}`;
              } else if (leftOp === "-" && rightOp === "+") {
                middleCoeffStr = `(${dStr} - ${bStr})`;
                constantSignStr = `- ${bStr}·${dStr}`;
              } else if (leftOp === "+" && rightOp === "-") {
                middleCoeffStr = `(${bStr} - ${dStr})`;
                constantSignStr = `- ${bStr}·${dStr}`;
              } else {
                // leftOp === "-" && rightOp === "-"
                middleCoeffStr = `-(${bStr} + ${dStr})`;
                constantSignStr = `+ ${bStr}·${dStr}`;
              }
            }

            // Format the LHS for display
            const leftDisplay = `(${aStr} ${leftOp} ${bStr})`;
            const rightDisplay = `(${cStr} ${rightOp} ${dStr})`;
            const correctRhs = `${aStr}² + ${middleCoeffStr}${aStr} ${constantSignStr}`;

            return {
              type: "distribution_error",
              stepNumber: 0,
              confidence: 0.85,
              found: rhs,
              expected: correctRhs,
              explanation: `Incomplete FOIL expansion. When multiplying ${leftDisplay}${rightDisplay}, you need all four products: First, Outer, Inner, Last.`,
              suggestion: `${leftDisplay}${rightDisplay} = ${correctRhs}. You're missing the middle term ${middleCoeffStr}${aStr}.`,
              suggestedFix: `${leftDisplay}${rightDisplay} = ${correctRhs}`,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Flatten an addition/subtraction expression into terms with signs,
 * properly distributing negatives through nested groups.
 * e.g., a - (b + c) -> [{node: a, positive: true}, {node: b, positive: false}, {node: c, positive: false}]
 * e.g., a - (b - (c + d)) -> [{node: a, positive: true}, {node: b, positive: false}, {node: c, positive: true}, {node: d, positive: true}]
 * @internal
 */
function flattenAddSubDistributed(
  node: ASTNode,
  positive = true,
): Array<{ node: ASTNode; positive: boolean }> {
  if (node.type === "binary" && (node.operator === "+" || node.operator === "-")) {
    // For addition: left and right keep the current sign context
    // For subtraction: left keeps sign, right gets flipped
    const leftTerms = flattenAddSubDistributed(node.left, positive);
    const rightPositive = node.operator === "+" ? positive : !positive;
    const rightTerms = flattenAddSubDistributed(node.right, rightPositive);
    return [...leftTerms, ...rightTerms];
  }
  // Terminal node - return with current sign
  return [{ node, positive }];
}

/**
 * Check for subtraction distribution error: a - (b + c) = a - b + c instead of a - b - c
 * Also handles nested cases like a - (b - (c + d))
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: nested subtraction detection requires deep AST traversal
function checkSubtractionDistributionError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Look for pattern: a - (b + c) or a - (b - c) on LHS
  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "-") {
    const outerLeft = lhsAst.left;
    const innerGroup = lhsAst.right;

    // Check if we're subtracting a parenthesized group (binary +/-)
    if (
      innerGroup.type === "binary" &&
      (innerGroup.operator === "+" || innerGroup.operator === "-")
    ) {
      // LHS is a - (b ± c) or nested like a - (b - (c + d))
      // Flatten both sides with proper negative distribution

      const lhsTerms = flattenAddSubDistributed(lhsAst);
      const rhsTerms = flattenAddSubDistributed(rhsAst);

      // Check if same number of terms (structural match)
      if (lhsTerms.length === rhsTerms.length && lhsTerms.length >= 2) {
        // Check if terms match but signs differ
        let termsMismatch = false;
        let signMismatch = false;
        const signErrors: Array<{ term: string; found: string; expected: string }> = [];

        for (let i = 0; i < lhsTerms.length; i++) {
          const lhsTerm = lhsTerms[i]!;
          const rhsTerm = rhsTerms[i]!;

          if (!nodesEqual(lhsTerm.node, rhsTerm.node)) {
            termsMismatch = true;
            break;
          }
          if (lhsTerm.positive !== rhsTerm.positive) {
            signMismatch = true;
            const termStr = formatAST(lhsTerm.node, { spaces: true, minimalParens: true });
            signErrors.push({
              term: termStr,
              found: rhsTerm.positive ? "+" : "-",
              expected: lhsTerm.positive ? "+" : "-",
            });
          }
        }

        if (!termsMismatch && signMismatch && signErrors.length > 0) {
          const errorDetails = signErrors
            .map((e) => `'${e.term}' has '${e.found}' but should have '${e.expected}'`)
            .join("; ");

          // Check for nested structure
          const hasNestedGroup =
            innerGroup.type === "binary" &&
            (innerGroup.left.type === "binary" || innerGroup.right.type === "binary");
          const nestedNote = hasNestedGroup
            ? " With nested parentheses, distribute the negative through each level."
            : "";

          // Build correct RHS from flattened terms
          const correctTerms = lhsTerms
            .map((t, i) => {
              const termStr = formatAST(t.node, { spaces: true, minimalParens: true });
              if (i === 0) return t.positive ? termStr : `-${termStr}`;
              return t.positive ? ` + ${termStr}` : ` - ${termStr}`;
            })
            .join("");

          return {
            type: "subtraction_distribution_error",
            stepNumber: 0,
            confidence: 0.95,
            found: rhs,
            expected: correctTerms,
            explanation: `Subtraction distribution error. When subtracting a group, distribute the negative to ALL terms inside.${nestedNote}`,
            suggestion: `Sign error: ${errorDetails}. Remember: -(a + b) = -a - b and -(-a) = +a.`,
            suggestedFix: `${lhs} = ${correctTerms}`,
          };
        }
      }

      // Fallback: original simple check for non-nested cases
      if (rhsAst.type === "binary") {
        const innerOp = innerGroup.operator;
        const correctSecondOp = innerOp === "+" ? "-" : "+";
        const foundSecondOp = normalizeOperator(rhsAst.operator);

        // Check if outer term matches - RHS should be ((a - b) ± c) form
        if (rhsAst.left.type === "binary" && normalizeOperator(rhsAst.left.operator) === "-") {
          const rhsOuterLeft = rhsAst.left.left;
          const rhsFirstInner = rhsAst.left.right;
          const rhsSecondInner = rhsAst.right;

          if (
            nodesEqual(outerLeft, rhsOuterLeft) &&
            nodesEqual(innerGroup.left, rhsFirstInner) &&
            nodesEqual(innerGroup.right, rhsSecondInner)
          ) {
            if (foundSecondOp !== correctSecondOp) {
              const wrongSign = foundSecondOp === "+" ? "+" : "-";
              const correctSign = correctSecondOp;
              const outerStr = formatAST(outerLeft, { spaces: true });
              const firstInnerStr = formatAST(innerGroup.left, { spaces: true });
              const secondInnerStr = formatAST(innerGroup.right, { spaces: true });
              const correctRhs = `${outerStr} - ${firstInnerStr} ${correctSign} ${secondInnerStr}`;
              return {
                type: "subtraction_distribution_error",
                stepNumber: 0,
                confidence: 0.95,
                found: rhs,
                expected: correctRhs,
                explanation: `Subtraction distribution error. When subtracting a group, distribute the negative to ALL terms inside.`,
                suggestion: `Remember: a - (b + c) = a - b - c, not a - b + c. The '${wrongSign}' should be '${correctSign}'.`,
                suggestedFix: `${lhs} = ${correctRhs}`,
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check for cancellation error: (a + b)/a ≠ b
 * @internal
 */
function checkCancellationError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Look for pattern: (a + b) / a on LHS
  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "/") {
    const numerator = lhsAst.left;
    const denominator = lhsAst.right;

    if (numerator.type === "binary" && (numerator.operator === "+" || numerator.operator === "-")) {
      // LHS is (a ± b) / c
      // Check if RHS equals just one term from the sum (invalid cancellation)
      if (
        nodesEqual(rhsAst, numerator.left) ||
        nodesEqual(rhsAst, numerator.right) ||
        nodesEqual(rhsAst, denominator)
      ) {
        const aStr = formatAST(numerator.left, { spaces: true });
        const bStr = formatAST(numerator.right, { spaces: true });
        const cStr = formatAST(denominator, { spaces: true });
        const correctRhs = `${aStr}/${cStr} ${numerator.operator} ${bStr}/${cStr}`;
        return {
          type: "cancellation_error",
          stepNumber: 0,
          confidence: 0.8,
          found: rhs,
          expected: correctRhs,
          explanation: `Invalid cancellation. You cannot cancel terms that are being added/subtracted in the numerator with the denominator.`,
          suggestion: `Remember: (a + b)/c ≠ b. You can only cancel common FACTORS, not terms. Try: (a + b)/c = a/c + b/c.`,
          suggestedFix: `${lhs} = ${correctRhs}`,
        };
      }
    }
  }

  return null;
}

/**
 * Check for coefficient error: 2x + 3x = 6x instead of 5x
 * Also handles subtraction: 5x - 2x = 2x instead of 3x
 * @internal
 */
function checkCoefficientError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  _rhsAst: ASTNode | null,
): DetectedMistake | null {
  // Pattern: look for coefficient changes that suggest multiplication instead of addition
  // e.g., 2x + 3x should be 5x, not 6x
  // Also: 5x - 2x should be 3x, not 2x (common error: just taking second coefficient)
  // Also: x + 2x should be 3x (implicit coefficient 1)

  // Extract terms with coefficients and variables, tracking operators
  // Match patterns like "2x", "3y", "-5x", "x" (implicit 1), "-x", including the preceding +/- operator
  // Pattern captures: [sign] [optional coefficient] [variable]
  // Use negative lookahead (?!\^) to avoid matching x in x^2
  const termPattern = /([+-]?)\s*(\d*)([a-zA-Z])(?!\^|\d)/g;

  const lhsTerms: Array<{ coeff: number; variable: string; sign: number }> = [];
  let match: RegExpExecArray | null;
  let isFirst = true;
  while ((match = termPattern.exec(lhs)) !== null) {
    const signStr = match[1] || "";
    // Empty string means implicit coefficient of 1
    const coeffStr = match[2] ?? "";
    const coeff = coeffStr === "" ? 1 : parseInt(coeffStr, 10);
    const variable = match[3]!;
    // First term without explicit sign is positive
    const sign = signStr === "-" ? -1 : 1;
    lhsTerms.push({ coeff, variable, sign: isFirst && signStr === "" ? 1 : sign });
    isFirst = false;
  }

  // Same pattern for RHS - also needs to exclude exponent bases
  const rhsTermPattern = /([+-]?)\s*(\d*)([a-zA-Z])(?!\^|\d)/g;
  const rhsTerms: Array<{ coeff: number; variable: string; sign: number }> = [];
  let rhsFirst = true;
  while ((match = rhsTermPattern.exec(rhs)) !== null) {
    const signStr = match[1] || "";
    const coeffStr = match[2] ?? "";
    const coeff = coeffStr === "" ? 1 : parseInt(coeffStr, 10);
    const variable = match[3]!;
    const sign = signStr === "-" ? -1 : 1;
    rhsTerms.push({ coeff, variable, sign: rhsFirst && signStr === "" ? 1 : sign });
    rhsFirst = false;
  }

  if (lhsTerms.length >= 2 && rhsTerms.length === 1) {
    // LHS has multiple terms with same variable, RHS has one
    const rhsTerm = rhsTerms[0]!;
    const rhsCoeff = rhsTerm.coeff * rhsTerm.sign;
    const rhsVar = rhsTerm.variable;

    // Check if all variables are the same
    if (rhsVar && lhsTerms.every((t) => t.variable === rhsVar)) {
      const lhsCoeffs = lhsTerms.map((t) => t.coeff * t.sign);
      const expectedSum = lhsCoeffs.reduce((a, b) => a + b, 0);

      // Check for multiplication error (2x + 3x = 6x)
      const absCoeffs = lhsTerms.map((t) => t.coeff);
      const possibleProduct = absCoeffs.reduce((a, b) => a * b, 1);

      if (rhsCoeff === possibleProduct && rhsCoeff !== expectedSum) {
        const expectedResult = `${expectedSum}${rhsVar}`;
        return {
          type: "coefficient_error",
          stepNumber: 0,
          confidence: 0.85,
          found: rhs,
          expected: expectedResult,
          explanation: `Coefficient error. When combining like terms, ADD the coefficients, don't multiply them.`,
          suggestion: `${absCoeffs.join(" × ")} = ${possibleProduct}, but you should ADD: ${lhsCoeffs.map((c, i) => (i === 0 ? c : c >= 0 ? `+ ${c}` : `- ${Math.abs(c)}`)).join(" ")} = ${expectedSum}. So the answer should be ${expectedSum}${rhsVar}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }

      // Check for "took wrong coefficient" error (5x - 2x = 2x instead of 3x)
      // Common error: result equals one of the original coefficients instead of sum
      if (rhsCoeff !== expectedSum && absCoeffs.includes(Math.abs(rhsCoeff))) {
        const expectedResult = `${expectedSum}${rhsVar}`;
        return {
          type: "coefficient_error",
          stepNumber: 0,
          confidence: 0.8,
          found: rhs,
          expected: expectedResult,
          explanation: `Coefficient error. The result ${rhsCoeff}${rhsVar} is one of the original coefficients, not the combined result.`,
          suggestion: `When combining like terms: ${lhsTerms.map((t, i) => (i === 0 ? `${t.coeff}${t.variable}` : `${t.sign >= 0 ? "+" : "-"} ${t.coeff}${t.variable}`)).join(" ")} = ${expectedSum}${rhsVar}, not ${rhsCoeff}${rhsVar}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }

      // General coefficient mismatch
      if (rhsCoeff !== expectedSum && Math.abs(rhsCoeff - expectedSum) <= Math.max(...absCoeffs)) {
        const expectedResult = `${expectedSum}${rhsVar}`;
        return {
          type: "coefficient_error",
          stepNumber: 0,
          confidence: 0.75,
          found: rhs,
          expected: expectedResult,
          explanation: `Coefficient error when combining like terms.`,
          suggestion: `${lhsTerms.map((t, i) => (i === 0 ? `${t.coeff}${t.variable}` : `${t.sign >= 0 ? "+" : "-"} ${t.coeff}${t.variable}`)).join(" ")} = ${expectedSum}${rhsVar}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }
    }
  }

  return null;
}

/**
 * Check for exponent error: x^2 * x^3 = x^6 instead of x^5
 * @internal
 */
function checkExponentError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Look for pattern: x^a * x^b on LHS
  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "*") {
    const left = lhsAst.left;
    const right = lhsAst.right;

    if (
      left.type === "binary" &&
      right.type === "binary" &&
      normalizeOperator(left.operator) === "^" &&
      normalizeOperator(right.operator) === "^"
    ) {
      // Both sides are powers
      if (nodesEqual(left.left, right.left)) {
        // Same base
        if (
          left.right.type === "number" &&
          right.right.type === "number" &&
          rhsAst.type === "binary" &&
          normalizeOperator(rhsAst.operator) === "^" &&
          rhsAst.right.type === "number"
        ) {
          const exp1 = left.right.value;
          const exp2 = right.right.value;
          const resultExp = rhsAst.right.value;
          const expectedSum = exp1 + exp2;
          const possibleProduct = exp1 * exp2;

          if (resultExp === possibleProduct && resultExp !== expectedSum) {
            const baseStr = formatAST(left.left, { spaces: false });
            const expectedResult = `${baseStr}^${expectedSum}`;
            return {
              type: "exponent_error",
              stepNumber: 0,
              confidence: 0.9,
              found: rhs,
              expected: expectedResult,
              explanation: `Exponent error. When multiplying powers with the same base, ADD the exponents.`,
              suggestion: `${baseStr}^${exp1} × ${baseStr}^${exp2} = ${baseStr}^(${exp1}+${exp2}) = ${baseStr}^${expectedSum}, not ${baseStr}^${possibleProduct}.`,
              suggestedFix: `${lhs} = ${expectedResult}`,
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Check for power rule derivative error: d/dx of x^n = nx^n instead of nx^(n-1)
 * Common error: forgetting to subtract 1 from the exponent
 *
 * Patterns detected:
 * - "d/dx x^3 = 3x^3" (should be 3x^2)
 * - "derivative of x^4 = 4x^4" (should be 4x^3)
 *
 * @internal
 */
function checkPowerRuleError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  // Look for derivative notation in LHS
  const derivativePattern = /(?:d\/dx|derivative\s+of|diff(?:erentiate)?)\s*(?:of\s+)?(\w)\^(\d+)/i;
  const match = lhs.match(derivativePattern);

  if (!match) return null;

  const variable = match[1]!;
  const originalExp = parseInt(match[2]!, 10);

  // Expected: coefficient = originalExp, new exponent = originalExp - 1
  const expectedCoeff = originalExp;
  const expectedExp = originalExp - 1;

  // Parse RHS to check the result
  // Look for pattern like "3x^3" or "4x^4"
  const resultPattern = new RegExp(`(\\d+)${variable}\\^(\\d+)`, "i");
  const resultMatch = rhs.match(resultPattern);

  if (resultMatch) {
    const resultCoeff = parseInt(resultMatch[1]!, 10);
    const resultExp = parseInt(resultMatch[2]!, 10);

    // Check for the common error: nx^n instead of nx^(n-1)
    if (resultCoeff === expectedCoeff && resultExp === originalExp) {
      const expectedResult = `${expectedCoeff}${variable}^${expectedExp}`;
      return {
        type: "power_rule_error",
        stepNumber: 0,
        confidence: 0.95,
        found: rhs,
        expected: expectedResult,
        explanation: `Power rule error. When differentiating x^n, the exponent decreases by 1.`,
        suggestion: `d/dx of ${variable}^${originalExp} = ${originalExp}·${variable}^(${originalExp}-1) = ${expectedCoeff}${variable}^${expectedExp}, not ${resultCoeff}${variable}^${resultExp}.`,
        suggestedFix: `${lhs} = ${expectedResult}`,
      };
    }

    // Also check for forgetting the coefficient entirely: x^n -> x^(n-1)
    if (resultCoeff === 1 && resultExp === expectedExp) {
      // Check if the rhs is just "x^2" without coefficient (when original was x^3)
      const noCoeffPattern = new RegExp(`^${variable}\\^${expectedExp}$`, "i");
      if (noCoeffPattern.test(rhs.trim())) {
        const expectedResult = `${expectedCoeff}${variable}^${expectedExp}`;
        return {
          type: "power_rule_error",
          stepNumber: 0,
          confidence: 0.85,
          found: rhs,
          expected: expectedResult,
          explanation: `Power rule error. Don't forget to multiply by the original exponent.`,
          suggestion: `d/dx of ${variable}^${originalExp} = ${originalExp}·${variable}^(${originalExp}-1) = ${expectedCoeff}${variable}^${expectedExp}. You got the exponent right but forgot the coefficient ${originalExp}.`,
          suggestedFix: `${lhs} = ${expectedResult}`,
        };
      }
    }
  }

  // Also check for just the variable without exponent in RHS (for x^2 -> 2x case)
  if (originalExp === 2 && rhsAst?.type === "variable") {
    // d/dx x^2 = x (missing coefficient 2)
    const expectedResult = `2${variable}`;
    return {
      type: "power_rule_error",
      stepNumber: 0,
      confidence: 0.8,
      found: rhs,
      expected: expectedResult,
      explanation: `Power rule error. Don't forget to multiply by the original exponent.`,
      suggestion: `d/dx of ${variable}^2 = 2·${variable}^(2-1) = 2${variable}, not just ${variable}.`,
      suggestedFix: `${lhs} = ${expectedResult}`,
    };
  }

  return null;
}

/**
 * Check for fraction addition error: 1/2 + 1/3 = 2/5 instead of 5/6
 * Common error: adding numerators and denominators separately
 *
 * Patterns detected:
 * - "1/2 + 1/3 = 2/5" (should be 5/6)
 * - "a/b + c/d = (a+c)/(b+d)" (wrong!)
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fraction error detection requires extensive numeric and symbolic pattern matching
function checkFractionAdditionError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  // Look for pattern: a/b + c/d on LHS
  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "+") {
    const left = lhsAst.left;
    const right = lhsAst.right;

    // Both operands should be fractions (divisions)
    if (
      left.type === "binary" &&
      right.type === "binary" &&
      normalizeOperator(left.operator) === "/" &&
      normalizeOperator(right.operator) === "/"
    ) {
      // We have (a/b) + (c/d)
      const a = left.left;
      const b = left.right;
      const c = right.left;
      const d = right.right;

      // Check if RHS is also a fraction
      if (rhsAst.type === "binary" && normalizeOperator(rhsAst.operator) === "/") {
        const resultNum = rhsAst.left;
        const resultDen = rhsAst.right;

        // Check for the common error: (a+c)/(b+d)
        // This would mean numerator = a + c and denominator = b + d

        // For numeric case, check if they just added num/den separately
        if (
          a.type === "number" &&
          b.type === "number" &&
          c.type === "number" &&
          d.type === "number" &&
          resultNum.type === "number" &&
          resultDen.type === "number"
        ) {
          const aVal = a.value;
          const bVal = b.value;
          const cVal = c.value;
          const dVal = d.value;
          const wrongNum = aVal + cVal;
          const wrongDen = bVal + dVal;

          // Check if result matches the wrong calculation
          if (resultNum.value === wrongNum && resultDen.value === wrongDen) {
            // Calculate correct answer
            const correctNum = aVal * dVal + bVal * cVal;
            const correctDen = bVal * dVal;

            // Simplify if possible
            const g = gcd(Math.abs(correctNum), Math.abs(correctDen));
            const simplifiedNum = correctNum / g;
            const simplifiedDen = correctDen / g;

            const expectedResult =
              simplifiedDen === 1 ? `${simplifiedNum}` : `${simplifiedNum}/${simplifiedDen}`;
            return {
              type: "fraction_error",
              stepNumber: 0,
              confidence: 0.95,
              found: rhs,
              expected: expectedResult,
              explanation: `Fraction addition error. You cannot add fractions by adding numerators and denominators separately.`,
              suggestion: `${aVal}/${bVal} + ${cVal}/${dVal} requires a common denominator. The correct calculation is (${aVal}×${dVal} + ${bVal}×${cVal})/(${bVal}×${dVal}) = ${correctNum}/${correctDen} = ${simplifiedNum}/${simplifiedDen}.`,
              suggestedFix: `${lhs} = ${expectedResult}`,
            };
          }
        }

        // For symbolic case: check if structure matches (a+c)/(b+d)
        if (resultNum.type === "binary" && resultDen.type === "binary") {
          const numOp = normalizeOperator(resultNum.operator);
          const denOp = normalizeOperator(resultDen.operator);

          if (numOp === "+" && denOp === "+") {
            // Check if numerator is a + c (in some order)
            const numLeft = resultNum.left;
            const numRight = (resultNum as BinaryNode).right;
            const denLeft = resultDen.left;
            const denRight = (resultDen as BinaryNode).right;

            const numMatchesAC =
              (nodesEqual(numLeft, a) && nodesEqual(numRight, c)) ||
              (nodesEqual(numLeft, c) && nodesEqual(numRight, a));
            const denMatchesBD =
              (nodesEqual(denLeft, b) && nodesEqual(denRight, d)) ||
              (nodesEqual(denLeft, d) && nodesEqual(denRight, b));

            if (numMatchesAC && denMatchesBD) {
              const aStr = formatAST(a, { spaces: false });
              const bStr = formatAST(b, { spaces: false });
              const cStr = formatAST(c, { spaces: false });
              const dStr = formatAST(d, { spaces: false });

              const expectedResult = `(${aStr}·${dStr} + ${bStr}·${cStr})/(${bStr}·${dStr})`;
              return {
                type: "fraction_error",
                stepNumber: 0,
                confidence: 0.9,
                found: rhs,
                expected: expectedResult,
                explanation: `Fraction addition error. You cannot add fractions by adding numerators and denominators separately.`,
                suggestion: `${aStr}/${bStr} + ${cStr}/${dStr} = (${aStr}·${dStr} + ${bStr}·${cStr})/(${bStr}·${dStr}), not (${aStr}+${cStr})/(${bStr}+${dStr}).`,
                suggestedFix: `${lhs} = ${expectedResult}`,
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Detect common algebraic mistakes in a derivation
 *
 * Analyzes each step of a derivation looking for patterns that indicate
 * common student errors like sign mistakes, distribution errors, etc.
 *
 * @param steps Array of {lhs, rhs} pairs representing the derivation
 * @returns MistakeDetectionResult with identified mistakes and suggestions
 *
 * @example
 * detectCommonMistakes([
 *   { lhs: "2x + 3x", rhs: "6x" }  // Should be 5x!
 * ])
 * // Returns: {
 * //   hasMistakes: true,
 * //   mistakes: [{
 * //     type: "coefficient_error",
 * //     stepNumber: 1,
 * //     explanation: "When combining like terms, ADD coefficients...",
 * //     suggestion: "2 + 3 = 5, not 6. Answer should be 5x."
 * //   }],
 * //   summary: "Found 1 potential mistake: coefficient error"
 * // }
 *
 * @example
 * detectCommonMistakes([
 *   { lhs: "a(b + c)", rhs: "ab + c" }  // Incomplete distribution!
 * ])
 * // Returns: {
 * //   hasMistakes: true,
 * //   mistakes: [{
 * //     type: "distribution_error",
 * //     explanation: "Incomplete distribution...",
 * //     suggestion: "Distribute 'a' to both terms: ab + ac"
 * //   }]
 * // }
 */
export function detectCommonMistakes(
  steps: Array<{ lhs: string; rhs: string }>,
): MistakeDetectionResult {
  const mistakes: DetectedMistake[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;

    const { lhs, rhs } = step;
    const stepNum = i + 1;

    // Skip if expressions are actually equivalent (no error)
    if (compareExpressions(lhs, rhs)) {
      continue;
    }

    // Parse both sides
    const lhsAst = parseToAST(lhs);
    const rhsAst = parseToAST(rhs);

    // Run all mistake detectors
    const checkers = [
      checkSignError,
      checkSubtractionDistributionError,
      checkDistributionError,
      checkFOILError,
      checkCancellationError,
      checkCoefficientError,
      checkExponentError,
      checkPowerRuleError,
      checkChainRuleError,
      checkProductRuleError,
      checkFractionAdditionError,
    ];

    for (const checker of checkers) {
      const mistake = checker(lhs, rhs, lhsAst, rhsAst);
      if (mistake) {
        mistake.stepNumber = stepNum;
        mistakes.push(mistake);
        break; // Only report one mistake per step
      }
    }
  }

  // Generate summary
  let summary: string;
  if (mistakes.length === 0) {
    summary = "No common mistakes detected.";
  } else if (mistakes.length === 1) {
    const m = mistakes[0]!;
    summary = `Found 1 potential mistake at step ${m.stepNumber}: ${m.type.replace(/_/g, " ")}`;
  } else {
    const types = [...new Set(mistakes.map((m) => m.type.replace(/_/g, " ")))];
    summary = `Found ${mistakes.length} potential mistakes: ${types.join(", ")}`;
  }

  return {
    hasMistakes: mistakes.length > 0,
    mistakes,
    summary,
  };
}

/**
 * Detect common mistakes from text containing a derivation
 *
 * @param text Text containing a derivation
 * @returns MistakeDetectionResult or null if no derivation found
 */
export function detectCommonMistakesFromText(text: string): MistakeDetectionResult | null {
  const steps = extractDerivationSteps(text);
  if (steps.length === 0) {
    return null;
  }
  return detectCommonMistakes(steps);
}
