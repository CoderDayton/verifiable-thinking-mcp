/**
 * Derivation Mistake Detection - detects common algebraic errors
 *
 * Provides pattern-based detection of common student mistakes in
 * algebraic derivations, with explanations and fix suggestions.
 *
 * @module derivation-mistakes
 */

import type { ASTNode, BinaryNode } from "../../math/ast.ts";
import { compareExpressions, formatAST } from "../../verification.ts";
import { extractDerivationSteps } from "./derivation-core.ts";
import { parseToAST } from "./derivation-simplify.ts";
import { gcd, nodesEqual, normalizeOperator } from "./derivation-transform.ts";

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

/** Escape special regex characters */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check for chain rule error: d/dx f(g(x)) missing the inner derivative
 */
function checkChainRuleError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  _rhsAst: ASTNode | null,
): DetectedMistake | null {
  // Match derivative of composite function patterns
  const derivPatterns = [
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*sin\s*\(\s*([^)]+)\s*\)/i,
      outer: "sin",
      outerDeriv: "cos",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*cos\s*\(\s*([^)]+)\s*\)/i,
      outer: "cos",
      outerDeriv: "-sin",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*(?:e\^|exp)\s*\(\s*([^)]+)\s*\)/i,
      outer: "e^",
      outerDeriv: "e^",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
    {
      pattern: /(?:d\/dx|derivative\s+of)\s*ln\s*\(\s*([^)]+)\s*\)/i,
      outer: "ln",
      outerDeriv: "1/",
      getInner: (m: RegExpMatchArray) => m[1]!.trim(),
    },
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

    if (!innerDeriv) continue;

    // Check if the RHS is missing the chain rule factor
    if (outer === "sin") {
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

/**
 * Check for product rule error: d/dx (f * g) missing one term
 */
function checkProductRuleError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  _rhsAst: ASTNode | null,
): DetectedMistake | null {
  const productPattern = /(?:d\/dx|derivative\s+of)\s+(.+?)\s*[*·]\s*(.+?)(?:\s*=|$)/i;
  const match = lhs.match(productPattern);

  if (!match) return null;

  const f = match[1]!.trim();
  const g = match[2]!.trim();

  // Try to compute f' and g' for common cases
  let fDeriv: string | null = null;
  let gDeriv: string | null = null;

  const computePowerDeriv = (expr: string): string | null => {
    const powerMatch = expr.match(/^([a-zA-Z])\s*\^\s*(\d+)$/);
    if (powerMatch) {
      const v = powerMatch[1]!;
      const n = parseInt(powerMatch[2]!, 10);
      if (n === 1) return "1";
      if (n === 2) return `2${v}`;
      return `${n}${v}^${n - 1}`;
    }
    if (/^[a-zA-Z]$/.test(expr)) return "1";
    return null;
  };

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

  if (!fDeriv || !gDeriv) return null;

  // Product rule: f'g + fg'
  const term1 = fDeriv === "1" ? g : `${fDeriv} * ${g}`;
  const term2 = gDeriv === "1" ? f : `${f} * ${gDeriv}`;
  const expectedResult = `${term1} + ${term2}`;

  const rhsNorm = rhs.replace(/\s*([*·+-])\s*/g, " $1 ").trim();

  // Check if RHS is f' * g' (common mistake)
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

  // Check if RHS contains only one of the terms
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
 * Check for sign error: -a + b claimed equal to -(a + b) or similar
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
      stepNumber: 0,
      confidence: 0.9,
      found: rhs,
      expected: expectedVal,
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
 */
function checkDistributionError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "*") {
    const multiplier = lhsAst.left;
    const inner = lhsAst.right;

    if (inner.type === "binary" && (inner.operator === "+" || inner.operator === "-")) {
      if (rhsAst.type === "binary" && (rhsAst.operator === "+" || rhsAst.operator === "-")) {
        const leftIsProduct =
          rhsAst.left.type === "binary" && normalizeOperator(rhsAst.left.operator) === "*";
        const rightIsProduct =
          rhsAst.right.type === "binary" && normalizeOperator(rhsAst.right.operator) === "*";

        if (leftIsProduct !== rightIsProduct) {
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
 * Flatten an addition/subtraction expression into terms with signs
 */
function flattenAddSubDistributed(
  node: ASTNode,
  positive = true,
): Array<{ node: ASTNode; positive: boolean }> {
  if (node.type === "binary" && (node.operator === "+" || node.operator === "-")) {
    const leftTerms = flattenAddSubDistributed(node.left, positive);
    const rightPositive = node.operator === "+" ? positive : !positive;
    const rightTerms = flattenAddSubDistributed(node.right, rightPositive);
    return [...leftTerms, ...rightTerms];
  }
  return [{ node, positive }];
}

/**
 * Check for subtraction distribution error: a - (b + c) = a - b + c instead of a - b - c
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: nested subtraction detection requires deep AST traversal
function checkSubtractionDistributionError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "-") {
    const outerLeft = lhsAst.left;
    const innerGroup = lhsAst.right;

    if (
      innerGroup.type === "binary" &&
      (innerGroup.operator === "+" || innerGroup.operator === "-")
    ) {
      const lhsTerms = flattenAddSubDistributed(lhsAst);
      const rhsTerms = flattenAddSubDistributed(rhsAst);

      if (lhsTerms.length === rhsTerms.length && lhsTerms.length >= 2) {
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

          const hasNestedGroup =
            innerGroup.type === "binary" &&
            (innerGroup.left.type === "binary" || innerGroup.right.type === "binary");
          const nestedNote = hasNestedGroup
            ? " With nested parentheses, distribute the negative through each level."
            : "";

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

      // Fallback check
      if (rhsAst.type === "binary") {
        const innerOp = innerGroup.operator;
        const correctSecondOp = innerOp === "+" ? "-" : "+";
        const foundSecondOp = normalizeOperator(rhsAst.operator);

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
 */
function checkCancellationError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "/") {
    const numerator = lhsAst.left;
    const denominator = lhsAst.right;

    if (numerator.type === "binary" && (numerator.operator === "+" || numerator.operator === "-")) {
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
 */
function checkCoefficientError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  _rhsAst: ASTNode | null,
): DetectedMistake | null {
  const termPattern = /([+-]?)\s*(\d*)([a-zA-Z])(?!\^|\d)/g;

  const lhsTerms: Array<{ coeff: number; variable: string; sign: number }> = [];
  let match: RegExpExecArray | null;
  let isFirst = true;
  while ((match = termPattern.exec(lhs)) !== null) {
    const signStr = match[1] || "";
    const coeffStr = match[2] ?? "";
    const coeff = coeffStr === "" ? 1 : parseInt(coeffStr, 10);
    const variable = match[3]!;
    const sign = signStr === "-" ? -1 : 1;
    lhsTerms.push({ coeff, variable, sign: isFirst && signStr === "" ? 1 : sign });
    isFirst = false;
  }

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
    const rhsTerm = rhsTerms[0]!;
    const rhsCoeff = rhsTerm.coeff * rhsTerm.sign;
    const rhsVar = rhsTerm.variable;

    if (rhsVar && lhsTerms.every((t) => t.variable === rhsVar)) {
      const lhsCoeffs = lhsTerms.map((t) => t.coeff * t.sign);
      const expectedSum = lhsCoeffs.reduce((a, b) => a + b, 0);
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
 */
function checkExponentError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "*") {
    const left = lhsAst.left;
    const right = lhsAst.right;

    if (
      left.type === "binary" &&
      right.type === "binary" &&
      normalizeOperator(left.operator) === "^" &&
      normalizeOperator(right.operator) === "^"
    ) {
      if (nodesEqual(left.left, right.left)) {
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
 */
function checkPowerRuleError(
  lhs: string,
  rhs: string,
  _lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  const derivativePattern = /(?:d\/dx|derivative\s+of|diff(?:erentiate)?)\s*(?:of\s+)?(\w)\^(\d+)/i;
  const match = lhs.match(derivativePattern);

  if (!match) return null;

  const variable = match[1]!;
  const originalExp = parseInt(match[2]!, 10);
  const expectedCoeff = originalExp;
  const expectedExp = originalExp - 1;

  const resultPattern = new RegExp(`(\\d+)${variable}\\^(\\d+)`, "i");
  const resultMatch = rhs.match(resultPattern);

  if (resultMatch) {
    const resultCoeff = parseInt(resultMatch[1]!, 10);
    const resultExp = parseInt(resultMatch[2]!, 10);

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

    if (resultCoeff === 1 && resultExp === expectedExp) {
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

  if (originalExp === 2 && rhsAst?.type === "variable") {
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
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fraction error detection requires extensive pattern matching
function checkFractionAdditionError(
  lhs: string,
  rhs: string,
  lhsAst: ASTNode | null,
  rhsAst: ASTNode | null,
): DetectedMistake | null {
  if (!lhsAst || !rhsAst) return null;

  if (lhsAst.type === "binary" && normalizeOperator(lhsAst.operator) === "+") {
    const left = lhsAst.left;
    const right = lhsAst.right;

    if (
      left.type === "binary" &&
      right.type === "binary" &&
      normalizeOperator(left.operator) === "/" &&
      normalizeOperator(right.operator) === "/"
    ) {
      const a = left.left;
      const b = left.right;
      const c = right.left;
      const d = right.right;

      if (rhsAst.type === "binary" && normalizeOperator(rhsAst.operator) === "/") {
        const resultNum = rhsAst.left;
        const resultDen = rhsAst.right;

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

          if (resultNum.value === wrongNum && resultDen.value === wrongDen) {
            const correctNum = aVal * dVal + bVal * cVal;
            const correctDen = bVal * dVal;
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

        if (resultNum.type === "binary" && resultDen.type === "binary") {
          const numOp = normalizeOperator(resultNum.operator);
          const denOp = normalizeOperator(resultDen.operator);

          if (numOp === "+" && denOp === "+") {
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
