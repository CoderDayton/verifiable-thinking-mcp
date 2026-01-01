/**
 * Verification Engine - Domain-specific verifiers for reasoning steps
 * Heuristic-based (no LLM calls) for <10ms overhead
 * Includes content-hash caching for repeated verifications
 */

import { verificationCache } from "./cache.ts";

// Re-export math module for backwards compatibility
export {
  type ASTNode,
  // AST
  type ASTNodeType,
  type ASTResult,
  type BinaryNode,
  buildAST,
  canBeUnary,
  compareExpressions,
  compareOperatorPrecedence,
  type EvalResult,
  // Tokenizer
  type ExpressionValidation,
  evaluateExpression,
  type FormatASTOptions,
  type FormatOptions,
  formatAST,
  formatExpression,
  getOperatorArity,
  getOperatorArityInContext,
  getOperatorPrecedence,
  // Operator utilities
  isMathOperator,
  isRightAssociative,
  MATH_OPERATOR_PATTERN,
  // Constants
  MATH_OPERATORS,
  type MathToken,
  type MathTokenType,
  type NumberNode,
  simplifyAST,
  type TokenizeResult,
  tokenizeMathExpression,
  type UnaryNode,
  type VariableNode,
  validateExpression,
} from "./math/index.ts";

// Import for internal use
import {
  evaluateExpression,
  isMathOperator,
  MATH_OPERATOR_PATTERN,
  validateExpression,
} from "./math/index.ts";

export type VerificationDomain = "math" | "logic" | "code" | "general";

export interface VerificationResult {
  passed: boolean;
  confidence: number; // 0-1
  domain: VerificationDomain;
  evidence: string;
  reward: 0 | 1; // RLVR-style binary reward
  suggestions: string[];
  cached?: boolean; // Whether result was from cache
}

type Verifier = (
  thought: string,
  context: string[],
) => Omit<VerificationResult, "domain" | "reward">;

const verifiers: Record<VerificationDomain, Verifier> = {
  math: verifyMath,
  logic: verifyLogic,
  code: verifyCode,
  general: verifyGeneral,
};

export function verify(
  thought: string,
  domain: VerificationDomain,
  context: string[] = [],
  useCache: boolean = true,
): VerificationResult {
  // Check cache first
  if (useCache) {
    const cached = verificationCache.get(thought, domain, context);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const verifier = verifiers[domain] || verifiers.general;
  const result = verifier(thought, context);

  const fullResult: VerificationResult = {
    ...result,
    domain,
    reward: result.passed ? 1 : 0,
    cached: false,
  };

  // Store in cache
  if (useCache) {
    verificationCache.set(thought, domain, context, fullResult);
  }

  return fullResult;
}

/** Get cache statistics */
export function getVerificationCacheStats() {
  return verificationCache.getStats();
}

/** Clear verification cache */
export function clearVerificationCache(): number {
  return verificationCache.clear();
}

// ============================================================================
// DOMAIN VERIFIERS
// ============================================================================

function verifyMath(
  thought: string,
  _context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  const lower = thought.toLowerCase();

  // Check for mathematical content
  const hasMath =
    /[\d.+\-*/()=]/.test(thought) ||
    /solve|calculate|equation|derivative|integral|sum|product/i.test(thought);

  // Check for balanced parentheses/brackets
  const balanced = checkBalanced(thought);

  // Check for contradictions
  const hasContradiction = /but also|both true and false|contradiction/i.test(lower);

  // Check for valid algebraic patterns
  // Allow valid chained equalities: a = b = c (common in derivations)
  // Flag patterns that suggest errors:
  // - Isolated "= =" (double equals without content)
  // - "= = =" (triple equals in a row)
  // - Contradictory assignments like "x = 5 = 3" (value = value where values differ)
  const hasInvalidEquals = /=\s*=/.test(thought) || hasContradictoryAssignment(thought);

  // Extract and validate math expressions for structural errors
  const structuralErrors = extractAndValidateExpressions(thought);

  // Verify numeric equations (e.g., "2 + 2 = 5" should fail)
  const computationError = verifyNumericEquations(thought);

  const passed =
    hasMath &&
    balanced &&
    !hasContradiction &&
    !hasInvalidEquals &&
    !structuralErrors &&
    !computationError;
  const confidence = calculateConfidence([
    hasMath,
    balanced,
    !hasContradiction,
    !hasInvalidEquals,
    !structuralErrors,
    !computationError,
  ]);

  const suggestions: string[] = [];
  if (!hasMath) suggestions.push("Include mathematical expressions or operations");
  if (!balanced) suggestions.push("Check parentheses/brackets are balanced");
  if (hasContradiction) suggestions.push("Resolve the logical contradiction");
  if (hasInvalidEquals) suggestions.push("Check equation structure for errors");
  if (structuralErrors) suggestions.push(structuralErrors);
  if (computationError) suggestions.push(computationError);
  if (passed) suggestions.push("Continue with next step");

  return {
    passed,
    confidence,
    evidence: passed ? "Valid mathematical reasoning" : suggestions[0] || "Verification failed",
    suggestions,
  };
}

/**
 * Extract potential math expressions from text and validate their structure
 * Returns error message if any expression is malformed, null otherwise
 */
function extractAndValidateExpressions(text: string): string | null {
  // Find expression-like sequences by scanning for operators
  // and expanding to capture the full expression with balanced parens
  const operators = /[+\-*/×÷−·^√²³]/;
  let i = 0;

  while (i < text.length) {
    const char = text[i] as string;

    // Found an operator - try to extract the surrounding expression
    if (operators.test(char)) {
      const expr = extractBalancedExpression(text, i);
      if (expr && expr.length >= 3) {
        const validation = validateExpression(expr);
        if (!validation.valid) {
          return `Expression error: ${validation.error}`;
        }
      }
      // Skip past this expression to avoid re-checking
      i += expr ? expr.length : 1;
    } else {
      i++;
    }
  }

  return null;
}

/**
 * Extract a balanced expression around an operator position
 */
function extractBalancedExpression(text: string, operatorIdx: number): string | null {
  // Go backwards to find start
  let start = operatorIdx;
  let parenDepth = 0;

  while (start > 0) {
    const char = text[start - 1] as string;
    if (char === ")") {
      parenDepth++;
      start--;
    } else if (char === "(") {
      if (parenDepth === 0) break; // Unmatched open paren - stop before it
      parenDepth--;
      start--;
    } else if (/[\d.a-zA-Z_\s]/.test(char) || isMathOperator(char)) {
      start--;
    } else if (parenDepth === 0) {
      break; // Non-expression character, stop
    } else {
      start--;
    }
  }

  // Go forward to find end
  let end = operatorIdx + 1;
  parenDepth = 0;

  while (end < text.length) {
    const char = text[end] as string;
    if (char === "(") {
      parenDepth++;
      end++;
    } else if (char === ")") {
      if (parenDepth === 0) break; // Unmatched close paren - stop before it
      parenDepth--;
      end++;
    } else if (/[\d.a-zA-Z_\s]/.test(char) || isMathOperator(char)) {
      end++;
    } else if (parenDepth === 0) {
      break; // Non-expression character, stop
    } else {
      end++;
    }
  }

  const expr = text.slice(start, end).trim();
  // Only return if it contains operands, not just operators
  if (!/[\d.a-zA-Z_]/.test(expr)) {
    return null;
  }

  return expr;
}

/**
 * Detect contradictory numeric assignments like "5 = 3"
 * Only flags patterns where the left side is JUST a number (not an expression)
 * Examples:
 *   "5 = 3" → true (contradictory: standalone number = different number)
 *   "2 + 2 = 4" → false (expression = result, valid)
 *   "1 = 1" → false (same number, valid)
 *   "x = 5 = 3" → true (contains 5 = 3)
 *   "2^3 = 8" → false (exponentiation expression)
 *   "√4 = 2" → false (square root expression)
 */
function hasContradictoryAssignment(thought: string): boolean {
  // Match: number = number patterns
  // We'll check the preceding context to see if it's part of an expression
  const numericEquals = /(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/g;
  const matches = thought.matchAll(numericEquals);

  for (const match of matches) {
    const a = match[1];
    const b = match[2];
    const matchStart = match.index ?? 0;

    // Skip if preceded by an operator (part of an expression)
    const precedingContext = thought.slice(0, matchStart);
    if (hasMathOperatorBefore(precedingContext)) {
      continue;
    }

    // Skip if the number is preceded by another digit (part of larger number)
    if (matchStart > 0 && /\d$/.test(precedingContext)) {
      continue;
    }

    if (a && b && parseFloat(a) !== parseFloat(b)) {
      return true;
    }
  }
  return false;
}

/**
 * Verify numeric equations by evaluating LHS and comparing to RHS
 * E.g., "2 + 2 = 5" returns an error because 4 ≠ 5
 * Returns error message if computation is wrong, null if all computations are correct
 */
function verifyNumericEquations(thought: string): string | null {
  // Pattern: find "= number" and capture everything before as potential LHS
  // Look for: optional whitespace, =, optional whitespace, number
  const equalsPattern = /=\s*(-?[\d.]+)/g;
  const matches = thought.matchAll(equalsPattern);

  for (const match of matches) {
    const rhs = match[1]?.trim();
    const equalsIdx = match.index ?? 0;

    if (!rhs) continue;

    // Extract LHS: go backwards from the "=" to find the expression
    const beforeEquals = thought.slice(0, equalsIdx).trimEnd();
    const lhs = extractLHSExpression(beforeEquals);

    if (!lhs) continue;

    // Skip if LHS is just a number (handled by hasContradictoryAssignment)
    if (/^-?[\d.]+$/.test(lhs)) continue;

    // Skip if LHS contains variables (can't evaluate)
    if (/[a-zA-Z]/.test(lhs)) continue;

    const result = evaluateExpression(lhs);
    if (result.value === null) continue; // Can't evaluate, skip

    const rhsValue = parseFloat(rhs);
    if (Number.isNaN(rhsValue)) continue;

    // Compare with tolerance for floating point
    const tolerance = 1e-9;
    if (Math.abs(result.value - rhsValue) > tolerance) {
      return `Computation error: ${lhs} = ${result.value}, not ${rhs}`;
    }
  }

  return null;
}

/**
 * Extract the LHS expression from text ending just before "="
 * Scans backwards to find a complete math expression
 */
function extractLHSExpression(text: string): string | null {
  if (!text) return null;

  // Valid expression characters (including space for "2 + 2" and letters for variables)
  // We include letters so we capture "x + 1" fully, then filter out variable expressions later
  const exprChars = /[\d.+\-*/^×÷−·√²³()\sa-zA-Z_]/;

  const end = text.length;
  let start = end;
  let parenDepth = 0;

  // Scan backwards
  while (start > 0) {
    const char = text[start - 1] as string;

    if (char === ")") {
      parenDepth++;
      start--;
    } else if (char === "(") {
      if (parenDepth > 0) {
        parenDepth--;
        start--;
      } else {
        break; // Unmatched open paren
      }
    } else if (exprChars.test(char)) {
      start--;
    } else {
      break; // Non-expression character
    }
  }

  const expr = text.slice(start, end).trim();

  // Must contain at least one operator to be an expression (not just a number)
  if (!/[+\-*/^×÷−·√²³]/.test(expr)) {
    return null;
  }

  return expr || null;
}

/** Check if text ends with a math operator (including Unicode) */
function hasMathOperatorBefore(text: string): boolean {
  return MATH_OPERATOR_PATTERN.test(text);
}

function verifyLogic(
  thought: string,
  context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  const lower = thought.toLowerCase();

  // Check for logical structure
  const hasLogicalKeywords =
    /if|then|therefore|because|implies|hence|thus|conclude|assume|given/i.test(thought);

  // Check for contradictions
  const contradictions = [
    "both true and false",
    "and not both",
    "yes and no simultaneously",
    "contradiction",
  ];
  const hasContradiction = contradictions.some((c) => lower.includes(c));

  // Check for circular reasoning indicators
  const hasCircular = /because it is|proves itself|self-evident without/i.test(lower);

  // Check consistency with prior context
  const consistent = checkContextConsistency(thought, context);

  const passed = hasLogicalKeywords && !hasContradiction && !hasCircular && consistent;
  const confidence = calculateConfidence([
    hasLogicalKeywords,
    !hasContradiction,
    !hasCircular,
    consistent,
  ]);

  const suggestions: string[] = [];
  if (!hasLogicalKeywords)
    suggestions.push("Add logical connectives (if/then, therefore, because)");
  if (hasContradiction) suggestions.push("Resolve the contradiction");
  if (hasCircular) suggestions.push("Avoid circular reasoning");
  if (!consistent) suggestions.push("Check consistency with previous steps");
  if (passed) suggestions.push("Reasoning is logically sound");

  return {
    passed,
    confidence,
    evidence: passed ? "Logically consistent" : suggestions[0] || "Logic check failed",
    suggestions,
  };
}

function verifyCode(
  thought: string,
  _context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  // Check for code-related content
  const hasCodeKeywords =
    /function|class|return|const|let|var|if|for|while|async|await|def|import|export|->|=>|struct|impl|fn|pub/i.test(
      thought,
    );

  // Check balanced brackets/braces
  const balanced = checkBalanced(thought);

  // Check for common code smells in reasoning
  const hasInfiniteLoop = /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)|loop\s*{/i.test(thought);
  const hasNullDeref = /\.\s*unwrap\s*\(\s*\)|\.unwrap\(\)|null\s*\./i.test(thought);

  // Check for algorithm keywords
  const hasAlgorithm =
    /algorithm|complexity|O\(|time|space|iterate|recurse|sort|search|hash|tree|graph/i.test(
      thought,
    );

  const passed = (hasCodeKeywords || hasAlgorithm) && balanced && !hasInfiniteLoop;
  const confidence = calculateConfidence([
    hasCodeKeywords || hasAlgorithm,
    balanced,
    !hasInfiniteLoop,
    !hasNullDeref,
  ]);

  const suggestions: string[] = [];
  if (!hasCodeKeywords && !hasAlgorithm)
    suggestions.push("Include code concepts or algorithm discussion");
  if (!balanced) suggestions.push("Check bracket/brace balance");
  if (hasInfiniteLoop) suggestions.push("Potential infinite loop detected");
  if (hasNullDeref) suggestions.push("Consider handling null/None cases");
  if (passed) suggestions.push("Code reasoning is valid");

  return {
    passed,
    confidence,
    evidence: passed ? "Valid code reasoning" : suggestions[0] || "Code verification failed",
    suggestions,
  };
}

function verifyGeneral(
  thought: string,
  context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  // Basic coherence checks
  const hasSubstance = thought.length > 15;
  const notJustQuestion = !thought.trim().endsWith("?") || thought.length > 50;
  const hasStructure = /\.|,|;|:/.test(thought); // Has punctuation

  // Check for vague/non-committal language
  const tooVague =
    /maybe|perhaps|possibly|might|could be|not sure/i.test(thought) && thought.length < 100;

  // Check context relevance (simple keyword overlap)
  const relevant = context.length === 0 || checkContextRelevance(thought, context);

  const passed = hasSubstance && notJustQuestion && !tooVague && relevant;
  const confidence = calculateConfidence([
    hasSubstance,
    notJustQuestion,
    !tooVague,
    relevant,
    hasStructure,
  ]);

  const suggestions: string[] = [];
  if (!hasSubstance) suggestions.push("Provide more detailed reasoning");
  if (!notJustQuestion) suggestions.push("Answer the question rather than asking another");
  if (tooVague) suggestions.push("Be more specific in your reasoning");
  if (!relevant) suggestions.push("Ensure relevance to previous context");
  if (passed) suggestions.push("Proceed to next step");

  return {
    passed,
    confidence,
    evidence: passed ? "Coherent reasoning" : suggestions[0] || "General check failed",
    suggestions,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function checkBalanced(text: string): boolean {
  const brackets: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];

  for (const char of text) {
    if (char in brackets) {
      stack.push(char);
    } else if (Object.values(brackets).includes(char)) {
      const last = stack.pop();
      if (!last || brackets[last] !== char) {
        return false;
      }
    }
  }

  return stack.length === 0;
}

function checkContextConsistency(thought: string, context: string[]): boolean {
  if (context.length === 0) return true;

  const lower = thought.toLowerCase();

  // Check for explicit contradictions with prior context
  for (const prev of context) {
    const prevLower = prev.toLowerCase();

    // Simple negation check
    if (
      lower.includes(`not ${prevLower.slice(0, 20)}`) ||
      prevLower.includes(`not ${lower.slice(0, 20)}`)
    ) {
      return false;
    }
  }

  return true;
}

function checkContextRelevance(thought: string, context: string[]): boolean {
  if (context.length === 0) return true;

  const thoughtWords = new Set(tokenize(thought));
  const contextWords = new Set(context.flatMap((c) => tokenize(c)));

  // Check for at least some word overlap
  let overlap = 0;
  for (const word of thoughtWords) {
    if (contextWords.has(word)) overlap++;
  }

  return overlap >= 1 || thoughtWords.size < 5;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function calculateConfidence(checks: boolean[]): number {
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100) / 100;
}
