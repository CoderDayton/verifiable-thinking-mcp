/**
 * Math Operator Utilities
 * Constants and functions for handling mathematical operators (ASCII + Unicode)
 */

// Common math operators including Unicode variants from LaTeX/Word
// ASCII: + - * / ^ %
// Unicode: × ÷ − · √ ² ³ ⁿ ± ∓
// Also handles √ before numbers (prefix operator)

/** All recognized math operator characters (ASCII + Unicode) */
export const MATH_OPERATORS = "+-*/^%×÷−·√²³⁺⁻±∓" as const;

/** Pattern to check if text ends with a math operator */
export const MATH_OPERATOR_PATTERN = /[+\-*/^%×÷−·√²³⁺⁻±∓]\s*$/;

/** Pattern to match a single math operator character */
export const SINGLE_OPERATOR_PATTERN = /^[+\-*/^%×÷−·√²³⁺⁻±∓]$/;

/**
 * Operator precedence levels (higher = binds tighter)
 * Based on standard mathematical conventions:
 * - Level 1: Addition/subtraction (lowest)
 * - Level 2: Multiplication/division
 * - Level 3: Exponentiation
 * - Level 4: Unary/prefix operators (highest)
 */
export const OPERATOR_PRECEDENCE: Record<string, number> = {
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
 * Right-associative operators (evaluated right-to-left)
 * e.g., 2^3^4 = 2^(3^4) = 2^81, not (2^3)^4 = 8^4 = 4096
 */
export const RIGHT_ASSOCIATIVE = new Set(["^", "²", "³"]);

/**
 * Unary operators (take one operand)
 * - Prefix: √4, -5 (when at start or after operator)
 * - Postfix: 5², 3³
 */
export const UNARY_OPERATORS = new Set(["√", "²", "³", "⁺", "⁻"]);

/**
 * Operators that can be either unary or binary depending on context
 * e.g., "-" is binary in "5-3" but unary in "-5" or "5*-3"
 */
export const AMBIGUOUS_OPERATORS = new Set(["-", "−", "+", "±", "∓"]);

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
 * Check if an operator is right-associative
 * Right-associative: 2^3^4 = 2^(3^4)
 * Left-associative (default): 2-3-4 = (2-3)-4
 */
export function isRightAssociative(char: string): boolean {
  return RIGHT_ASSOCIATIVE.has(char);
}

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

/**
 * Normalize operator to canonical ASCII form
 * Converts Unicode operators to their ASCII equivalents:
 * - − → -
 * - × → *
 * - · → *
 * - ÷ → /
 */
export function normalizeOperator(op: string): string {
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
