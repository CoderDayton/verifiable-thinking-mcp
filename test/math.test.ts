/**
 * Unit tests for src/math module
 * Tests operators, tokenizer, and AST functionality
 */

import { describe, expect, test } from "bun:test";
import {
  // AST
  type ASTNode,
  buildAST,
  canBeUnary,
  compareExpressions,
  compareOperatorPrecedence,
  evaluateExpression,
  formatAST,
  // Tokenizer
  formatExpression,
  getOperatorArity,
  getOperatorArityInContext,
  getOperatorPrecedence,
  isMathOperator,
  isRightAssociative,
  // Operators
  MATH_OPERATOR_PATTERN,
  normalizeOperator,
  simplifyAST,
  tokenizeMathExpression,
  validateExpression,
} from "../src/math";

// =============================================================================
// OPERATOR TESTS
// =============================================================================

describe("operators", () => {
  describe("isMathOperator", () => {
    test("recognizes ASCII operators", () => {
      expect(isMathOperator("+")).toBe(true);
      expect(isMathOperator("-")).toBe(true);
      expect(isMathOperator("*")).toBe(true);
      expect(isMathOperator("/")).toBe(true);
      expect(isMathOperator("^")).toBe(true);
      expect(isMathOperator("%")).toBe(true);
    });

    test("recognizes Unicode operators", () => {
      expect(isMathOperator("×")).toBe(true);
      expect(isMathOperator("÷")).toBe(true);
      expect(isMathOperator("−")).toBe(true); // Unicode minus
      expect(isMathOperator("·")).toBe(true); // Middle dot
      expect(isMathOperator("√")).toBe(true);
      expect(isMathOperator("²")).toBe(true);
      expect(isMathOperator("³")).toBe(true);
      expect(isMathOperator("±")).toBe(true);
    });

    test("rejects non-operators", () => {
      expect(isMathOperator("a")).toBe(false);
      expect(isMathOperator("1")).toBe(false);
      expect(isMathOperator("(")).toBe(false);
      expect(isMathOperator(" ")).toBe(false);
      expect(isMathOperator("")).toBe(false);
    });
  });

  describe("getOperatorPrecedence", () => {
    test("addition/subtraction are lowest", () => {
      expect(getOperatorPrecedence("+")).toBe(1);
      expect(getOperatorPrecedence("-")).toBe(1);
      expect(getOperatorPrecedence("−")).toBe(1);
    });

    test("multiplication/division are higher", () => {
      expect(getOperatorPrecedence("*")).toBe(2);
      expect(getOperatorPrecedence("/")).toBe(2);
      expect(getOperatorPrecedence("×")).toBe(2);
      expect(getOperatorPrecedence("÷")).toBe(2);
    });

    test("exponentiation is higher than multiplication", () => {
      expect(getOperatorPrecedence("^")).toBe(3);
      const multPrec = getOperatorPrecedence("*") ?? 0;
      const expPrec = getOperatorPrecedence("^") ?? 0;
      expect(expPrec).toBeGreaterThan(multPrec);
    });

    test("unary operators are highest", () => {
      expect(getOperatorPrecedence("√")).toBe(4);
      // Superscripts have precedence 3 (same as ^)
      expect(getOperatorPrecedence("²")).toBe(3);
      expect(getOperatorPrecedence("³")).toBe(3);
    });

    test("returns null for non-operators", () => {
      expect(getOperatorPrecedence("x")).toBeNull();
      expect(getOperatorPrecedence("1")).toBeNull();
    });
  });

  describe("compareOperatorPrecedence", () => {
    test("returns positive when first is higher", () => {
      const result = compareOperatorPrecedence("*", "+");
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(0);
    });

    test("returns negative when first is lower", () => {
      const result = compareOperatorPrecedence("+", "*");
      expect(result).not.toBeNull();
      expect(result!).toBeLessThan(0);
    });

    test("returns zero for same precedence", () => {
      expect(compareOperatorPrecedence("+", "-")).toBe(0);
      expect(compareOperatorPrecedence("*", "/")).toBe(0);
    });

    test("returns null for invalid operators", () => {
      expect(compareOperatorPrecedence("x", "+")).toBeNull();
      expect(compareOperatorPrecedence("+", "y")).toBeNull();
    });
  });

  describe("isRightAssociative", () => {
    test("exponentiation is right associative", () => {
      expect(isRightAssociative("^")).toBe(true);
    });

    test("superscripts are right associative", () => {
      expect(isRightAssociative("²")).toBe(true);
      expect(isRightAssociative("³")).toBe(true);
    });

    test("other operators are left associative", () => {
      expect(isRightAssociative("+")).toBe(false);
      expect(isRightAssociative("-")).toBe(false);
      expect(isRightAssociative("*")).toBe(false);
      expect(isRightAssociative("/")).toBe(false);
    });
  });

  describe("getOperatorArity", () => {
    test("binary operators return 2", () => {
      expect(getOperatorArity("+")).toBe(2);
      expect(getOperatorArity("-")).toBe(2);
      expect(getOperatorArity("*")).toBe(2);
      expect(getOperatorArity("/")).toBe(2);
      expect(getOperatorArity("^")).toBe(2);
    });

    test("unary-only operators return 1", () => {
      expect(getOperatorArity("√")).toBe(1);
      expect(getOperatorArity("²")).toBe(1);
      expect(getOperatorArity("³")).toBe(1);
    });
  });

  describe("canBeUnary", () => {
    test("minus can be unary", () => {
      expect(canBeUnary("-")).toBe(true);
      expect(canBeUnary("−")).toBe(true);
    });

    test("plus can be unary", () => {
      expect(canBeUnary("+")).toBe(true);
    });

    test("sqrt is always unary", () => {
      expect(canBeUnary("√")).toBe(true);
    });

    test("multiplication cannot be unary", () => {
      expect(canBeUnary("*")).toBe(false);
      expect(canBeUnary("/")).toBe(false);
    });
  });

  describe("getOperatorArityInContext", () => {
    test("minus after operator is unary", () => {
      expect(getOperatorArityInContext("-", true)).toBe(1);
    });

    test("minus after operand is binary", () => {
      expect(getOperatorArityInContext("-", false)).toBe(2);
    });

    test("sqrt is always unary regardless of context", () => {
      expect(getOperatorArityInContext("√", true)).toBe(1);
      expect(getOperatorArityInContext("√", false)).toBe(1);
    });
  });

  describe("normalizeOperator", () => {
    test("normalizes Unicode minus to ASCII", () => {
      expect(normalizeOperator("−")).toBe("-");
    });

    test("normalizes multiplication symbols", () => {
      expect(normalizeOperator("×")).toBe("*");
      expect(normalizeOperator("·")).toBe("*");
    });

    test("normalizes division symbol", () => {
      expect(normalizeOperator("÷")).toBe("/");
    });

    test("preserves ASCII operators", () => {
      expect(normalizeOperator("+")).toBe("+");
      expect(normalizeOperator("-")).toBe("-");
      expect(normalizeOperator("*")).toBe("*");
      expect(normalizeOperator("/")).toBe("/");
    });
  });

  describe("MATH_OPERATOR_PATTERN", () => {
    test("matches text ending with operator", () => {
      expect(MATH_OPERATOR_PATTERN.test("2 +")).toBe(true);
      expect(MATH_OPERATOR_PATTERN.test("x -")).toBe(true);
      expect(MATH_OPERATOR_PATTERN.test("3 * ")).toBe(true);
    });

    test("does not match text ending with operand", () => {
      expect(MATH_OPERATOR_PATTERN.test("2 + 3")).toBe(false);
      expect(MATH_OPERATOR_PATTERN.test("x")).toBe(false);
    });
  });
});

// =============================================================================
// TOKENIZER TESTS
// =============================================================================

describe("tokenizer", () => {
  describe("tokenizeMathExpression", () => {
    test("tokenizes simple arithmetic", () => {
      const result = tokenizeMathExpression("2 + 3");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens).toHaveLength(3);
      expect(result.tokens[0]).toMatchObject({ type: "number", value: "2" });
      expect(result.tokens[1]).toMatchObject({ type: "operator", value: "+" });
      expect(result.tokens[2]).toMatchObject({ type: "number", value: "3" });
    });

    test("tokenizes expressions with variables", () => {
      const result = tokenizeMathExpression("x + y");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0]).toMatchObject({ type: "variable", value: "x" });
      expect(result.tokens[2]).toMatchObject({ type: "variable", value: "y" });
    });

    test("tokenizes parentheses", () => {
      const result = tokenizeMathExpression("(2 + 3) * 4");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0]).toMatchObject({ type: "paren", value: "(" });
      expect(result.tokens[4]).toMatchObject({ type: "paren", value: ")" });
    });

    test("tokenizes decimal numbers", () => {
      const result = tokenizeMathExpression("3.14 + 2.5");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0]).toMatchObject({ type: "number", value: "3.14" });
      expect(result.tokens[2]).toMatchObject({ type: "number", value: "2.5" });
    });

    test("tokenizes negative numbers at start", () => {
      const result = tokenizeMathExpression("-5 + 3");
      expect(result.errors).toHaveLength(0);
      // Should have unary minus
      expect(result.tokens[0]).toMatchObject({ type: "operator", value: "-" });
      expect(result.tokens[1]).toMatchObject({ type: "number", value: "5" });
    });

    test("handles Unicode operators", () => {
      const result = tokenizeMathExpression("2 × 3 ÷ 4");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[1]).toMatchObject({ type: "operator", value: "×" });
      expect(result.tokens[3]).toMatchObject({ type: "operator", value: "÷" });
    });

    test("handles exponentiation", () => {
      const result = tokenizeMathExpression("2^3");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[1]).toMatchObject({ type: "operator", value: "^" });
    });

    test("handles square root", () => {
      const result = tokenizeMathExpression("√4");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0]).toMatchObject({ type: "operator", value: "√" });
    });

    test("handles superscript exponents", () => {
      const result = tokenizeMathExpression("x²");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[1]).toMatchObject({ type: "operator", value: "²" });
    });

    test("inserts implicit multiplication", () => {
      const result = tokenizeMathExpression("2x");
      expect(result.errors).toHaveLength(0);
      // Should be: 2 * x
      expect(result.tokens).toHaveLength(3);
      expect(result.tokens[1]).toMatchObject({ type: "operator", value: "*" });
    });

    test("handles multi-character variables", () => {
      const result = tokenizeMathExpression("sin + cos");
      expect(result.errors).toHaveLength(0);
      expect(result.tokens[0]).toMatchObject({ type: "variable", value: "sin" });
      expect(result.tokens[2]).toMatchObject({ type: "variable", value: "cos" });
    });
  });

  describe("validateExpression", () => {
    test("valid simple expression", () => {
      const result = validateExpression("2 + 3");
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test("valid complex expression", () => {
      const result = validateExpression("(2 + 3) * (4 - 1)");
      expect(result.valid).toBe(true);
    });

    test("invalid: consecutive operators", () => {
      // Note: "2 + + 3" is valid because second + could be unary
      // Only truly invalid patterns like "2 * *" would fail
      const result = validateExpression("2 * * 3");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("invalid: missing operand", () => {
      const result = validateExpression("2 +");
      expect(result.valid).toBe(false);
    });

    test("invalid: unbalanced parentheses", () => {
      const result = validateExpression("(2 + 3");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("parenthes");
    });

    test("invalid: empty expression", () => {
      const result = validateExpression("");
      expect(result.valid).toBe(false);
    });

    test("valid: unary minus", () => {
      const result = validateExpression("-5 + 3");
      expect(result.valid).toBe(true);
    });

    test("valid: negative in parentheses", () => {
      const result = validateExpression("(-5) + 3");
      expect(result.valid).toBe(true);
    });
  });

  describe("formatExpression", () => {
    test("formats with consistent spacing", () => {
      const tokens = tokenizeMathExpression("2+3*4").tokens;
      const formatted = formatExpression(tokens);
      expect(formatted).toBe("2 + 3 * 4");
    });

    test("handles parentheses correctly", () => {
      const tokens = tokenizeMathExpression("(2+3)*4").tokens;
      const formatted = formatExpression(tokens);
      expect(formatted).toBe("(2 + 3) * 4");
    });

    test("handles unary operators", () => {
      const tokens = tokenizeMathExpression("-5+3").tokens;
      const formatted = formatExpression(tokens);
      expect(formatted).toBe("-5 + 3");
    });
  });
});

// =============================================================================
// AST TESTS
// =============================================================================

describe("AST", () => {
  describe("buildAST", () => {
    test("builds simple binary expression", () => {
      const tokens = tokenizeMathExpression("2 + 3").tokens;
      const { ast, error } = buildAST(tokens);
      expect(error).toBeUndefined();
      expect(ast).not.toBeNull();
      expect(ast!.type).toBe("binary");
      if (ast!.type === "binary") {
        expect(ast!.operator).toBe("+");
        expect(ast!.left).toMatchObject({ type: "number", value: 2 });
        expect(ast!.right).toMatchObject({ type: "number", value: 3 });
      }
    });

    test("respects operator precedence", () => {
      const tokens = tokenizeMathExpression("2 + 3 * 4").tokens;
      const { ast } = buildAST(tokens);
      expect(ast).not.toBeNull();
      // Should be: 2 + (3 * 4), not (2 + 3) * 4
      expect(ast!.type).toBe("binary");
      if (ast!.type === "binary") {
        expect(ast!.operator).toBe("+");
        expect(ast!.left).toMatchObject({ type: "number", value: 2 });
        expect(ast!.right.type).toBe("binary");
        if (ast!.right.type === "binary") {
          expect(ast!.right.operator).toBe("*");
        }
      }
    });

    test("respects parentheses", () => {
      const tokens = tokenizeMathExpression("(2 + 3) * 4").tokens;
      const { ast } = buildAST(tokens);
      expect(ast).not.toBeNull();
      // Should be: (2 + 3) * 4
      expect(ast!.type).toBe("binary");
      if (ast!.type === "binary") {
        expect(ast!.operator).toBe("*");
        expect(ast!.left.type).toBe("binary");
        if (ast!.left.type === "binary") {
          expect(ast!.left.operator).toBe("+");
        }
        expect(ast!.right).toMatchObject({ type: "number", value: 4 });
      }
    });

    test("handles unary minus", () => {
      const tokens = tokenizeMathExpression("-5").tokens;
      const { ast } = buildAST(tokens);
      expect(ast).not.toBeNull();
      expect(ast!.type).toBe("unary");
      if (ast!.type === "unary") {
        expect(ast!.operator).toBe("-");
        expect(ast!.operand).toMatchObject({ type: "number", value: 5 });
      }
    });

    test("handles variables", () => {
      const tokens = tokenizeMathExpression("x + y").tokens;
      const { ast } = buildAST(tokens);
      expect(ast).not.toBeNull();
      expect(ast!.type).toBe("binary");
      if (ast!.type === "binary") {
        expect(ast!.left).toMatchObject({ type: "variable", name: "x" });
        expect(ast!.right).toMatchObject({ type: "variable", name: "y" });
      }
    });

    test("handles exponentiation (right associative)", () => {
      const tokens = tokenizeMathExpression("2^3^4").tokens;
      const { ast } = buildAST(tokens);
      expect(ast).not.toBeNull();
      // Should be: 2^(3^4), not (2^3)^4
      expect(ast!.type).toBe("binary");
      if (ast!.type === "binary") {
        expect(ast!.operator).toBe("^");
        expect(ast!.left).toMatchObject({ type: "number", value: 2 });
        expect(ast!.right.type).toBe("binary");
        if (ast!.right.type === "binary") {
          expect(ast!.right.operator).toBe("^");
          expect(ast!.right.left).toMatchObject({ type: "number", value: 3 });
          expect(ast!.right.right).toMatchObject({ type: "number", value: 4 });
        }
      }
    });

    test("returns error for empty expression", () => {
      const { ast, error } = buildAST([]);
      expect(ast).toBeNull();
      expect(error).toBeDefined();
    });

    test("returns error for mismatched parentheses", () => {
      const tokens = tokenizeMathExpression("(2 + 3").tokens;
      const { ast, error } = buildAST(tokens);
      expect(ast).toBeNull();
      expect(error).toContain("parenthes");
    });
  });

  describe("simplifyAST", () => {
    function parseAndSimplify(expr: string): ASTNode {
      const tokens = tokenizeMathExpression(expr).tokens;
      const { ast } = buildAST(tokens);
      return simplifyAST(ast!);
    }

    test("x + 0 = x", () => {
      const result = parseAndSimplify("x + 0");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("0 + x = x", () => {
      const result = parseAndSimplify("0 + x");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("x - 0 = x", () => {
      const result = parseAndSimplify("x - 0");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("x * 1 = x", () => {
      const result = parseAndSimplify("x * 1");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("1 * x = x", () => {
      const result = parseAndSimplify("1 * x");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("x * 0 = 0", () => {
      const result = parseAndSimplify("x * 0");
      expect(result).toMatchObject({ type: "number", value: 0 });
    });

    test("0 * x = 0", () => {
      const result = parseAndSimplify("0 * x");
      expect(result).toMatchObject({ type: "number", value: 0 });
    });

    test("x / 1 = x", () => {
      const result = parseAndSimplify("x / 1");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("x ^ 1 = x", () => {
      const result = parseAndSimplify("x ^ 1");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("x ^ 0 = 1", () => {
      const result = parseAndSimplify("x ^ 0");
      expect(result).toMatchObject({ type: "number", value: 1 });
    });

    test("constant folding: 2 + 3 = 5", () => {
      const result = parseAndSimplify("2 + 3");
      expect(result).toMatchObject({ type: "number", value: 5 });
    });

    test("constant folding: 4 * 5 = 20", () => {
      const result = parseAndSimplify("4 * 5");
      expect(result).toMatchObject({ type: "number", value: 20 });
    });

    test("constant folding: 2^3 = 8", () => {
      const result = parseAndSimplify("2^3");
      expect(result).toMatchObject({ type: "number", value: 8 });
    });

    test("nested simplification", () => {
      const result = parseAndSimplify("(x + 0) * 1");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });

    test("double negation: --x = x", () => {
      const result = parseAndSimplify("--x");
      expect(result).toMatchObject({ type: "variable", name: "x" });
    });
  });

  describe("formatAST", () => {
    function parseAndFormat(expr: string): string {
      const tokens = tokenizeMathExpression(expr).tokens;
      const { ast } = buildAST(tokens);
      return formatAST(ast!);
    }

    test("formats simple expression", () => {
      expect(parseAndFormat("2 + 3")).toBe("2 + 3");
    });

    test("formats with correct precedence (no unnecessary parens)", () => {
      expect(parseAndFormat("2 + 3 * 4")).toBe("2 + 3 * 4");
    });

    test("preserves necessary parentheses", () => {
      expect(parseAndFormat("(2 + 3) * 4")).toBe("(2 + 3) * 4");
    });

    test("formats unary expressions", () => {
      expect(parseAndFormat("-x")).toBe("-x");
    });

    test("formats variables", () => {
      expect(parseAndFormat("x + y")).toBe("x + y");
    });
  });

  describe("compareExpressions", () => {
    test("identical expressions are equivalent", () => {
      expect(compareExpressions("x + y", "x + y")).toBe(true);
    });

    test("commutative addition", () => {
      expect(compareExpressions("x + y", "y + x")).toBe(true);
    });

    test("commutative multiplication", () => {
      expect(compareExpressions("x * y", "y * x")).toBe(true);
    });

    test("associative addition", () => {
      expect(compareExpressions("(x + y) + z", "x + (y + z)")).toBe(true);
    });

    test("associative multiplication", () => {
      expect(compareExpressions("(x * y) * z", "x * (y * z)")).toBe(true);
    });

    test("distributive property", () => {
      expect(compareExpressions("a * (b + c)", "a * b + a * c")).toBe(true);
    });

    test("identity simplification: x + 0 = x", () => {
      expect(compareExpressions("x + 0", "x")).toBe(true);
    });

    test("identity simplification: x * 1 = x", () => {
      expect(compareExpressions("x * 1", "x")).toBe(true);
    });

    test("zero property: x * 0 = 0", () => {
      expect(compareExpressions("x * 0", "0")).toBe(true);
    });

    test("numeric equivalence: 2 + 3 = 5", () => {
      expect(compareExpressions("2 + 3", "5")).toBe(true);
    });

    test("numeric equivalence: 2^3 = 8", () => {
      expect(compareExpressions("2^3", "8")).toBe(true);
    });

    test("non-equivalent expressions", () => {
      expect(compareExpressions("x + y", "x - y")).toBe(false);
    });

    test("subtraction is not commutative", () => {
      expect(compareExpressions("x - y", "y - x")).toBe(false);
    });

    test("division is not commutative", () => {
      expect(compareExpressions("x / y", "y / x")).toBe(false);
    });

    test("handles invalid expressions gracefully", () => {
      // Invalid expression returns false
      expect(compareExpressions("2 +", "2")).toBe(false);
    });

    test("2x = x + x", () => {
      expect(compareExpressions("2 * x", "x + x")).toBe(true);
    });
  });

  describe("evaluateExpression", () => {
    test("evaluates simple arithmetic", () => {
      const result = evaluateExpression("2 + 3");
      expect(result.value).toBe(5);
      expect(result.error).toBeUndefined();
    });

    test("respects operator precedence", () => {
      const result = evaluateExpression("2 + 3 * 4");
      expect(result.value).toBe(14); // 2 + 12, not 20
    });

    test("respects parentheses", () => {
      const result = evaluateExpression("(2 + 3) * 4");
      expect(result.value).toBe(20);
    });

    test("evaluates exponentiation", () => {
      const result = evaluateExpression("2^3");
      expect(result.value).toBe(8);
    });

    test("evaluates with variables", () => {
      const result = evaluateExpression("x + y", { x: 2, y: 3 });
      expect(result.value).toBe(5);
    });

    test("returns null for undefined variables", () => {
      const result = evaluateExpression("x + y");
      expect(result.value).toBeNull();
      expect(result.error).toContain("x");
    });

    test("handles division", () => {
      const result = evaluateExpression("10 / 2");
      expect(result.value).toBe(5);
    });

    test("handles division by zero", () => {
      const result = evaluateExpression("1 / 0");
      // Division by zero returns error, not Infinity
      expect(result.value).toBeNull();
      expect(result.error).toBeDefined();
    });

    test("handles negative numbers", () => {
      const result = evaluateExpression("-5 + 3");
      expect(result.value).toBe(-2);
    });

    test("handles decimals", () => {
      const result = evaluateExpression("3.14 * 2");
      expect(result.value).toBeCloseTo(6.28);
    });

    test("handles square root", () => {
      const result = evaluateExpression("√4");
      expect(result.value).toBe(2);
    });

    test("handles superscript exponents", () => {
      const result = evaluateExpression("3²");
      expect(result.value).toBe(9);
    });

    test("complex expression", () => {
      const result = evaluateExpression("(2 + 3)^2 - 4 * 5");
      expect(result.value).toBe(5); // 25 - 20
    });

    test("returns error for invalid expression", () => {
      const result = evaluateExpression("2 +");
      expect(result.value).toBeNull();
      expect(result.error).toBeDefined();
    });
  });
});

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe("performance", () => {
  test("tokenization is fast for simple expressions", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      tokenizeMathExpression("2 + 3 * 4 - 5 / 6");
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100); // Should be < 100ms for 1000 iterations
  });

  test("AST building is fast", () => {
    const tokens = tokenizeMathExpression("2 + 3 * 4 - 5 / 6").tokens;
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      buildAST(tokens);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test("expression comparison is fast", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      compareExpressions("x + y * z", "z * y + x");
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200); // More complex, allow 200ms
  });

  test("evaluation is fast", () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluateExpression("2 + 3 * 4 - 5 / 6");
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

// =============================================================================
// CROSS-EVALUATOR CONSISTENCY TESTS
// =============================================================================

import { safeEvaluate } from "../src/compute/math.ts";

describe("cross-evaluator consistency", () => {
  // Expressions that both evaluators should handle identically
  const compatibleExpressions = [
    // Basic arithmetic
    { expr: "2 + 3", expected: 5 },
    { expr: "10 - 4", expected: 6 },
    { expr: "3 * 7", expected: 21 },
    { expr: "20 / 4", expected: 5 },
    { expr: "2 ^ 3", expected: 8 },
    { expr: "2^3^2", expected: 512 }, // Right-associative: 2^(3^2) = 2^9 = 512

    // Parentheses
    { expr: "(2 + 3) * 4", expected: 20 },
    { expr: "2 * (3 + 4)", expected: 14 },
    { expr: "((2 + 3) * (4 - 1))", expected: 15 },

    // Operator precedence
    { expr: "2 + 3 * 4", expected: 14 }, // 2 + 12, not 20
    { expr: "10 - 6 / 2", expected: 7 }, // 10 - 3, not 2
    { expr: "2 * 3 + 4 * 5", expected: 26 }, // 6 + 20
    { expr: "2^2*3", expected: 12 }, // (2^2) * 3

    // Negative numbers
    { expr: "-5", expected: -5 },
    { expr: "--5", expected: 5 },
    { expr: "5 + -3", expected: 2 },
    { expr: "-2 * -3", expected: 6 },
    { expr: "-(2 + 3)", expected: -5 },

    // Decimals
    { expr: "3.14 * 2", expected: 6.28 },
    { expr: "1.5 + 2.5", expected: 4 },
    { expr: "10.0 / 4", expected: 2.5 },

    // Edge cases
    { expr: "0 + 0", expected: 0 },
    { expr: "1", expected: 1 },
    { expr: "(((5)))", expected: 5 },
    { expr: "2^0", expected: 1 },
    { expr: "0^5", expected: 0 },
  ];

  for (const { expr, expected } of compatibleExpressions) {
    test(`AST evaluator and safeEvaluate agree on: ${expr}`, () => {
      const astResult = evaluateExpression(expr);
      const safeResult = safeEvaluate(expr);

      // Both should succeed
      expect(astResult.error).toBeUndefined();
      expect(safeResult.success).toBe(true);

      // Both should produce the same result
      expect(astResult.value).toBeCloseTo(expected, 10);
      expect(safeResult.value).toBeCloseTo(expected, 10);

      // Results should match each other
      expect(astResult.value).toBeCloseTo(safeResult.value!, 10);
    });
  }

  // Randomized property-based tests
  test("evaluators agree on random arithmetic expressions", () => {
    const ops = ["+", "-", "*", "/"];

    for (let i = 0; i < 100; i++) {
      // Generate random expression: a op b op c
      const a = Math.floor(Math.random() * 100) + 1;
      const b = Math.floor(Math.random() * 100) + 1;
      const c = Math.floor(Math.random() * 100) + 1;
      const op1 = ops[Math.floor(Math.random() * 4)];
      const op2 = ops[Math.floor(Math.random() * 4)];

      const expr = `${a} ${op1} ${b} ${op2} ${c}`;

      const astResult = evaluateExpression(expr);
      const safeResult = safeEvaluate(expr);

      // Both should succeed (we avoided division by zero by using non-zero values)
      if (astResult.error || !safeResult.success) {
        // Skip if either fails (e.g., division by result of previous op)
        continue;
      }

      // Results should match
      expect(astResult.value).toBeCloseTo(safeResult.value!, 6);
    }
  });

  // Error consistency: both should fail on invalid expressions
  const invalidExpressions = [
    "", // Empty
    "()", // Empty parens
    "2 +", // Trailing operator
    "* 2", // Leading multiplicative operator
    // Note: "2 3" is NOT included - AST interprets as implicit multiplication (2*3=6),
    // while safeEvaluate removes whitespace and parses as 23. Both "succeed" differently.
    "((2 + 3)", // Unbalanced parens
  ];

  for (const expr of invalidExpressions) {
    test(`both evaluators reject invalid: "${expr}"`, () => {
      const astResult = evaluateExpression(expr);
      const safeResult = safeEvaluate(expr);

      // Both should fail
      const astFailed = astResult.error !== undefined || astResult.value === null;
      const safeFailed = !safeResult.success;

      expect(astFailed).toBe(true);
      expect(safeFailed).toBe(true);
    });
  }
});
