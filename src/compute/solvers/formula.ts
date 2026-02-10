/**
 * Formula solver - tiered pattern matching for mathematical formulas
 */

import {
  type ASTNode,
  buildAST,
  simplifyAST,
  tokenizeMathExpression,
} from "../../domain/verification.ts";
import { SolverType } from "../classifier.ts";
import {
  combinations,
  factorial,
  fibonacci,
  formatResult,
  gcd,
  isPrime,
  lcm,
  permutations,
} from "../math.ts";
import { GUARDS, TIER1, TIER2, TIER3, TIER4 } from "../patterns.ts";
import type { ComputeResult, Solver } from "../types.ts";

/** Helper to build a successful ComputeResult @internal */
function solved(result: string | number, method: string, start: number): ComputeResult {
  return {
    solved: true,
    result,
    method,
    confidence: 1.0,
    time_ms: performance.now() - start,
  };
}

/**
 * Matrix determinant using Gaussian elimination
 * O(n³) complexity - works for any NxN matrix
 * @internal
 */
function matrixDeterminant(matrix: number[][]): number | null {
  const n = matrix.length;
  if (n === 0) return 0;
  if (!matrix.every((row) => row.length === n)) return null; // Must be square

  // Special cases for small matrices (faster)
  if (n === 1) {
    const val = matrix[0]?.[0];
    return val !== undefined ? val : null;
  }
  if (n === 2) {
    const a = matrix[0]?.[0];
    const b = matrix[0]?.[1];
    const c = matrix[1]?.[0];
    const d = matrix[1]?.[1];
    if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
    return a * d - b * c;
  }

  // Clone matrix to avoid mutation
  const mat = matrix.map((row) => [...row]);
  let det = 1;

  // Gaussian elimination to upper triangular form
  for (let col = 0; col < n; col++) {
    // Find pivot (largest absolute value in column for numerical stability)
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const current = mat[row]?.[col];
      const best = mat[maxRow]?.[col];
      if (current !== undefined && best !== undefined && Math.abs(current) > Math.abs(best)) {
        maxRow = row;
      }
    }

    // Swap rows if needed
    if (maxRow !== col) {
      const rowCol = mat[col];
      const rowMax = mat[maxRow];
      if (rowCol && rowMax) {
        mat[col] = rowMax;
        mat[maxRow] = rowCol;
        det *= -1; // Row swap changes sign
      }
    }

    // Check for zero pivot (singular matrix)
    const pivot = mat[col]?.[col];
    if (pivot === undefined || Math.abs(pivot) < 1e-10) return 0;

    // Multiply determinant by pivot
    det *= pivot;

    // Eliminate column entries below pivot
    for (let row = col + 1; row < n; row++) {
      const rowArr = mat[row];
      const colArr = mat[col];
      if (!rowArr || !colArr) continue;

      const rowColVal = rowArr[col];
      const pivotVal = colArr[col];
      if (rowColVal === undefined || pivotVal === undefined) continue;

      const factor = rowColVal / pivotVal;
      for (let k = col; k < n; k++) {
        const colK = colArr[k];
        const rowK = rowArr[k];
        if (colK !== undefined && rowK !== undefined) {
          rowArr[k] = rowK - factor * colK;
        }
      }
    }
  }

  return det;
}

/**
 * Parse matrix from various string formats:
 * - [[1,2],[3,4]] - JSON-like
 * - [1,2;3,4] - MATLAB-like
 * - |1 2; 3 4| - bar notation
 * @internal
 */
function parseMatrix(text: string): number[][] | null {
  // Try JSON-like format: [[1,2],[3,4]]
  const jsonMatch = text.match(/\[\s*\[([\d\s,-]+)\]\s*(?:,\s*\[([\d\s,-]+)\]\s*)*\]/);
  if (jsonMatch) {
    try {
      // Extract all rows
      const rowMatches = text.match(/\[([\d\s,-]+)\]/g);
      if (!rowMatches) return null;

      const matrix = rowMatches.map((rowStr) => {
        const nums = rowStr.match(/-?\d+/g);
        return nums ? nums.map(Number) : [];
      });

      // Validate: all rows same length, at least 1x1
      const firstRow = matrix[0];
      if (!firstRow || matrix.length === 0 || firstRow.length === 0) return null;
      if (!matrix.every((row) => row.length === firstRow.length)) return null;

      return matrix;
    } catch {
      return null;
    }
  }

  // Try semicolon format: [1,2;3,4] or 1,2;3,4
  const semiMatch = text.match(/[[|]?\s*([\d\s,;-]+)\s*[\]|]?/);
  if (semiMatch?.[1]?.includes(";")) {
    const rows = semiMatch[1].split(";").map((row) => {
      const nums = row.match(/-?\d+/g);
      return nums ? nums.map(Number) : [];
    });

    const firstRow = rows[0];
    if (firstRow && rows.length > 0 && firstRow.length > 0) {
      if (rows.every((row) => row.length === firstRow.length)) {
        return rows;
      }
    }
  }

  return null;
}

/**
 * Detect decision theory / expected value contexts where we should NOT
 * extract simple percentages or arithmetic.
 *
 * Examples to SKIP:
 * - "100% chance of $50" (probability context)
 * - "expected value" (EV calculation)
 * - "which has higher" (comparison)
 * - "prefers A or B" (preference question)
 * @internal
 */
function isDecisionOrExpectedValueContext(lower: string): boolean {
  return (
    lower.includes("expected value") ||
    lower.includes("which has higher") ||
    lower.includes("prefers") ||
    lower.includes("prefer") ||
    lower.includes("gamble") ||
    (lower.includes("chance") && lower.includes("$")) // "X% chance of $Y"
  );
}

/**
 * TIER 1: Ultra-fast formulas (simple patterns, O(1) compute)
 * - Percentage, factorial, modulo, primality, fibonacci
 * @internal
 */
function tryFormulaTier1(text: string, lower: string): ComputeResult | null {
  const start = performance.now();

  // PERCENTAGE: "15% of 200" - very common, fast check
  // SKIP: Decision questions like "100% chance of $50" or "expected value" contexts
  if (GUARDS.hasPercent(text) && !isDecisionOrExpectedValueContext(lower)) {
    const percentMatch = text.match(TIER1.percentage);
    if (percentMatch?.[1] && percentMatch[2]) {
      const percent = parseFloat(percentMatch[1]);
      const value = parseFloat(percentMatch[2]);
      return solved(formatResult((percent / 100) * value), "percentage", start);
    }
  }

  // FACTORIAL: "5!" or "factorial of 5" - guard on "!" or "factorial"
  if ((GUARDS.hasExclaim(text) || lower.includes("factorial")) && !/trailing/i.test(text)) {
    const factMatch = text.match(TIER1.factorial);
    if (factMatch) {
      const nStr = factMatch[1] || factMatch[2];
      if (nStr) {
        const n = parseInt(nStr, 10);
        if (n >= 0 && n <= 170) {
          return solved(factorial(n), "factorial", start);
        }
      }
    }
  }

  // MODULO: "17 mod 5" - guard on "mod" or "%" or "remainder"
  // BUT skip "X^Y mod 10" which is handled by last_digit in Tier 3
  if (
    (lower.includes("mod") ||
      lower.includes("remainder") ||
      (GUARDS.hasPercent(text) && /\d+\s*%\s*\d+/.test(text))) &&
    !TIER1.moduloLastDigitGuard.test(text)
  ) {
    const modMatch = text.match(TIER1.moduloBasic) || text.match(TIER1.moduloRemainder);
    if (modMatch?.[1] && modMatch[2]) {
      const a = parseInt(modMatch[1], 10);
      const b = parseInt(modMatch[2], 10);
      if (b !== 0) {
        return solved(a % b, "modulo", start);
      }
    }
  }

  // PRIMALITY: "is 91 prime?" - guard on "prime"
  if (lower.includes("prime")) {
    const primeMatch = text.match(TIER1.prime);
    if (primeMatch?.[1]) {
      const n = parseInt(primeMatch[1], 10);
      if (n <= 1_000_000) {
        return solved(isPrime(n) ? "YES" : "NO", "primality", start);
      }
    }
  }

  // FIBONACCI: "8th fibonacci" - guard on "fibonacci"
  if (lower.includes("fibonacci")) {
    const fibMatch = lower.match(TIER1.fibonacci);
    if (fibMatch?.[1]) {
      const n = parseInt(fibMatch[1], 10);
      if (n > 0 && n <= 100) {
        return solved(fibonacci(n), "fibonacci", start);
      }
    }
  }

  return null;
}

/**
 * TIER 2: Fast formulas (simple math operations)
 * - Square root, power, GCD/LCM
 */
function tryFormulaTier2(text: string, lower: string): ComputeResult | null {
  const start = performance.now();

  // SQUARE ROOT: √x, sqrt(x) - guard on "sqrt", "√", or "root"
  if (lower.includes("sqrt") || text.includes("\u221A") || lower.includes("root")) {
    const sqrtMatch = text.match(TIER2.sqrt);
    if (sqrtMatch?.[1]) {
      const val = parseFloat(sqrtMatch[1]);
      if (val >= 0) {
        return solved(formatResult(Math.sqrt(val)), "square_root", start);
      }
    }
  }

  // POWER: x^n, x**n - guard on "^" or "**" or "power"
  if (GUARDS.hasCaret(text) || lower.includes("power")) {
    // Skip if "last digit" or "mod" present (handled elsewhere)
    if (!TIER2.powerLastDigitGuard.test(text) && !TIER2.powerModGuard.test(text)) {
      const powMatch = text.match(TIER2.power);
      if (powMatch?.[1] && powMatch[2]) {
        const base = parseFloat(powMatch[1]);
        const exp = parseFloat(powMatch[2]);
        const result = base ** exp;
        if (Number.isFinite(result)) {
          return solved(formatResult(result), "power", start);
        }
      }
    }
  }

  // GCD: "gcd of 12 and 18" - guard on "gcd"
  if (lower.includes("gcd") || lower.includes("greatest common")) {
    const gcdMatch = text.match(TIER2.gcd);
    if (gcdMatch?.[1] && gcdMatch[2]) {
      const a = parseInt(gcdMatch[1], 10);
      const b = parseInt(gcdMatch[2], 10);
      return solved(gcd(a, b), "gcd", start);
    }
  }

  // LCM: "lcm of 12 and 18" - guard on "lcm"
  if (lower.includes("lcm") || lower.includes("least common")) {
    const lcmMatch = text.match(TIER2.lcm);
    if (lcmMatch?.[1] && lcmMatch[2]) {
      const a = parseInt(lcmMatch[1], 10);
      const b = parseInt(lcmMatch[2], 10);
      return solved(lcm(a, b), "lcm", start);
    }
  }

  return null;
}

// =============================================================================
// TIER 3 HELPERS (extracted to reduce cognitive complexity)
// =============================================================================

/** Try logarithm patterns: log₁₀(x), ln(x) */
function tryLogarithm(text: string, lower: string, start: number): ComputeResult | null {
  if (!lower.includes("log") && !lower.includes("ln")) return null;

  // Base 10 log - need fresh regex each time due to global flag
  const logBase10Pattern = /log[\u2081\u20801]?[\u2080\u20800]?\s*\(?\s*(\d+)\s*\)?/gi;
  const logBase10 = text.match(logBase10Pattern);
  if (logBase10 && logBase10.length > 0) {
    let sum = 0;
    let valid = true;
    for (const match of logBase10) {
      const numMatch = match.match(/\d+/);
      if (numMatch?.[0]) {
        const val = parseInt(numMatch[0], 10);
        if (val > 0) {
          sum += Math.log10(val);
        } else {
          valid = false;
          break;
        }
      }
    }
    if (valid && (lower.includes("+") || logBase10.length === 1)) {
      return {
        solved: true,
        result: formatResult(sum),
        method: "logarithm_base10",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // Natural log: ln(x)
  const lnMatch = text.match(TIER3.logNatural);
  if (lnMatch?.[1]) {
    const val = parseFloat(lnMatch[1]);
    if (val > 0) {
      return {
        solved: true,
        result: +Math.log(val).toFixed(6),
        method: "natural_log",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  return null;
}

/** Try quadratic equation: ax² + bx + c = 0 */
function tryQuadraticEq(text: string, lower: string, start: number): ComputeResult | null {
  if (!GUARDS.hasX(text) || !text.includes("0")) return null;

  const quadMatch = text.match(TIER3.quadratic);
  if (!quadMatch?.[2] || !quadMatch[3] || !quadMatch[4] || !quadMatch[5]) return null;

  const a = quadMatch[1] ? parseInt(quadMatch[1], 10) : 1;
  const bSign = quadMatch[2] === "-" ? -1 : 1;
  const b = bSign * parseInt(quadMatch[3], 10);
  const cSign = quadMatch[4] === "-" ? -1 : 1;
  const c = cSign * parseInt(quadMatch[5], 10);
  const discriminant = b * b - 4 * a * c;

  if (discriminant < 0) return null;

  const r1 = (-b + Math.sqrt(discriminant)) / (2 * a);
  const r2 = (-b - Math.sqrt(discriminant)) / (2 * a);

  if (lower.includes("larger") || lower.includes("greater") || lower.includes("bigger")) {
    return {
      solved: true,
      result: Math.max(r1, r2),
      method: "quadratic_larger",
      confidence: 1.0,
      time_ms: performance.now() - start,
    };
  }
  if (lower.includes("smaller") || lower.includes("lesser")) {
    return {
      solved: true,
      result: Math.min(r1, r2),
      method: "quadratic_smaller",
      confidence: 1.0,
      time_ms: performance.now() - start,
    };
  }
  return {
    solved: true,
    result: r1 === r2 ? r1 : `${r1}, ${r2}`,
    method: "quadratic",
    confidence: 0.95,
    time_ms: performance.now() - start,
  };
}

/** Try combinations: "10 choose 3", nCr */
function tryCombinationsFormula(text: string, lower: string, start: number): ComputeResult | null {
  if (!lower.includes("choose") && !/ c /i.test(text) && !lower.includes("combination")) {
    return null;
  }

  const combMatch =
    text.match(TIER3.combinationsChoose) ||
    text.match(TIER3.combinationsFrom) ||
    text.match(TIER3.combinationsHowMany);

  if (!combMatch?.[1] || !combMatch[2]) return null;

  let n = parseInt(combMatch[1], 10);
  let k = parseInt(combMatch[2], 10);
  if (combMatch[0].includes("from") && n < k) {
    [n, k] = [k, n];
  }

  if (n >= k && k >= 0 && n <= 100) {
    return {
      solved: true,
      result: combinations(n, k),
      method: "combinations",
      confidence: 1.0,
      time_ms: performance.now() - start,
    };
  }
  return null;
}

/** Try permutations: "10 P 3", nPr */
function tryPermutationsFormula(text: string, lower: string, start: number): ComputeResult | null {
  if (!/ p /i.test(text) && !lower.includes("permutation") && !lower.includes("arrangement")) {
    return null;
  }

  const permMatch = text.match(TIER3.permutationsP) || text.match(TIER3.permutationsWord);
  if (!permMatch?.[1] || !permMatch[2]) return null;

  const n = parseInt(permMatch[1], 10);
  const k = parseInt(permMatch[2], 10);

  if (n >= k && k >= 0 && n <= 100) {
    return {
      solved: true,
      result: permutations(n, k),
      method: "permutations",
      confidence: 1.0,
      time_ms: performance.now() - start,
    };
  }
  return null;
}

/** Try last digit calculation: "7^100 mod 10" */
function tryLastDigit(text: string, lower: string, start: number): ComputeResult | null {
  if (!lower.includes("last digit") && !/mod\s*10/i.test(text)) return null;

  const lastDigitMatch = text.match(TIER3.lastDigitMod);
  if (!lastDigitMatch) return null;

  const base = parseInt(lastDigitMatch[1] || lastDigitMatch[3] || "", 10);
  const exp = parseInt(lastDigitMatch[2] || lastDigitMatch[4] || "", 10);

  if (Number.isNaN(base) || Number.isNaN(exp) || exp <= 0) return null;

  const lastDigits = [base % 10];
  let current = base % 10;
  for (let i = 1; i < 4; i++) {
    current = (current * (base % 10)) % 10;
    if (current === lastDigits[0]) break;
    lastDigits.push(current);
  }

  return {
    solved: true,
    result: lastDigits[(exp - 1) % lastDigits.length],
    method: "last_digit",
    confidence: 1.0,
    time_ms: performance.now() - start,
  };
}

/**
 * TIER 3: Medium-cost formulas (more complex patterns)
 * - Logarithms, quadratic, combinations, permutations, last digit
 */
function tryFormulaTier3(text: string, lower: string): ComputeResult | null {
  const start = performance.now();

  return (
    tryLogarithm(text, lower, start) ||
    tryQuadraticEq(text, lower, start) ||
    tryCombinationsFormula(text, lower, start) ||
    tryPermutationsFormula(text, lower, start) ||
    tryLastDigit(text, lower, start)
  );
}

/**
 * TIER 4: Expensive formulas (geometry, series, finance, matrix)
 * - Pythagorean, trailing zeros, geometric series, compound interest, determinant
 */
function tryFormulaTier4(text: string, lower: string): ComputeResult | null {
  const start = performance.now();

  // PYTHAGOREAN: guard on "hypoten" (hypotenuse)
  if (lower.includes("hypoten")) {
    for (const pattern of TIER4.pythagorean) {
      const match = text.match(pattern);
      if (match?.[1] && match[2]) {
        const a = parseFloat(match[1]);
        const b = parseFloat(match[2]);
        if (!Number.isNaN(a) && !Number.isNaN(b)) {
          return solved(formatResult(Math.sqrt(a * a + b * b)), "pythagorean", start);
        }
      }
    }
  }

  // TRAILING ZEROS: guard on "trailing"
  if (lower.includes("trailing")) {
    const trailingMatch = text.match(TIER4.trailingZeros);
    if (trailingMatch?.[1]) {
      const n = parseInt(trailingMatch[1], 10);
      if (n >= 0 && n <= 1_000_000) {
        let zeros = 0;
        let power = 5;
        while (power <= n) {
          zeros += Math.floor(n / power);
          power *= 5;
        }
        return solved(zeros, "trailing_zeros", start);
      }
    }
  }

  // GEOMETRIC SERIES: guard on "infinite", "series", "sum", or "..."
  if (
    lower.includes("infinite") ||
    lower.includes("series") ||
    text.includes("...") ||
    lower.includes("sum")
  ) {
    for (const pattern of TIER4.geometricSeries) {
      const geoSeriesMatch = text.match(pattern);
      if (geoSeriesMatch?.[1]) {
        const r = 1 / parseInt(geoSeriesMatch[1], 10);
        if (r > 0 && r < 1) {
          return solved(formatResult(1 / (1 - r)), "geometric_series", start);
        }
      }
    }
  }

  // MATRIX DETERMINANT: guard on "[" and "det"
  if (GUARDS.hasBracket(text) && (lower.includes("det") || lower.includes("determinant"))) {
    const matrix = parseMatrix(text);
    if (matrix && matrix.length > 0) {
      const det = matrixDeterminant(matrix);
      if (det !== null) {
        return solved(formatResult(det), `determinant_${matrix.length}x${matrix.length}`, start);
      }
    }
  }

  // COMPOUND INTEREST: guard on "$" or "interest"
  if (GUARDS.hasDollar(text) || lower.includes("interest")) {
    const compoundMatch = text.match(TIER4.compoundInterest);
    if (compoundMatch?.[1] && compoundMatch[2] && compoundMatch[3]) {
      const P = parseFloat(compoundMatch[1].replace(/,/g, ""));
      const r = parseFloat(compoundMatch[2]) / 100;
      const t = parseInt(compoundMatch[3], 10);
      return solved(Math.round(P * (1 + r) ** t), "compound_interest", start);
    }
  }

  return null;
}

// =============================================================================
// EXPRESSION CANONICALIZATION
// =============================================================================

/**
 * Extract and canonicalize a math expression from text
 * Uses simplifyAST to normalize expressions before pattern matching
 *
 * Benefits:
 * - "x + 0" → "x" (identity removal)
 * - "2 + 3" → "5" (constant folding)
 * - "x * 1" → "x" (multiplication identity)
 *
 * @returns Canonicalized expression string, or null if not parseable
 */
export function canonicalizeExpression(expr: string): string | null {
  const { tokens, errors } = tokenizeMathExpression(expr);
  if (errors.length > 0) return null;

  const { ast, error } = buildAST(tokens);
  if (error || !ast) return null;

  const simplified = simplifyAST(ast);
  return astToString(simplified);
}

/**
 * Convert an AST node back to a string representation
 * @internal
 */
function astToString(node: ASTNode): string {
  switch (node.type) {
    case "number":
      return String(node.value);
    case "variable":
      return node.name;
    case "unary":
      if (node.operator === "²" || node.operator === "³") {
        return `(${astToString(node.operand)})${node.operator}`;
      }
      return `${node.operator}(${astToString(node.operand)})`;
    case "binary": {
      const left = astToString(node.left);
      const right = astToString(node.right);
      // Add parentheses for clarity
      return `(${left} ${node.operator} ${right})`;
    }
  }
}

/**
 * Try to simplify an expression and check if it reduces to a constant
 * Useful for detecting expressions like "x - x" → 0 or "x/x" → 1
 *
 * @returns The constant value if fully reducible, null otherwise
 */
export function trySimplifyToConstant(expr: string): number | null {
  const { tokens, errors } = tokenizeMathExpression(expr);
  if (errors.length > 0) return null;

  const { ast, error } = buildAST(tokens);
  if (error || !ast) return null;

  const simplified = simplifyAST(ast);

  if (simplified.type === "number") {
    return simplified.value;
  }

  return null;
}

/**
 * Formula-based computation
 * Recognizes common mathematical formulas from natural language
 * Uses tiered pattern matching: cheap checks first, expensive last
 */
export function tryFormula(text: string): ComputeResult {
  const lower = text.toLowerCase();

  // Tier 1: Ultra-fast (percentage, factorial, modulo, prime, fibonacci)
  const t1 = tryFormulaTier1(text, lower);
  if (t1) return t1;

  // Tier 2: Fast (sqrt, power, gcd, lcm)
  const t2 = tryFormulaTier2(text, lower);
  if (t2) return t2;

  // Tier 3: Medium (log, quadratic, combinations, permutations, last digit)
  const t3 = tryFormulaTier3(text, lower);
  if (t3) return t3;

  // Tier 4: Expensive (pythagorean, trailing zeros, series, matrix, interest)
  const t4 = tryFormulaTier4(text, lower);
  if (t4) return t4;

  // Tier 5: Try algebraic simplification as last resort
  // Detects patterns like "x - x = ?", "x/x = ?", "x + 0 = ?"
  const simplifyMatch = text.match(
    /(?:what is|simplify|evaluate)?\s*([\w\d.+\-*/^×÷−·√²³()\s]+)\s*[=?]/i,
  );
  if (simplifyMatch?.[1]) {
    const start = performance.now();
    const constant = trySimplifyToConstant(simplifyMatch[1].trim());
    if (constant !== null) {
      return solved(constant, "algebraic_simplification", start);
    }
  }

  return { solved: false, confidence: 0 };
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solver: Solver = {
  name: "formula",
  description:
    "Mathematical formulas: %, factorial, sqrt, gcd, lcm, log, quadratic, combinations, permutations, series, matrix determinant",
  types:
    SolverType.FORMULA_TIER1 |
    SolverType.FORMULA_TIER2 |
    SolverType.FORMULA_TIER3 |
    SolverType.FORMULA_TIER4,
  priority: 20,
  solve: (text, _lower) => tryFormula(text),
};
