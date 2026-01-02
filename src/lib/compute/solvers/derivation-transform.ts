/**
 * Derivation Transform - AST utilities and transformation patterns
 *
 * Contains helper functions for AST manipulation and a registry of
 * algebraic transformation patterns for simplification.
 *
 * @module derivation-transform
 */

import type { ASTNode, BinaryNode } from "../../math/ast.ts";

/**
 * Normalize operator symbols to canonical form
 */
export function normalizeOperator(op: string): string {
  if (op === "−") return "-";
  if (op === "×" || op === "·") return "*";
  if (op === "÷") return "/";
  return op;
}

/**
 * Check if an AST node contains a specific pattern
 */
export function containsPattern(node: ASTNode, predicate: (n: ASTNode) => boolean): boolean {
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
 */
export function isBinaryOp(node: ASTNode, op: string): node is BinaryNode {
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
 */
export function nodesEqual(a: ASTNode, b: ASTNode): boolean {
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

/**
 * Greatest common divisor (for fraction simplification check)
 */
export function gcd(a: number, b: number): number {
  a = Math.abs(Math.floor(a));
  b = Math.abs(Math.floor(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/** Pattern for transformation suggestions */
export interface TransformPattern {
  name: string;
  description: string;
  priority: number;
  applies: (ast: ASTNode) => boolean;
}

/** Transformation patterns in priority order */
export const TRANSFORM_PATTERNS: TransformPattern[] = [
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
 * Apply a single transformation to an AST and return the result
 */
export function applyTransformation(
  ast: ASTNode,
  transformName: string,
): { transformed: ASTNode; applied: boolean } {
  // Deep clone the AST to avoid mutation
  const clone = JSON.parse(JSON.stringify(ast)) as ASTNode;

  let applied = false;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AST transformation requires exhaustive pattern matching across all operators
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
