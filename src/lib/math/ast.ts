/**
 * Math Expression AST (Abstract Syntax Tree)
 * Building, simplification, formatting, comparison, and evaluation of math expressions
 */

import { isRightAssociative, normalizeOperator } from "./operators.ts";
import { type MathToken, tokenizeMathExpression, validateExpression } from "./tokenizer.ts";

// =============================================================================
// AST NODE TYPES
// =============================================================================

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

// =============================================================================
// AST BUILDING (Shunting-Yard Algorithm)
// =============================================================================

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

// =============================================================================
// AST SIMPLIFICATION
// =============================================================================

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

// =============================================================================
// AST FORMATTING
// =============================================================================

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

// =============================================================================
// EXPRESSION COMPARISON
// =============================================================================

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

// =============================================================================
// EXPRESSION EVALUATION
// =============================================================================

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
