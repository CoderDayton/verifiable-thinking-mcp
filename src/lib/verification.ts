/**
 * Verification Engine - Domain-specific verifiers for reasoning steps
 * Heuristic-based (no LLM calls) for <10ms overhead
 * Includes content-hash caching for repeated verifications
 */

import { verificationCache } from "./cache.ts";

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

// Common math operators including Unicode variants from LaTeX/Word
// ASCII: + - * / ^ %
// Unicode: × ÷ − · √ ² ³ ⁿ ± ∓
// Also handles √ before numbers (prefix operator)

/** All recognized math operator characters (ASCII + Unicode) */
export const MATH_OPERATORS = "+-*/^%×÷−·√²³⁺⁻±∓" as const;

/** Pattern to check if text ends with a math operator */
export const MATH_OPERATOR_PATTERN = /[+\-*/^%×÷−·√²³⁺⁻±∓]\s*$/;

/** Pattern to match a single math operator character */
const SINGLE_OPERATOR_PATTERN = /^[+\-*/^%×÷−·√²³⁺⁻±∓]$/;

/**
 * Operator precedence levels (higher = binds tighter)
 * Based on standard mathematical conventions:
 * - Level 1: Addition/subtraction (lowest)
 * - Level 2: Multiplication/division
 * - Level 3: Exponentiation
 * - Level 4: Unary/prefix operators (highest)
 */
const OPERATOR_PRECEDENCE: Record<string, number> = {
  // Addition/subtraction - Level 1
  "+": 1,
  "-": 1,
  "−": 1, // Unicode minus
  "±": 1,
  "∓": 1,
  "⁺": 1, // Superscript plus
  "⁻": 1, // Superscript minus

  // Multiplication/division - Level 2
  "*": 2,
  "/": 2,
  "%": 2,
  "×": 2,
  "÷": 2,
  "·": 2, // Middle dot (multiplication)

  // Exponentiation - Level 3
  "^": 3,
  "²": 3, // Superscript 2
  "³": 3, // Superscript 3

  // Unary/prefix - Level 4 (highest)
  "√": 4, // Square root (prefix)
};

/**
 * Check if a character is a recognized math operator
 * Supports ASCII (+, -, *, /, ^, %) and Unicode (×, ÷, −, ·, √, ², ³, ⁺, ⁻, ±, ∓)
 */
export function isMathOperator(char: string): boolean {
  return SINGLE_OPERATOR_PATTERN.test(char);
}

/**
 * Get the precedence level of a math operator
 * Higher values bind tighter (e.g., * before +)
 * Returns null for unrecognized characters
 *
 * Precedence levels:
 * - 1: +, -, −, ±, ∓, ⁺, ⁻ (addition/subtraction)
 * - 2: *, /, %, ×, ÷, · (multiplication/division)
 * - 3: ^, ², ³ (exponentiation)
 * - 4: √ (unary/prefix operators)
 */
export function getOperatorPrecedence(char: string): number | null {
  return OPERATOR_PRECEDENCE[char] ?? null;
}

/**
 * Compare two operators by precedence
 * Returns: negative if a < b, 0 if equal, positive if a > b
 * Returns null if either is not a valid operator
 */
export function compareOperatorPrecedence(a: string, b: string): number | null {
  const precA = OPERATOR_PRECEDENCE[a];
  const precB = OPERATOR_PRECEDENCE[b];
  if (precA === undefined || precB === undefined) return null;
  return precA - precB;
}

/**
 * Right-associative operators (evaluated right-to-left)
 * e.g., 2^3^4 = 2^(3^4) = 2^81, not (2^3)^4 = 8^4 = 4096
 */
const RIGHT_ASSOCIATIVE = new Set(["^", "²", "³"]);

/**
 * Check if an operator is right-associative
 * Right-associative: 2^3^4 = 2^(3^4)
 * Left-associative (default): 2-3-4 = (2-3)-4
 */
export function isRightAssociative(char: string): boolean {
  return RIGHT_ASSOCIATIVE.has(char);
}

/**
 * Unary operators (take one operand)
 * - Prefix: √4, -5 (when at start or after operator)
 * - Postfix: 5², 3³
 */
const UNARY_OPERATORS = new Set(["√", "²", "³", "⁺", "⁻"]);

/**
 * Operators that can be either unary or binary depending on context
 * e.g., "-" is binary in "5-3" but unary in "-5" or "5*-3"
 */
const AMBIGUOUS_OPERATORS = new Set(["-", "−", "+", "±", "∓"]);

/**
 * Get the arity of an operator (number of operands)
 * Returns 1 for unary, 2 for binary, null for non-operators
 *
 * Note: Some operators like "-" can be both unary and binary.
 * Use getOperatorArityInContext() for context-aware detection.
 */
export function getOperatorArity(char: string): 1 | 2 | null {
  if (!isMathOperator(char)) return null;
  if (UNARY_OPERATORS.has(char)) return 1;
  return 2;
}

/**
 * Check if an operator can be used as unary (context-dependent)
 * "-" and "+" can be unary at expression start or after another operator
 */
export function canBeUnary(char: string): boolean {
  return UNARY_OPERATORS.has(char) || AMBIGUOUS_OPERATORS.has(char);
}

/**
 * Determine operator arity based on context
 * @param char - The operator character
 * @param afterOperator - Whether this operator follows another operator or is at start
 */
export function getOperatorArityInContext(char: string, afterOperator: boolean): 1 | 2 | null {
  if (!isMathOperator(char)) return null;
  if (UNARY_OPERATORS.has(char)) return 1;
  if (afterOperator && AMBIGUOUS_OPERATORS.has(char)) return 1;
  return 2;
}

/** Result of expression validation */
export interface ExpressionValidation {
  valid: boolean;
  error?: string;
  /** Position in expression where error was detected */
  errorIndex?: number;
}

/**
 * Validate a math expression for structural correctness
 * Checks for:
 * - Consecutive binary operators (e.g., "2 + * 3")
 * - Missing operands (e.g., "5 +", "+ 5" without unary context)
 * - Mismatched parentheses
 * - Postfix operator without operand (e.g., "² 5")
 */
export function validateExpression(expr: string): ExpressionValidation {
  const trimmed = expr.trim();
  if (!trimmed) {
    return { valid: false, error: "Empty expression" };
  }

  const state = { parenDepth: 0, expectOperand: true, lastWasOperator: true };
  let i = 0;

  while (i < trimmed.length) {
    const char = trimmed[i] as string;

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Handle different token types
    const result = processValidationChar(char, trimmed, i, state);
    if (result.error) {
      return { valid: false, error: result.error, errorIndex: result.errorIndex };
    }
    i = result.nextIndex;
  }

  // Final checks
  if (state.parenDepth > 0) {
    return { valid: false, error: "Unclosed parenthesis" };
  }

  // Trailing binary operator (but allow expressions like "5²")
  if (state.expectOperand && state.lastWasOperator) {
    const lastNonSpace = trimmed.trimEnd().slice(-1);
    if (isMathOperator(lastNonSpace) && lastNonSpace !== "²" && lastNonSpace !== "³") {
      return { valid: false, error: "Expression ends with operator" };
    }
  }

  return { valid: true };
}

/** State for expression validation */
interface ValidationState {
  parenDepth: number;
  expectOperand: boolean;
  lastWasOperator: boolean;
}

/** Process a single character during validation */
function processValidationChar(
  char: string,
  expr: string,
  i: number,
  state: ValidationState,
): { nextIndex: number; error?: string; errorIndex?: number } {
  // Handle parentheses
  if (char === "(" || char === "[" || char === "{") {
    state.parenDepth++;
    state.expectOperand = true;
    state.lastWasOperator = true;
    return { nextIndex: i + 1 };
  }

  if (char === ")" || char === "]" || char === "}") {
    state.parenDepth--;
    if (state.parenDepth < 0) {
      return { nextIndex: i, error: "Unmatched closing parenthesis", errorIndex: i };
    }
    if (state.expectOperand) {
      return { nextIndex: i, error: "Empty parentheses or missing operand", errorIndex: i };
    }
    state.expectOperand = false;
    state.lastWasOperator = false;
    return { nextIndex: i + 1 };
  }

  // Handle operators
  if (isMathOperator(char)) {
    return processOperatorValidation(char, i, state);
  }

  // Handle numbers
  if (/[\d.]/.test(char)) {
    let j = i;
    while (j < expr.length && /[\d.eE+-]/.test(expr[j] as string)) j++;
    state.expectOperand = false;
    state.lastWasOperator = false;
    return { nextIndex: j };
  }

  // Handle variables
  if (/[a-zA-Z_]/.test(char)) {
    let j = i;
    while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j] as string)) j++;
    state.expectOperand = false;
    state.lastWasOperator = false;
    return { nextIndex: j };
  }

  // Unknown character - skip
  return { nextIndex: i + 1 };
}

/** Process operator during validation */
function processOperatorValidation(
  char: string,
  i: number,
  state: ValidationState,
): { nextIndex: number; error?: string; errorIndex?: number } {
  const arity = getOperatorArityInContext(char, state.lastWasOperator);

  // Postfix operators need a preceding operand
  if ((char === "²" || char === "³") && state.expectOperand) {
    return { nextIndex: i, error: `Postfix operator '${char}' without operand`, errorIndex: i };
  }

  // Unary prefix operators are okay when expecting operand
  if (arity === 1 && state.expectOperand && char !== "²" && char !== "³") {
    state.lastWasOperator = true;
    return { nextIndex: i + 1 };
  }

  // Binary operator when expecting operand = error
  if (arity === 2 && state.expectOperand) {
    return { nextIndex: i, error: `Unexpected operator '${char}'`, errorIndex: i };
  }

  // Update state based on operator type
  if (char === "²" || char === "³") {
    state.expectOperand = false;
    state.lastWasOperator = false;
  } else {
    state.expectOperand = true;
    state.lastWasOperator = true;
  }

  return { nextIndex: i + 1 };
}

/** Token types for math expression tokenization */
export type MathTokenType = "number" | "operator" | "variable" | "paren" | "unknown";

/** A single token from a math expression */
export interface MathToken {
  type: MathTokenType;
  value: string;
  position: number;
  /** For operators: precedence level (1-4) */
  precedence?: number;
  /** For operators: arity in context (1 or 2) */
  arity?: 1 | 2;
  /** For operators: whether right-associative */
  rightAssociative?: boolean;
}

/** Result of tokenizing an expression */
export interface TokenizeResult {
  tokens: MathToken[];
  /** Any errors encountered during tokenization */
  errors: string[];
}

/**
 * Tokenize a math expression into structured tokens
 * Returns tokens with type, value, position, and operator metadata
 *
 * @example
 * tokenizeMathExpression("2 + 3 * -4")
 * // Returns tokens: [
 * //   { type: "number", value: "2", position: 0 },
 * //   { type: "operator", value: "+", position: 2, precedence: 1, arity: 2 },
 * //   { type: "number", value: "3", position: 4 },
 * //   { type: "operator", value: "*", position: 6, precedence: 2, arity: 2 },
 * //   { type: "operator", value: "-", position: 8, precedence: 1, arity: 1 },
 * //   { type: "number", value: "4", position: 9 },
 * // ]
 */
export function tokenizeMathExpression(expr: string): TokenizeResult {
  const tokens: MathToken[] = [];
  const errors: string[] = [];
  let i = 0;
  let lastWasOperator = true; // Start as if after operator (for unary detection)
  let lastWasOperand = false;

  while (i < expr.length) {
    const char = expr[i] as string;
    const startPos = i;

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Parentheses and brackets
    if (/[()[\]{}]/.test(char)) {
      tokens.push({
        type: "paren",
        value: char,
        position: startPos,
      });
      // Opening paren acts like "after operator" for unary detection
      lastWasOperator = char === "(" || char === "[" || char === "{";
      lastWasOperand = char === ")" || char === "]" || char === "}";
      i++;
      continue;
    }

    // Operators
    if (isMathOperator(char)) {
      const arity = getOperatorArityInContext(char, lastWasOperator && !lastWasOperand);
      tokens.push({
        type: "operator",
        value: char,
        position: startPos,
        precedence: getOperatorPrecedence(char) ?? undefined,
        arity: arity ?? undefined,
        rightAssociative: isRightAssociative(char) || undefined,
      });
      // Postfix operators (², ³) don't change lastWasOperator
      if (char === "²" || char === "³") {
        lastWasOperator = false;
        lastWasOperand = true;
      } else {
        lastWasOperator = true;
        lastWasOperand = false;
      }
      i++;
      continue;
    }

    // Numbers (including decimals and scientific notation)
    if (/[\d.]/.test(char)) {
      let numStr = "";
      while (i < expr.length) {
        const c = expr[i] as string;
        // Handle scientific notation: 1e10, 2.5e-3
        if (/[\d.]/.test(c)) {
          numStr += c;
          i++;
        } else if (/[eE]/.test(c) && i + 1 < expr.length) {
          const next = expr[i + 1] as string;
          if (/[\d+-]/.test(next)) {
            numStr += c + next;
            i += 2;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      tokens.push({
        type: "number",
        value: numStr,
        position: startPos,
      });
      lastWasOperator = false;
      lastWasOperand = true;
      continue;
    }

    // Variables/identifiers
    if (/[a-zA-Z_]/.test(char)) {
      let varStr = "";
      while (i < expr.length) {
        const c = expr[i] as string;
        if (/[a-zA-Z0-9_]/.test(c)) {
          varStr += c;
          i++;
        } else {
          break;
        }
      }
      tokens.push({
        type: "variable",
        value: varStr,
        position: startPos,
      });
      lastWasOperator = false;
      lastWasOperand = true;
      continue;
    }

    // Unknown character
    tokens.push({
      type: "unknown",
      value: char,
      position: startPos,
    });
    errors.push(`Unknown character '${char}' at position ${startPos}`);
    i++;
  }

  // Post-process: insert implicit multiplication operators
  // E.g., "2x" → "2 * x", "x(y)" → "x * (y)", "(a)(b)" → "(a) * (b)"
  const processed = insertImplicitMultiplication(tokens);

  return { tokens: processed, errors };
}

/**
 * Insert implicit multiplication operators between adjacent operands
 * Handles: number-variable (2x), variable-paren (x(y)), paren-paren ((a)(b))
 * @internal
 */
function insertImplicitMultiplication(tokens: MathToken[]): MathToken[] {
  const result: MathToken[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const curr = tokens[i] as MathToken;
    result.push(curr);

    // Check if we need to insert implicit multiplication after this token
    const next = tokens[i + 1];
    if (!next) continue;

    // Conditions where implicit multiplication applies:
    // 1. number followed by variable: 2x
    // 2. number followed by opening paren: 2(x)
    // 3. variable followed by opening paren: x(y)
    // 4. variable followed by variable: xy (though this could be a variable name)
    // 5. closing paren followed by opening paren: (a)(b)
    // 6. closing paren followed by number: (a)2
    // 7. closing paren followed by variable: (a)x
    // 8. number followed by number (rare, but possible in some contexts)
    // 9. postfix operator followed by operand: x²y

    const currIsOperand =
      curr.type === "number" ||
      curr.type === "variable" ||
      (curr.type === "paren" && /[)\]}]/.test(curr.value)) ||
      (curr.type === "operator" && (curr.value === "²" || curr.value === "³"));

    const nextIsOperand =
      next.type === "number" ||
      next.type === "variable" ||
      (next.type === "paren" && /[([{]/.test(next.value));

    if (currIsOperand && nextIsOperand) {
      // Insert implicit multiplication
      result.push({
        type: "operator",
        value: "*",
        position: curr.position + curr.value.length,
        precedence: 2, // Same as explicit multiplication
        arity: 2,
      });
    }
  }

  return result;
}

// ============================================================================
// AST BUILDING
// ============================================================================

/** AST node types */
export type ASTNodeType = "number" | "variable" | "unary" | "binary";

/** Base AST node */
export interface ASTNodeBase {
  type: ASTNodeType;
}

/** Number literal node */
export interface NumberNode extends ASTNodeBase {
  type: "number";
  value: number;
}

/** Variable reference node */
export interface VariableNode extends ASTNodeBase {
  type: "variable";
  name: string;
}

/** Unary operation node */
export interface UnaryNode extends ASTNodeBase {
  type: "unary";
  operator: string;
  operand: ASTNode;
}

/** Binary operation node */
export interface BinaryNode extends ASTNodeBase {
  type: "binary";
  operator: string;
  left: ASTNode;
  right: ASTNode;
}

/** Union of all AST node types */
export type ASTNode = NumberNode | VariableNode | UnaryNode | BinaryNode;

/** Result of AST building */
export interface ASTResult {
  ast: ASTNode | null;
  error?: string;
}

/**
 * Build an Abstract Syntax Tree from tokens using the shunting-yard algorithm
 * Respects operator precedence and associativity
 *
 * @example
 * const tokens = tokenizeMathExpression("2 + 3 * 4").tokens;
 * const { ast } = buildAST(tokens);
 * // ast = { type: "binary", operator: "+", left: 2, right: { type: "binary", operator: "*", left: 3, right: 4 } }
 */
export function buildAST(tokens: MathToken[]): ASTResult {
  if (tokens.length === 0) {
    return { ast: null, error: "Empty expression" };
  }

  const outputStack: ASTNode[] = [];
  const operatorStack: MathToken[] = [];

  for (const token of tokens) {
    const result = processASTToken(token, outputStack, operatorStack);
    if (result?.error) return { ast: null, error: result.error };
  }

  // Pop remaining operators
  while (operatorStack.length > 0) {
    const op = operatorStack.pop() as MathToken;
    if (op.type === "paren") {
      return { ast: null, error: "Mismatched parentheses" };
    }
    const result = applyOperator(op, outputStack);
    if (result.error) return { ast: null, error: result.error };
  }

  if (outputStack.length !== 1) {
    return { ast: null, error: "Invalid expression structure" };
  }

  return { ast: outputStack[0] as ASTNode };
}

/** Process a single token for AST building */
function processASTToken(
  token: MathToken,
  outputStack: ASTNode[],
  operatorStack: MathToken[],
): { error?: string } | null {
  switch (token.type) {
    case "number":
      outputStack.push({ type: "number", value: parseFloat(token.value) });
      return null;

    case "variable":
      outputStack.push({ type: "variable", name: token.value });
      return null;

    case "operator":
      return processASTOperator(token, outputStack, operatorStack);

    case "paren":
      return processASTParen(token, outputStack, operatorStack);

    case "unknown":
      return { error: `Unknown token: ${token.value}` };
  }
}

/** Process operator token for AST */
function processASTOperator(
  token: MathToken,
  outputStack: ASTNode[],
  operatorStack: MathToken[],
): { error?: string } | null {
  if (token.arity === 1) {
    operatorStack.push(token);
    return null;
  }

  // Binary operator - pop higher/equal precedence operators
  while (operatorStack.length > 0) {
    const top = operatorStack[operatorStack.length - 1] as MathToken;
    if (top.type === "paren") break;

    const topPrec = top.precedence ?? 0;
    const currPrec = token.precedence ?? 0;
    const shouldPop =
      top.arity === 1 || topPrec > currPrec || (topPrec === currPrec && !token.rightAssociative);

    if (!shouldPop) break;

    operatorStack.pop();
    const result = applyOperator(top, outputStack);
    if (result.error) return result;
  }

  operatorStack.push(token);
  return null;
}

/** Process parenthesis token for AST */
function processASTParen(
  token: MathToken,
  outputStack: ASTNode[],
  operatorStack: MathToken[],
): { error?: string } | null {
  if (token.value === "(" || token.value === "[" || token.value === "{") {
    operatorStack.push(token);
    return null;
  }

  // Closing paren - pop until matching open
  while (operatorStack.length > 0) {
    const top = operatorStack[operatorStack.length - 1] as MathToken;
    if (top.type === "paren") {
      operatorStack.pop();
      return null;
    }
    operatorStack.pop();
    const result = applyOperator(top, outputStack);
    if (result.error) return result;
  }
  return null;
}

/** Apply an operator to operands on the stack */
function applyOperator(op: MathToken, stack: ASTNode[]): { error?: string } {
  if (op.arity === 1) {
    // Unary operator
    if (stack.length < 1) {
      return { error: `Missing operand for unary operator ${op.value}` };
    }
    const operand = stack.pop() as ASTNode;
    stack.push({
      type: "unary",
      operator: op.value,
      operand,
    });
  } else {
    // Binary operator
    if (stack.length < 2) {
      return { error: `Missing operands for binary operator ${op.value}` };
    }
    const right = stack.pop() as ASTNode;
    const left = stack.pop() as ASTNode;
    stack.push({
      type: "binary",
      operator: op.value,
      left,
      right,
    });
  }
  return {};
}

// ============================================================================
// AST SIMPLIFICATION
// ============================================================================

/**
 * Simplify an AST by performing constant folding and algebraic simplification
 * Transformations applied:
 * - Constant folding: 2 + 3 → 5
 * - Identity: x + 0 → x, x * 1 → x, x ^ 1 → x
 * - Zero: x * 0 → 0, 0 / x → 0
 * - Power of zero: x ^ 0 → 1
 * - Double negation: --x → x
 * - Self subtraction: x - x → 0
 * - Self division: x / x → 1
 *
 * @example
 * const tokens = tokenizeMathExpression("x + 0 * 2").tokens;
 * const { ast } = buildAST(tokens);
 * const simplified = simplifyAST(ast);
 * // simplified represents just "x"
 */
export function simplifyAST(node: ASTNode): ASTNode {
  switch (node.type) {
    case "number":
    case "variable":
      return node;

    case "unary":
      return simplifyUnary(node);

    case "binary":
      return simplifyBinary(node);
  }
}

/** Simplify unary node */
function simplifyUnary(node: UnaryNode): ASTNode {
  const operand = simplifyAST(node.operand);

  // Double negation: --x → x
  if (
    (node.operator === "-" || node.operator === "−") &&
    operand.type === "unary" &&
    (operand.operator === "-" || operand.operator === "−")
  ) {
    return operand.operand;
  }

  // Constant folding for unary operators
  if (operand.type === "number") {
    const result = evaluateUnaryOp(node.operator, operand.value);
    if (result !== null) {
      return { type: "number", value: result };
    }
  }

  // +x → x
  if (node.operator === "+") {
    return operand;
  }

  return { ...node, operand };
}

/** Simplify binary node - apply identity and zero rules */
function simplifyBinary(node: BinaryNode): ASTNode {
  const left = simplifyAST(node.left);
  const right = simplifyAST(node.right);

  // Constant folding: both operands are numbers
  if (left.type === "number" && right.type === "number") {
    const result = evaluateBinaryOp(node.operator, left.value, right.value);
    if (result !== null) {
      return { type: "number", value: result };
    }
  }

  const op = normalizeOperator(node.operator);

  // Try operator-specific simplifications
  const simplified = simplifyByOperator(op, left, right);
  if (simplified) return simplified;

  return { ...node, left, right };
}

/** Apply operator-specific simplification rules */
function simplifyByOperator(op: string, left: ASTNode, right: ASTNode): ASTNode | null {
  switch (op) {
    case "+":
      if (right.type === "number" && right.value === 0) return left;
      if (left.type === "number" && left.value === 0) return right;
      break;
    case "-":
      if (right.type === "number" && right.value === 0) return left;
      if (astEqual(left, right)) return { type: "number", value: 0 };
      break;
    case "*":
      if (right.type === "number" && right.value === 0) return { type: "number", value: 0 };
      if (left.type === "number" && left.value === 0) return { type: "number", value: 0 };
      if (right.type === "number" && right.value === 1) return left;
      if (left.type === "number" && left.value === 1) return right;
      break;
    case "/":
      if (left.type === "number" && left.value === 0) return { type: "number", value: 0 };
      if (right.type === "number" && right.value === 1) return left;
      if (astEqual(left, right)) return { type: "number", value: 1 };
      break;
    case "^":
      if (right.type === "number" && right.value === 0) return { type: "number", value: 1 };
      if (right.type === "number" && right.value === 1) return left;
      if (left.type === "number" && left.value === 1) return { type: "number", value: 1 };
      if (
        left.type === "number" &&
        left.value === 0 &&
        right.type === "number" &&
        right.value > 0
      ) {
        return { type: "number", value: 0 };
      }
      break;
  }
  return null;
}

/** Normalize operator to canonical form */
function normalizeOperator(op: string): string {
  switch (op) {
    case "−":
      return "-";
    case "×":
    case "·":
      return "*";
    case "÷":
      return "/";
    default:
      return op;
  }
}

/** Evaluate a unary operation on a number */
function evaluateUnaryOp(op: string, value: number): number | null {
  switch (op) {
    case "-":
    case "−":
      return -value;
    case "+":
      return value;
    case "√":
      return value >= 0 ? Math.sqrt(value) : null;
    case "²":
      return value * value;
    case "³":
      return value * value * value;
    default:
      return null;
  }
}

/** Evaluate a binary operation on two numbers */
function evaluateBinaryOp(op: string, left: number, right: number): number | null {
  switch (normalizeOperator(op)) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right !== 0 ? left / right : null;
    case "^":
      return left ** right;
    case "%":
      return right !== 0 ? left % right : null;
    default:
      return null;
  }
}

/** Check if two AST nodes are structurally equal */
function astEqual(a: ASTNode, b: ASTNode): boolean {
  if (a.type !== b.type) return false;

  switch (a.type) {
    case "number":
      return a.value === (b as NumberNode).value;
    case "variable":
      return a.name === (b as VariableNode).name;
    case "unary":
      return (
        normalizeOperator(a.operator) === normalizeOperator((b as UnaryNode).operator) &&
        astEqual(a.operand, (b as UnaryNode).operand)
      );
    case "binary":
      return (
        normalizeOperator(a.operator) === normalizeOperator((b as BinaryNode).operator) &&
        astEqual(a.left, (b as BinaryNode).left) &&
        astEqual(a.right, (b as BinaryNode).right)
      );
  }
}

// ============================================================================
// AST FORMATTING
// ============================================================================

/** Options for AST formatting */
export interface FormatASTOptions {
  /** Use Unicode operators (× instead of *, ÷ instead of /, − instead of -) */
  useUnicode?: boolean;
  /** Add spaces around binary operators */
  spaces?: boolean;
  /** Use minimal parentheses based on precedence */
  minimalParens?: boolean;
}

/** Map ASCII operators to Unicode equivalents for formatting */
const UNICODE_OPS: Record<string, string> = {
  "*": "×",
  "/": "÷",
  "-": "−",
};

/** Get precedence for an operator string */
function opPrecedence(op: string): number {
  const normalized = normalizeOperator(op);
  switch (normalized) {
    case "+":
    case "-":
      return 1;
    case "*":
    case "/":
    case "%":
      return 2;
    case "^":
      return 3;
    default:
      return 4; // Unary operators
  }
}

/**
 * Format an AST node back to a human-readable expression string
 *
 * @param node The AST node to format
 * @param options Formatting options
 * @returns Formatted expression string
 *
 * @example
 * const tokens = tokenizeMathExpression("2 * x + 3").tokens;
 * const { ast } = buildAST(tokens);
 * formatAST(ast, { useUnicode: true, spaces: true });
 * // Returns: "2 × x + 3"
 *
 * @example
 * formatAST(ast, { minimalParens: true });
 * // Returns: "2 * x + 3" (no parens needed due to precedence)
 */
export function formatAST(node: ASTNode, options: FormatASTOptions = {}): string {
  const { useUnicode = false, spaces = true, minimalParens = true } = options;

  function formatOp(op: string): string {
    if (useUnicode && UNICODE_OPS[op]) {
      return UNICODE_OPS[op] as string;
    }
    return op;
  }

  function fmt(n: ASTNode, parentPrec: number = 0, isRight: boolean = false): string {
    switch (n.type) {
      case "number":
        return n.value.toString();
      case "variable":
        return n.name;
      case "unary":
        return formatUnaryNode(n, formatOp);
      case "binary":
        return formatBinaryNode(n, parentPrec, isRight, formatOp, spaces, minimalParens);
    }
  }

  return fmt(node);
}

/** Format a unary AST node */
function formatUnaryNode(n: UnaryNode, formatOp: (op: string) => string): string {
  const operand = formatASTInternal(n.operand, formatOp, false, false);
  const op = formatOp(n.operator);

  // Postfix operators (², ³)
  if (n.operator === "²" || n.operator === "³") {
    if (n.operand.type === "binary" || n.operand.type === "unary") {
      return `(${operand})${op}`;
    }
    return `${operand}${op}`;
  }

  // Square root
  if (n.operator === "√") {
    return `${op}${operand}`;
  }

  // Unary minus/plus
  if (n.operand.type === "binary") {
    return `${op}(${operand})`;
  }
  return `${op}${operand}`;
}

/** Format a binary AST node */
function formatBinaryNode(
  n: BinaryNode,
  parentPrec: number,
  isRight: boolean,
  formatOp: (op: string) => string,
  spaces: boolean,
  minimalParens: boolean,
): string {
  const prec = opPrecedence(n.operator);
  const op = formatOp(n.operator);
  const sp = spaces ? " " : "";

  const left = formatASTInternal(n.left, formatOp, spaces, minimalParens);
  const right = formatASTInternal(n.right, formatOp, spaces, minimalParens);

  const leftStr = wrapLeftChild(n.left, left, prec, minimalParens);
  const rightStr = wrapRightChild(n.right, right, prec, n.operator, minimalParens);

  const result = `${leftStr}${sp}${op}${sp}${rightStr}`;

  // Check if THIS node needs parens due to parent context
  if (minimalParens && parentPrec > 0) {
    if (parentPrec > prec) return `(${result})`;
    if (parentPrec === prec && isRight && !isRightAssociative(n.operator)) {
      return `(${result})`;
    }
  }

  return result;
}

/** Internal formatting helper */
function formatASTInternal(
  node: ASTNode,
  formatOp: (op: string) => string,
  spaces: boolean,
  minimalParens: boolean,
): string {
  switch (node.type) {
    case "number":
      return node.value.toString();
    case "variable":
      return node.name;
    case "unary":
      return formatUnaryNode(node, formatOp);
    case "binary":
      return formatBinaryNode(node, 0, false, formatOp, spaces, minimalParens);
  }
}

/** Wrap left child with parens if needed */
function wrapLeftChild(
  left: ASTNode,
  leftStr: string,
  parentPrec: number,
  minimalParens: boolean,
): string {
  if (minimalParens) {
    const leftPrec = left.type === "binary" ? opPrecedence((left as BinaryNode).operator) : 99;
    if (leftPrec < parentPrec) return `(${leftStr})`;
    return leftStr;
  }
  return left.type === "binary" ? `(${leftStr})` : leftStr;
}

/** Wrap right child with parens if needed */
function wrapRightChild(
  right: ASTNode,
  rightStr: string,
  parentPrec: number,
  parentOp: string,
  minimalParens: boolean,
): string {
  if (minimalParens) {
    const rightPrec = right.type === "binary" ? opPrecedence((right as BinaryNode).operator) : 99;
    if (rightPrec < parentPrec) return `(${rightStr})`;
    if (rightPrec === parentPrec && !isRightAssociative(parentOp) && right.type === "binary") {
      return `(${rightStr})`;
    }
    return rightStr;
  }
  return right.type === "binary" ? `(${rightStr})` : rightStr;
}

// ============================================================================
// EXPRESSION COMPARISON
// ============================================================================

/**
 * Compare two expressions for algebraic equivalence using random test values
 * Useful for verifying mathematical derivations like "x + x" = "2*x"
 *
 * @param a First expression string
 * @param b Second expression string
 * @param numTests Number of random test points (default: 10)
 * @param tolerance Numeric tolerance for comparison (default: 1e-9)
 * @returns true if expressions are equivalent at all test points
 *
 * @example
 * compareExpressions("x + x", "2 * x");           // true
 * compareExpressions("(a + b)²", "a² + 2*a*b + b²"); // true
 * compareExpressions("x + 1", "x");               // false
 */
export function compareExpressions(
  a: string,
  b: string,
  numTests: number = 10,
  tolerance: number = 1e-9,
): boolean {
  // Parse both expressions
  const tokensA = tokenizeMathExpression(a);
  const tokensB = tokenizeMathExpression(b);

  if (tokensA.errors.length > 0 || tokensB.errors.length > 0) {
    return false;
  }

  const astResultA = buildAST(tokensA.tokens);
  const astResultB = buildAST(tokensB.tokens);

  if (!astResultA.ast || !astResultB.ast) {
    return false;
  }

  // Collect all variables from both expressions
  const varsA = collectVariables(astResultA.ast);
  const varsB = collectVariables(astResultB.ast);
  const allVars = new Set([...varsA, ...varsB]);

  // If no variables, just compare values directly
  if (allVars.size === 0) {
    const resultA = evaluateExpression(a);
    const resultB = evaluateExpression(b);
    if (resultA.value === null || resultB.value === null) return false;
    return Math.abs(resultA.value - resultB.value) <= tolerance;
  }

  // Generate random test points and compare
  // Use a seeded sequence for reproducibility
  const testPoints = generateTestPoints(allVars, numTests);

  for (const point of testPoints) {
    const resultA = evaluateExpression(a, point);
    const resultB = evaluateExpression(b, point);

    // Skip invalid points (division by zero, sqrt of negative, etc.)
    if (resultA.value === null || resultB.value === null) {
      continue;
    }

    // Compare with tolerance
    if (Math.abs(resultA.value - resultB.value) > tolerance) {
      return false;
    }
  }

  return true;
}

/** Collect all variable names from an AST */
function collectVariables(node: ASTNode): Set<string> {
  const vars = new Set<string>();

  function traverse(n: ASTNode): void {
    switch (n.type) {
      case "number":
        break;
      case "variable":
        vars.add(n.name);
        break;
      case "unary":
        traverse(n.operand);
        break;
      case "binary":
        traverse(n.left);
        traverse(n.right);
        break;
    }
  }

  traverse(node);
  return vars;
}

/** Generate random test points for a set of variables */
function generateTestPoints(vars: Set<string>, numTests: number): Record<string, number>[] {
  const points: Record<string, number>[] = [];
  const varList = Array.from(vars);

  // Use a deterministic sequence for reproducibility
  // Mix of positive, negative, fractional values - designed to avoid cancellation
  // Each row represents values for up to 8 variables that won't accidentally cancel
  const testRows = [
    [0.5, 1.3, 2.1, 0.7, 1.9, 3.2, 0.4, 2.7],
    [1.1, -0.6, 2.3, 1.5, -0.8, 1.7, 2.9, -0.3],
    [-0.7, 1.8, -1.2, 2.4, 0.9, -1.6, 3.1, 1.4],
    [2.2, 0.4, -1.5, 0.8, 2.6, -0.9, 1.3, -1.1],
    [0.3, -1.4, 3.0, -0.5, 1.2, 2.5, -1.8, 0.6],
    [-1.3, 2.0, 0.6, -1.7, 0.2, 1.1, -2.1, 3.3],
    [1.7, -0.2, 1.4, 3.5, -1.0, 0.5, 2.3, -0.4],
    [0.9, 1.6, -0.8, 1.1, 2.8, -1.3, 0.7, 2.0],
    [-0.4, 2.7, 1.0, -0.9, 1.5, 3.0, -0.6, 1.8],
    [2.5, -1.1, 0.3, 2.2, -0.7, 1.9, 0.1, -1.5],
  ];

  for (let i = 0; i < numTests; i++) {
    const point: Record<string, number> = {};
    const row = testRows[i % testRows.length]!;
    for (let j = 0; j < varList.length; j++) {
      const varName = varList[j] as string;
      // Use values from the row, cycling if more variables than row length
      point[varName] = row[j % row.length]!;
    }
    points.push(point);
  }

  return points;
}

// ============================================================================
// EXPRESSION FORMATTING
// ============================================================================

/** Options for formatting expressions */
export interface FormatOptions {
  /** Use Unicode operators (× instead of *, ÷ instead of /) */
  useUnicode?: boolean;
  /** Add spaces around binary operators */
  spaces?: boolean;
  /** Normalize minus sign to Unicode − */
  normalizeMinus?: boolean;
}

/** Map ASCII operators to Unicode equivalents */
const UNICODE_OPERATORS: Record<string, string> = {
  "*": "×",
  "/": "÷",
  "-": "−",
};

/**
 * Format tokens into a pretty-printed expression string
 *
 * @example
 * const tokens = tokenizeMathExpression("2*3/4").tokens;
 * formatExpression(tokens, { useUnicode: true, spaces: true });
 * // Returns: "2 × 3 ÷ 4"
 */
export function formatExpression(tokens: MathToken[], options: FormatOptions = {}): string {
  const { useUnicode = false, spaces = true, normalizeMinus = false } = options;

  let result = "";
  let prevToken: MathToken | null = null;

  for (const token of tokens) {
    let value = token.value;

    // Convert to Unicode if requested
    if (token.type === "operator") {
      if (useUnicode && UNICODE_OPERATORS[value]) {
        value = UNICODE_OPERATORS[value] as string;
      } else if (normalizeMinus && value === "-") {
        value = "−";
      }
    }

    // Add spacing
    if (prevToken && spaces) {
      const needsSpace = shouldAddSpace(prevToken, token);
      if (needsSpace) {
        result += " ";
      }
    }

    result += value;
    prevToken = token;
  }

  return result;
}

/** Determine if a space should be added between two tokens */
function shouldAddSpace(prev: MathToken, curr: MathToken): boolean {
  // No space after opening paren or before closing paren
  if (prev.type === "paren" && /[([{]/.test(prev.value)) return false;
  if (curr.type === "paren" && /[)\]}]/.test(curr.value)) return false;

  // No space before postfix operators
  if (curr.type === "operator" && (curr.value === "²" || curr.value === "³")) return false;

  // No space after unary prefix operators
  if (prev.type === "operator" && prev.arity === 1 && prev.value !== "²" && prev.value !== "³") {
    return false;
  }

  // Space around binary operators
  if (curr.type === "operator" && curr.arity === 2) return true;
  if (prev.type === "operator" && prev.arity === 2) return true;

  return false;
}

// ============================================================================
// EXPRESSION EVALUATION
// ============================================================================

/** Result of expression evaluation */
export interface EvalResult {
  value: number | null;
  error?: string;
}

/**
 * Evaluate a math expression with optional variable bindings
 * Returns null if evaluation fails (e.g., unbound variables, division by zero)
 *
 * @example
 * evaluateExpression("2 + 3 * 4"); // { value: 14 }
 * evaluateExpression("x² + y²", { x: 3, y: 4 }); // { value: 25 }
 * evaluateExpression("10 / 0"); // { value: null, error: "Division by zero" }
 */
export function evaluateExpression(expr: string, vars: Record<string, number> = {}): EvalResult {
  // Tokenize
  const { tokens, errors } = tokenizeMathExpression(expr);
  if (errors.length > 0) {
    return { value: null, error: errors[0] };
  }

  // Validate
  const validation = validateExpression(expr);
  if (!validation.valid) {
    return { value: null, error: validation.error };
  }

  // Build AST
  const { ast, error } = buildAST(tokens);
  if (error || !ast) {
    return { value: null, error: error ?? "Failed to build AST" };
  }

  // Evaluate
  return evaluateAST(ast, vars);
}

/** Evaluate an AST node */
function evaluateAST(node: ASTNode, vars: Record<string, number>): EvalResult {
  switch (node.type) {
    case "number":
      return { value: node.value };

    case "variable": {
      const val = vars[node.name];
      if (val === undefined) {
        return { value: null, error: `Unbound variable: ${node.name}` };
      }
      return { value: val };
    }

    case "unary": {
      const operand = evaluateAST(node.operand, vars);
      if (operand.error || operand.value === null) return operand;

      switch (node.operator) {
        case "-":
        case "−":
          return { value: -operand.value };
        case "+":
          return { value: operand.value };
        case "√":
          if (operand.value < 0) {
            return { value: null, error: "Square root of negative number" };
          }
          return { value: Math.sqrt(operand.value) };
        case "²":
          return { value: operand.value * operand.value };
        case "³":
          return { value: operand.value * operand.value * operand.value };
        default:
          return { value: null, error: `Unknown unary operator: ${node.operator}` };
      }
    }

    case "binary": {
      const left = evaluateAST(node.left, vars);
      if (left.error || left.value === null) return left;

      const right = evaluateAST(node.right, vars);
      if (right.error || right.value === null) return right;

      switch (node.operator) {
        case "+":
          return { value: left.value + right.value };
        case "-":
        case "−":
          return { value: left.value - right.value };
        case "*":
        case "×":
        case "·":
          return { value: left.value * right.value };
        case "/":
        case "÷":
          if (right.value === 0) {
            return { value: null, error: "Division by zero" };
          }
          return { value: left.value / right.value };
        case "%":
          if (right.value === 0) {
            return { value: null, error: "Modulo by zero" };
          }
          return { value: left.value % right.value };
        case "^":
          return { value: left.value ** right.value };
        default:
          return { value: null, error: `Unknown binary operator: ${node.operator}` };
      }
    }
  }
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
