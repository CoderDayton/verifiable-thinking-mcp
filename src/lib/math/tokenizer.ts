/**
 * Math Expression Tokenizer
 * Tokenizes mathematical expressions into structured tokens with operator metadata
 */

import {
  getOperatorArityInContext,
  getOperatorPrecedence,
  isMathOperator,
  isRightAssociative,
} from "./operators.ts";

// =============================================================================
// EXPRESSION VALIDATION
// =============================================================================

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

// =============================================================================
// TOKEN TYPES
// =============================================================================

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

// =============================================================================
// TOKENIZER
// =============================================================================

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

// =============================================================================
// TOKEN FORMATTING
// =============================================================================

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
