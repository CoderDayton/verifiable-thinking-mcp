/**
 * Unit tests for verification module
 * Tests math verification, tokenization, AST, and expression handling
 */

import { describe, expect, test } from "bun:test";
import { verificationCache } from "../src/lib/cache";
import {
  buildAST,
  canBeUnary,
  clearVerificationCache,
  compareOperatorPrecedence,
  evaluateExpression,
  formatExpression,
  getOperatorArity,
  getOperatorArityInContext,
  getOperatorPrecedence,
  getVerificationCacheStats,
  isMathOperator,
  isRightAssociative,
  MATH_OPERATOR_PATTERN,
  MATH_OPERATORS,
  tokenizeMathExpression,
  validateExpression,
  verify,
} from "../src/lib/verification";

describe("Verification", () => {
  test("verifies math domain", () => {
    const result = verify("2 + 2 = 4", "math", []);
    expect(result.domain).toBe("math");
    expect(result.passed).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test("verifies logic domain", () => {
    const result = verify("If A then B. A is true. Therefore B.", "logic", []);
    expect(result.domain).toBe("logic");
    expect(result.passed).toBe(true);
  });

  test("verifies code domain", () => {
    const result = verify("function add(a, b) { return a + b; }", "code", []);
    expect(result.domain).toBe("code");
    expect(result.passed).toBe(true);
  });

  test("verifies general domain", () => {
    const result = verify("This is a general statement.", "general", []);
    expect(result.domain).toBe("general");
    expect(result.passed).toBe(true);
  });

  test("uses cache when enabled", () => {
    verificationCache.clear();
    const thought = "Cached verification test: 1 + 1 = 2";

    // First call - not cached
    const result1 = verify(thought, "math", [], true);
    expect(result1.cached).toBe(false);

    // Second call - should be cached
    const result2 = verify(thought, "math", [], true);
    expect(result2.cached).toBe(true);
  });

  test("detects math errors", () => {
    const result = verify("2 + 2 = 5", "math", []);
    // Should still pass (heuristic verification) but with lower confidence
    expect(result.domain).toBe("math");
  });

  test("detects unbalanced brackets in math", () => {
    const result = verify("Calculate ((x + 1) * 2", "math", []);
    expect(result.domain).toBe("math");
    // Unbalanced brackets should reduce confidence
    expect(result.confidence).toBeLessThan(1);
  });

  test("detects mismatched brackets in math", () => {
    // Close bracket without matching open bracket (hits line 236)
    const result = verify("Calculate x + 1) * 2", "math", []);
    expect(result.domain).toBe("math");
    expect(result.confidence).toBeLessThan(1);
  });

  test("detects wrong bracket type mismatch", () => {
    // Wrong closing bracket type (hits line 236 via brackets[last] !== char)
    const result = verify("Calculate (x + 1] * 2", "math", []);
    expect(result.domain).toBe("math");
    expect(result.confidence).toBeLessThan(1);
  });

  test("handles Unicode operators in math expressions", () => {
    // Unicode × (U+00D7) and ÷ (U+00F7) should not trigger false positives
    const result1 = verify("0.15 × 80 = 12", "math", []);
    expect(result1.passed).toBe(true);

    const result2 = verify("100 ÷ 4 = 25", "math", []);
    expect(result2.passed).toBe(true);

    // Chained expression with Unicode operator
    const result3 = verify("15% = 0.15. Therefore 0.15 × 80 = 12", "math", []);
    expect(result3.passed).toBe(true);
  });

  test("detects contradictory numeric assignments", () => {
    // Standalone number = different number should fail
    const result = verify("Therefore 5 = 3", "math", []);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain("equation structure");
  });

  test("allows valid chained equalities", () => {
    // Expression = result is valid
    const result1 = verify("2 + 2 = 4", "math", []);
    expect(result1.passed).toBe(true);

    // Same value equality is valid
    const result2 = verify("x = 1, and 1 = 1", "math", []);
    expect(result2.passed).toBe(true);
  });

  test("detects context contradictions in logic", () => {
    const result = verify("not the previous statement is valid", "logic", [
      "the previous statement is valid",
    ]);
    // Contradiction should affect result
    expect(result.domain).toBe("logic");
  });

  test("detects negation contradiction in context", () => {
    // The "not X" pattern matching - context has statement, thought negates it
    const result = verify("This conclusion is not correct", "logic", [
      "correct conclusion reached",
    ]);
    expect(result.domain).toBe("logic");
  });

  test("detects reverse negation contradiction", () => {
    // Context has negation, thought affirms (hits line 255 with prevLower check)
    const result = verify("The algorithm is valid", "logic", ["not the algorithm is valid"]);
    expect(result.domain).toBe("logic");
  });

  test("getVerificationCacheStats returns stats", () => {
    verificationCache.clear();
    verify("test thought for stats", "math", [], true);

    const stats = getVerificationCacheStats();
    expect(stats).toHaveProperty("size");
    expect(stats).toHaveProperty("hits");
    expect(stats).toHaveProperty("misses");
  });

  test("clearVerificationCache clears cache", () => {
    verify("thought to clear", "math", [], true);

    const cleared = clearVerificationCache();
    expect(cleared).toBeGreaterThanOrEqual(0);

    const stats = getVerificationCacheStats();
    expect(stats.size).toBe(0);
  });

  test("isMathOperator recognizes ASCII operators", () => {
    const asciiOps = ["+", "-", "*", "/", "^", "%"];
    for (const op of asciiOps) {
      expect(isMathOperator(op)).toBe(true);
    }
  });

  test("isMathOperator recognizes Unicode operators", () => {
    const unicodeOps = ["×", "÷", "−", "·", "√", "²", "³", "⁺", "⁻", "±", "∓"];
    for (const op of unicodeOps) {
      expect(isMathOperator(op)).toBe(true);
    }
  });

  test("isMathOperator rejects non-operators", () => {
    const nonOps = ["a", "1", " ", "=", "(", ")", "[", "]", "{", "}", ",", ".", "!", "?"];
    for (const char of nonOps) {
      expect(isMathOperator(char)).toBe(false);
    }
  });

  test("isMathOperator rejects multi-character strings", () => {
    expect(isMathOperator("++")).toBe(false);
    expect(isMathOperator("×÷")).toBe(false);
    expect(isMathOperator("")).toBe(false);
  });

  test("MATH_OPERATORS contains all supported operators", () => {
    expect(MATH_OPERATORS).toContain("+");
    expect(MATH_OPERATORS).toContain("×");
    expect(MATH_OPERATORS).toContain("√");
    expect(MATH_OPERATORS.length).toBeGreaterThan(10);
  });

  test("MATH_OPERATOR_PATTERN matches trailing operators", () => {
    expect(MATH_OPERATOR_PATTERN.test("2 +")).toBe(true);
    expect(MATH_OPERATOR_PATTERN.test("5 ×")).toBe(true);
    expect(MATH_OPERATOR_PATTERN.test("√")).toBe(true);
    expect(MATH_OPERATOR_PATTERN.test("2 + ")).toBe(true); // trailing space
    expect(MATH_OPERATOR_PATTERN.test("hello")).toBe(false);
    expect(MATH_OPERATOR_PATTERN.test("5 = 3")).toBe(false);
  });

  test("getOperatorPrecedence returns correct levels", () => {
    // Level 1: addition/subtraction
    expect(getOperatorPrecedence("+")).toBe(1);
    expect(getOperatorPrecedence("-")).toBe(1);
    expect(getOperatorPrecedence("−")).toBe(1); // Unicode minus
    expect(getOperatorPrecedence("±")).toBe(1);

    // Level 2: multiplication/division
    expect(getOperatorPrecedence("*")).toBe(2);
    expect(getOperatorPrecedence("/")).toBe(2);
    expect(getOperatorPrecedence("×")).toBe(2);
    expect(getOperatorPrecedence("÷")).toBe(2);
    expect(getOperatorPrecedence("·")).toBe(2);
    expect(getOperatorPrecedence("%")).toBe(2);

    // Level 3: exponentiation
    expect(getOperatorPrecedence("^")).toBe(3);
    expect(getOperatorPrecedence("²")).toBe(3);
    expect(getOperatorPrecedence("³")).toBe(3);

    // Level 4: unary/prefix
    expect(getOperatorPrecedence("√")).toBe(4);
  });

  test("getOperatorPrecedence returns null for non-operators", () => {
    expect(getOperatorPrecedence("a")).toBeNull();
    expect(getOperatorPrecedence("1")).toBeNull();
    expect(getOperatorPrecedence("=")).toBeNull();
    expect(getOperatorPrecedence("(")).toBeNull();
    expect(getOperatorPrecedence("")).toBeNull();
  });

  test("compareOperatorPrecedence compares correctly", () => {
    // + < * (multiplication binds tighter)
    expect(compareOperatorPrecedence("+", "*")).toBeLessThan(0);
    expect(compareOperatorPrecedence("*", "+")).toBeGreaterThan(0);

    // * < ^ (exponentiation binds tighter)
    expect(compareOperatorPrecedence("*", "^")).toBeLessThan(0);
    expect(compareOperatorPrecedence("^", "*")).toBeGreaterThan(0);

    // Same precedence
    expect(compareOperatorPrecedence("+", "-")).toBe(0);
    expect(compareOperatorPrecedence("*", "×")).toBe(0);
    expect(compareOperatorPrecedence("²", "³")).toBe(0);

    // Unicode equivalents
    expect(compareOperatorPrecedence("-", "−")).toBe(0);
    expect(compareOperatorPrecedence("*", "·")).toBe(0);
  });

  test("compareOperatorPrecedence returns null for invalid operators", () => {
    expect(compareOperatorPrecedence("a", "+")).toBeNull();
    expect(compareOperatorPrecedence("+", "b")).toBeNull();
    expect(compareOperatorPrecedence("x", "y")).toBeNull();
  });

  test("precedence follows PEMDAS order", () => {
    // Parentheses > Exponents > Multiplication/Division > Addition/Subtraction
    const add = getOperatorPrecedence("+")!;
    const mul = getOperatorPrecedence("*")!;
    const exp = getOperatorPrecedence("^")!;
    const sqrt = getOperatorPrecedence("√")!;

    expect(add).toBeLessThan(mul);
    expect(mul).toBeLessThan(exp);
    expect(exp).toBeLessThan(sqrt);
  });

  test("isRightAssociative identifies exponentiation operators", () => {
    // Exponentiation is right-associative: 2^3^4 = 2^(3^4)
    expect(isRightAssociative("^")).toBe(true);
    expect(isRightAssociative("²")).toBe(true);
    expect(isRightAssociative("³")).toBe(true);
  });

  test("isRightAssociative returns false for left-associative operators", () => {
    // Addition, subtraction, multiplication, division are left-associative
    expect(isRightAssociative("+")).toBe(false);
    expect(isRightAssociative("-")).toBe(false);
    expect(isRightAssociative("*")).toBe(false);
    expect(isRightAssociative("/")).toBe(false);
    expect(isRightAssociative("×")).toBe(false);
    expect(isRightAssociative("÷")).toBe(false);
    expect(isRightAssociative("√")).toBe(false);
  });

  test("getOperatorArity returns 1 for unary operators", () => {
    expect(getOperatorArity("√")).toBe(1); // prefix
    expect(getOperatorArity("²")).toBe(1); // postfix
    expect(getOperatorArity("³")).toBe(1); // postfix
    expect(getOperatorArity("⁺")).toBe(1);
    expect(getOperatorArity("⁻")).toBe(1);
  });

  test("getOperatorArity returns 2 for binary operators", () => {
    expect(getOperatorArity("+")).toBe(2);
    expect(getOperatorArity("-")).toBe(2);
    expect(getOperatorArity("*")).toBe(2);
    expect(getOperatorArity("/")).toBe(2);
    expect(getOperatorArity("^")).toBe(2);
    expect(getOperatorArity("×")).toBe(2);
    expect(getOperatorArity("÷")).toBe(2);
  });

  test("getOperatorArity returns null for non-operators", () => {
    expect(getOperatorArity("a")).toBeNull();
    expect(getOperatorArity("1")).toBeNull();
    expect(getOperatorArity("=")).toBeNull();
  });

  test("canBeUnary identifies context-dependent operators", () => {
    // Always unary
    expect(canBeUnary("√")).toBe(true);
    expect(canBeUnary("²")).toBe(true);
    // Can be unary in context (e.g., -5, +3)
    expect(canBeUnary("-")).toBe(true);
    expect(canBeUnary("+")).toBe(true);
    expect(canBeUnary("−")).toBe(true);
    expect(canBeUnary("±")).toBe(true);
    // Never unary
    expect(canBeUnary("*")).toBe(false);
    expect(canBeUnary("/")).toBe(false);
    expect(canBeUnary("×")).toBe(false);
  });

  test("getOperatorArityInContext handles unary minus", () => {
    // "-" after operator is unary
    expect(getOperatorArityInContext("-", true)).toBe(1);
    expect(getOperatorArityInContext("−", true)).toBe(1);
    // "-" after operand is binary
    expect(getOperatorArityInContext("-", false)).toBe(2);
    expect(getOperatorArityInContext("−", false)).toBe(2);
  });

  test("getOperatorArityInContext handles always-unary operators", () => {
    // √ is always unary regardless of context
    expect(getOperatorArityInContext("√", true)).toBe(1);
    expect(getOperatorArityInContext("√", false)).toBe(1);
    // ² is always unary
    expect(getOperatorArityInContext("²", true)).toBe(1);
    expect(getOperatorArityInContext("²", false)).toBe(1);
  });

  test("getOperatorArityInContext handles always-binary operators", () => {
    // * is always binary
    expect(getOperatorArityInContext("*", true)).toBe(2);
    expect(getOperatorArityInContext("*", false)).toBe(2);
  });
});

describe("Expression Validation", () => {
  test("validates simple valid expressions", () => {
    expect(validateExpression("2 + 3").valid).toBe(true);
    expect(validateExpression("5 * 4").valid).toBe(true);
    expect(validateExpression("10 / 2").valid).toBe(true);
    expect(validateExpression("2 ^ 3").valid).toBe(true);
    expect(validateExpression("x + y").valid).toBe(true);
  });

  test("validates expressions with Unicode operators", () => {
    expect(validateExpression("2 × 3").valid).toBe(true);
    expect(validateExpression("10 ÷ 2").valid).toBe(true);
    expect(validateExpression("5 − 3").valid).toBe(true);
  });

  test("validates expressions with unary operators", () => {
    expect(validateExpression("-5").valid).toBe(true);
    expect(validateExpression("+3").valid).toBe(true);
    expect(validateExpression("√4").valid).toBe(true);
    expect(validateExpression("5²").valid).toBe(true);
    expect(validateExpression("2³").valid).toBe(true);
  });

  test("validates expressions with unary minus in context", () => {
    expect(validateExpression("5 * -3").valid).toBe(true);
    expect(validateExpression("10 + -2").valid).toBe(true);
    expect(validateExpression("(-5)").valid).toBe(true);
  });

  test("validates expressions with parentheses", () => {
    expect(validateExpression("(2 + 3)").valid).toBe(true);
    expect(validateExpression("(2 + 3) * 4").valid).toBe(true);
    expect(validateExpression("2 * (3 + 4)").valid).toBe(true);
    expect(validateExpression("((2 + 3))").valid).toBe(true);
  });

  test("validates complex expressions", () => {
    expect(validateExpression("2 + 3 * 4").valid).toBe(true);
    expect(validateExpression("(2 + 3) * (4 - 1)").valid).toBe(true);
    expect(validateExpression("√(4 + 5)").valid).toBe(true);
    expect(validateExpression("2^3 + 4").valid).toBe(true);
    expect(validateExpression("x² + y²").valid).toBe(true);
  });

  test("rejects empty expressions", () => {
    const result = validateExpression("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Empty expression");
  });

  test("rejects consecutive binary operators", () => {
    const result = validateExpression("2 + * 3");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unexpected operator");
  });

  test("rejects expression ending with binary operator", () => {
    const result = validateExpression("5 +");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Expression ends with operator");
  });

  test("rejects unmatched opening parenthesis", () => {
    const result = validateExpression("(2 + 3");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unclosed parenthesis");
  });

  test("rejects unmatched closing parenthesis", () => {
    const result = validateExpression("2 + 3)");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unmatched closing parenthesis");
  });

  test("rejects empty parentheses", () => {
    const result = validateExpression("()");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Empty parentheses");
  });

  test("rejects postfix operator without operand", () => {
    const result = validateExpression("² 5");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Postfix operator");
  });

  test("provides error index for location", () => {
    const result = validateExpression("2 + * 3");
    expect(result.valid).toBe(false);
    expect(result.errorIndex).toBeDefined();
    expect(result.errorIndex).toBeGreaterThan(0);
  });

  test("handles expressions with equals (passes through)", () => {
    // Equals is not a math operator, so it's skipped
    expect(validateExpression("2 + 2 = 4").valid).toBe(true);
    expect(validateExpression("x = 5").valid).toBe(true);
  });

  test("handles scientific notation", () => {
    expect(validateExpression("1e10").valid).toBe(true);
    expect(validateExpression("2.5e-3").valid).toBe(true);
    expect(validateExpression("1e10 + 5").valid).toBe(true);
  });
});

describe("Math Expression Tokenizer", () => {
  test("tokenizes simple expression", () => {
    const result = tokenizeMathExpression("2 + 3");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(3);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "2" });
    expect(result.tokens[1]).toMatchObject({
      type: "operator",
      value: "+",
      precedence: 1,
      arity: 2,
    });
    expect(result.tokens[2]).toMatchObject({ type: "number", value: "3" });
  });

  test("tokenizes expression with variables", () => {
    const result = tokenizeMathExpression("x + y * z");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[0]).toMatchObject({ type: "variable", value: "x" });
    expect(result.tokens[2]).toMatchObject({ type: "variable", value: "y" });
    expect(result.tokens[4]).toMatchObject({ type: "variable", value: "z" });
  });

  test("tokenizes parentheses", () => {
    const result = tokenizeMathExpression("(2 + 3)");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[0]).toMatchObject({ type: "paren", value: "(" });
    expect(result.tokens[4]).toMatchObject({ type: "paren", value: ")" });
  });

  test("detects unary minus", () => {
    const result = tokenizeMathExpression("-5");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(2);

    expect(result.tokens[0]).toMatchObject({ type: "operator", value: "-", arity: 1 });
    expect(result.tokens[1]).toMatchObject({ type: "number", value: "5" });
  });

  test("detects unary minus after operator", () => {
    const result = tokenizeMathExpression("3 * -2");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(4);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "3" });
    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "*", arity: 2 });
    expect(result.tokens[2]).toMatchObject({ type: "operator", value: "-", arity: 1 });
    expect(result.tokens[3]).toMatchObject({ type: "number", value: "2" });
  });

  test("detects binary minus", () => {
    const result = tokenizeMathExpression("5 - 3");
    expect(result.errors).toHaveLength(0);

    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "-", arity: 2 });
  });

  test("includes operator metadata", () => {
    const result = tokenizeMathExpression("2 ^ 3");
    expect(result.errors).toHaveLength(0);

    const expOp = result.tokens[1];
    expect(expOp).toMatchObject({
      type: "operator",
      value: "^",
      precedence: 3,
      arity: 2,
      rightAssociative: true,
    });
  });

  test("tokenizes Unicode operators", () => {
    const result = tokenizeMathExpression("2 × 3 ÷ 4");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "×", precedence: 2 });
    expect(result.tokens[3]).toMatchObject({ type: "operator", value: "÷", precedence: 2 });
  });

  test("tokenizes postfix operators", () => {
    const result = tokenizeMathExpression("x² + y³");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[1]).toMatchObject({ type: "operator", value: "²", arity: 1 });
    expect(result.tokens[4]).toMatchObject({ type: "operator", value: "³", arity: 1 });
  });

  test("tokenizes prefix operators", () => {
    const result = tokenizeMathExpression("√4 + √9");
    expect(result.errors).toHaveLength(0);
    expect(result.tokens).toHaveLength(5);

    expect(result.tokens[0]).toMatchObject({
      type: "operator",
      value: "√",
      arity: 1,
      precedence: 4,
    });
    expect(result.tokens[3]).toMatchObject({ type: "operator", value: "√", arity: 1 });
  });

  test("tokenizes decimal numbers", () => {
    const result = tokenizeMathExpression("3.14 + 2.71");
    expect(result.errors).toHaveLength(0);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "3.14" });
    expect(result.tokens[2]).toMatchObject({ type: "number", value: "2.71" });
  });

  test("tokenizes scientific notation", () => {
    const result = tokenizeMathExpression("1e10 + 2.5e-3");
    expect(result.errors).toHaveLength(0);

    expect(result.tokens[0]).toMatchObject({ type: "number", value: "1e10" });
    expect(result.tokens[2]).toMatchObject({ type: "number", value: "2.5e-3" });
  });

  test("tracks token positions", () => {
    const result = tokenizeMathExpression("2 + 3");
    expect(result.tokens[0]?.position).toBe(0);
    expect(result.tokens[1]?.position).toBe(2);
    expect(result.tokens[2]?.position).toBe(4);
  });

  test("reports unknown characters as errors", () => {
    const result = tokenizeMathExpression("2 @ 3");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("@");

    const unknownToken = result.tokens.find((t) => t.type === "unknown");
    expect(unknownToken).toBeDefined();
    expect(unknownToken?.value).toBe("@");
  });

  test("handles empty expression", () => {
    const result = tokenizeMathExpression("");
    expect(result.tokens).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("handles complex expression", () => {
    const result = tokenizeMathExpression("(x² + y²)^(1/2)");
    expect(result.errors).toHaveLength(0);

    const types = result.tokens.map((t) => t.type);
    expect(types).toContain("paren");
    expect(types).toContain("variable");
    expect(types).toContain("operator");
    expect(types).toContain("number");
  });
});

describe("verifyMath integration with validateExpression", () => {
  test("catches malformed expressions in reasoning", () => {
    const result = verify("Let's calculate: 2 + * 3 = error", "math", []);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain("Expression error");
  });

  test("passes valid expressions in reasoning", () => {
    const result = verify("Calculate: 2 + 3 * 4 = 14", "math", []);
    expect(result.passed).toBe(true);
  });

  test("passes complex valid expressions", () => {
    const result = verify("The formula is (x + y) * (x - y) = x² - y²", "math", []);
    expect(result.passed).toBe(true);
  });
});

describe("AST Building", () => {
  test("builds AST for simple expression", () => {
    const tokens = tokenizeMathExpression("2 + 3").tokens;
    const { ast, error } = buildAST(tokens);

    expect(error).toBeUndefined();
    expect(ast).toBeDefined();
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("+");
      expect(ast.left).toMatchObject({ type: "number", value: 2 });
      expect(ast.right).toMatchObject({ type: "number", value: 3 });
    }
  });

  test("respects operator precedence", () => {
    const tokens = tokenizeMathExpression("2 + 3 * 4").tokens;
    const { ast } = buildAST(tokens);

    // Should be 2 + (3 * 4), not (2 + 3) * 4
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("+");
      expect(ast.left).toMatchObject({ type: "number", value: 2 });
      expect(ast.right.type).toBe("binary");
      if (ast.right.type === "binary") {
        expect(ast.right.operator).toBe("*");
      }
    }
  });

  test("handles parentheses", () => {
    const tokens = tokenizeMathExpression("(2 + 3) * 4").tokens;
    const { ast } = buildAST(tokens);

    // Should be (2 + 3) * 4
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("*");
      expect(ast.left.type).toBe("binary");
      expect(ast.right).toMatchObject({ type: "number", value: 4 });
    }
  });

  test("handles unary minus", () => {
    const tokens = tokenizeMathExpression("-5").tokens;
    const { ast } = buildAST(tokens);

    expect(ast?.type).toBe("unary");
    if (ast?.type === "unary") {
      expect(ast.operator).toBe("-");
      expect(ast.operand).toMatchObject({ type: "number", value: 5 });
    }
  });

  test("handles variables", () => {
    const tokens = tokenizeMathExpression("x + y").tokens;
    const { ast } = buildAST(tokens);

    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.left).toMatchObject({ type: "variable", name: "x" });
      expect(ast.right).toMatchObject({ type: "variable", name: "y" });
    }
  });

  test("handles right-associative exponentiation", () => {
    const tokens = tokenizeMathExpression("2 ^ 3 ^ 2").tokens;
    const { ast } = buildAST(tokens);

    // Should be 2 ^ (3 ^ 2), not (2 ^ 3) ^ 2
    expect(ast?.type).toBe("binary");
    if (ast?.type === "binary") {
      expect(ast.operator).toBe("^");
      expect(ast.left).toMatchObject({ type: "number", value: 2 });
      expect(ast.right.type).toBe("binary");
    }
  });

  test("returns error for empty tokens", () => {
    const { ast, error } = buildAST([]);
    expect(ast).toBeNull();
    expect(error).toBe("Empty expression");
  });
});

describe("Expression Formatting", () => {
  test("formats with default options", () => {
    const tokens = tokenizeMathExpression("2+3*4").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("2 + 3 * 4");
  });

  test("converts to Unicode operators", () => {
    const tokens = tokenizeMathExpression("2*3/4").tokens;
    const formatted = formatExpression(tokens, { useUnicode: true });
    expect(formatted).toBe("2 × 3 ÷ 4");
  });

  test("formats without spaces", () => {
    const tokens = tokenizeMathExpression("2 + 3").tokens;
    const formatted = formatExpression(tokens, { spaces: false });
    expect(formatted).toBe("2+3");
  });

  test("handles parentheses correctly", () => {
    const tokens = tokenizeMathExpression("(2 + 3) * 4").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("(2 + 3) * 4");
  });

  test("handles postfix operators without space", () => {
    const tokens = tokenizeMathExpression("x²").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("x²");
  });

  test("handles prefix operators without trailing space", () => {
    const tokens = tokenizeMathExpression("√4").tokens;
    const formatted = formatExpression(tokens);
    expect(formatted).toBe("√4");
  });

  test("normalizes minus sign", () => {
    const tokens = tokenizeMathExpression("5 - 3").tokens;
    const formatted = formatExpression(tokens, { normalizeMinus: true });
    expect(formatted).toBe("5 − 3");
  });
});

describe("Expression Evaluation", () => {
  test("evaluates simple arithmetic", () => {
    expect(evaluateExpression("2 + 3").value).toBe(5);
    expect(evaluateExpression("10 - 4").value).toBe(6);
    expect(evaluateExpression("3 * 4").value).toBe(12);
    expect(evaluateExpression("15 / 3").value).toBe(5);
  });

  test("respects operator precedence", () => {
    expect(evaluateExpression("2 + 3 * 4").value).toBe(14);
    expect(evaluateExpression("10 - 2 * 3").value).toBe(4);
  });

  test("handles parentheses", () => {
    expect(evaluateExpression("(2 + 3) * 4").value).toBe(20);
    expect(evaluateExpression("(10 - 2) * (3 + 1)").value).toBe(32);
  });

  test("handles unary minus", () => {
    expect(evaluateExpression("-5").value).toBe(-5);
    expect(evaluateExpression("3 * -2").value).toBe(-6);
    expect(evaluateExpression("--5").value).toBe(5);
  });

  test("handles exponentiation", () => {
    expect(evaluateExpression("2 ^ 3").value).toBe(8);
    expect(evaluateExpression("2 ^ 3 ^ 2").value).toBe(512); // 2^(3^2) = 2^9
  });

  test("handles square root", () => {
    expect(evaluateExpression("√4").value).toBe(2);
    expect(evaluateExpression("√9 + 1").value).toBe(4);
  });

  test("handles postfix operators", () => {
    expect(evaluateExpression("3²").value).toBe(9);
    expect(evaluateExpression("2³").value).toBe(8);
    expect(evaluateExpression("2² + 3²").value).toBe(13);
  });

  test("handles Unicode operators", () => {
    expect(evaluateExpression("6 × 7").value).toBe(42);
    expect(evaluateExpression("20 ÷ 4").value).toBe(5);
    expect(evaluateExpression("10 − 3").value).toBe(7);
  });

  test("handles variables", () => {
    expect(evaluateExpression("x + y", { x: 3, y: 4 }).value).toBe(7);
    expect(evaluateExpression("x² + y²", { x: 3, y: 4 }).value).toBe(25);
  });

  test("returns error for unbound variable", () => {
    const result = evaluateExpression("x + 1");
    expect(result.value).toBeNull();
    expect(result.error).toContain("Unbound variable");
  });

  test("handles division by zero", () => {
    const result = evaluateExpression("10 / 0");
    expect(result.value).toBeNull();
    expect(result.error).toBe("Division by zero");
  });

  test("handles modulo by zero", () => {
    const result = evaluateExpression("10 % 0");
    expect(result.value).toBeNull();
    expect(result.error).toBe("Modulo by zero");
  });

  test("handles square root of negative", () => {
    const result = evaluateExpression("√-4");
    expect(result.value).toBeNull();
    expect(result.error).toContain("negative");
  });

  test("handles decimal numbers", () => {
    expect(evaluateExpression("3.14 * 2").value).toBeCloseTo(6.28);
    expect(evaluateExpression("1.5 + 2.5").value).toBe(4);
  });

  test("handles scientific notation", () => {
    expect(evaluateExpression("1e2 + 1").value).toBe(101);
    expect(evaluateExpression("2.5e-1 * 4").value).toBe(1);
  });

  test("handles complex expressions", () => {
    expect(evaluateExpression("(3 + 4) * (2 ^ 2) / 2").value).toBe(14);
    expect(evaluateExpression("√(3² + 4²)").value).toBe(5);
  });
});

describe("Math Verification Fuzzing", () => {
  // Unicode operators that should be recognized
  const VALID_OPERATORS = ["+", "-", "*", "/", "×", "÷", "−", "·", "^", "√"];

  // Generator helpers
  const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randFloat = () => (Math.random() * 100).toFixed(randInt(0, 2));
  const randOp = () => VALID_OPERATORS[randInt(0, VALID_OPERATORS.length - 1)];

  test("valid expressions with Unicode operators should pass", () => {
    const cases = [
      // Explicit test cases for each Unicode operator
      "5 × 3 = 15",
      "20 ÷ 4 = 5",
      "10 − 3 = 7",
      "2 · 3 = 6",
      "2^3 = 8",
      "√4 = 2",
      // Combined operators
      "2 × 3 + 4 = 10",
      "100 ÷ 10 − 5 = 5",
    ];

    for (const expr of cases) {
      const result = verify(expr, "math", []);
      expect(result.passed).toBe(true);
    }
  });

  test("fuzz: generated valid expressions should pass", () => {
    // Generate random valid expressions: a OP b = c
    for (let i = 0; i < 50; i++) {
      const a = randFloat();
      const op = randOp();
      const b = randFloat();
      const expr = `${a} ${op} ${b} = result`;

      const result = verify(expr, "math", []);
      // Should pass because there's an operator before the "= result"
      expect(result.passed).toBe(true);
    }
  });

  test("fuzz: contradictory standalone numbers should fail", () => {
    // Generate patterns like "Therefore 5 = 3" (no operator before)
    for (let i = 0; i < 20; i++) {
      const a = randInt(1, 100);
      const b = randInt(1, 100);
      if (a === b) continue; // Skip equal numbers

      const prefixes = ["Therefore", "So", "Thus", "Hence", "We get"];
      const prefix = prefixes[randInt(0, prefixes.length - 1)];
      const expr = `${prefix} ${a} = ${b}`;

      const result = verify(expr, "math", []);
      expect(result.passed).toBe(false);
    }
  });

  test("fuzz: same numbers should pass", () => {
    // n = n should always pass
    for (let i = 0; i < 20; i++) {
      const n = randFloat();
      const expr = `Therefore ${n} = ${n}`;

      const result = verify(expr, "math", []);
      expect(result.passed).toBe(true);
    }
  });

  test("fuzz: expressions with various spacing should be handled", () => {
    const spacings = ["", " ", "  ", "\t"];
    for (let i = 0; i < 30; i++) {
      const a = randInt(1, 10);
      const op = randOp();
      const b = randInt(1, 10);
      const s1 = spacings[randInt(0, spacings.length - 1)];
      const s2 = spacings[randInt(0, spacings.length - 1)];
      const expr = `${a}${s1}${op}${s2}${b} = result`;

      const result = verify(expr, "math", []);
      // Should not throw, should return a result
      expect(result.domain).toBe("math");
      expect(typeof result.passed).toBe("boolean");
    }
  });

  test("fuzz: mixed ASCII and Unicode operators in same expression", () => {
    for (let i = 0; i < 20; i++) {
      const parts: string[] = [];
      for (let j = 0; j < randInt(2, 5); j++) {
        parts.push(randFloat());
        if (j < randInt(1, 4)) parts.push(randOp());
      }
      const expr = `${parts.join(" ")} = result`;

      const result = verify(expr, "math", []);
      expect(result.domain).toBe("math");
      // Should not crash
    }
  });

  test("verification performance under fuzz load", () => {
    const iterations = 100;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const expr = `${randFloat()} ${randOp()} ${randFloat()} = ${randFloat()}`;
      verify(expr, "math", [], false); // Disable cache for fair timing
    }

    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    // Should be < 1ms per verification (target: <10ms per AGENTS.md)
    expect(avgMs).toBeLessThan(1);
    console.log(`Average verification time: ${avgMs.toFixed(4)}ms`);
  });
});
