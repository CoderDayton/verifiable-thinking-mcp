/**
 * Derivation Core - verifies multi-step algebraic derivations
 *
 * Uses compareExpressions to check that each step in a derivation is
 * algebraically equivalent to the previous step. Catches "magic" steps
 * in proofs where the transformation isn't valid.
 *
 * @module derivation-core
 */

import { compareExpressions } from "../../domain/verification.ts";
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
 */
export function extractDerivationSteps(text: string): Array<{ lhs: string; rhs: string }> {
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
 */
export function cleanExpressionPart(part: string): string {
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
