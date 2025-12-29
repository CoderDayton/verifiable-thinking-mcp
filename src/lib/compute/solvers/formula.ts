/**
 * Formula solver - tiered pattern matching for mathematical formulas
 */

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

/**
 * Matrix determinant using Gaussian elimination
 * O(n³) complexity - works for any NxN matrix
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
 * Detect if this is a decision/expected value question where percentage
 * represents probability, not a "calculate X% of Y" request.
 *
 * Examples to SKIP:
 * - "100% chance of $50" (probability context)
 * - "expected value" (EV calculation)
 * - "which has higher" (comparison)
 * - "prefers A or B" (preference question)
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
      const result = (percent / 100) * value;
      return {
        solved: true,
        result: formatResult(result),
        method: "percentage",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
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
          return {
            solved: true,
            result: factorial(n),
            method: "factorial",
            confidence: 1.0,
            time_ms: performance.now() - start,
          };
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
        return {
          solved: true,
          result: a % b,
          method: "modulo",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // PRIMALITY: "is 91 prime?" - guard on "prime"
  if (lower.includes("prime")) {
    const primeMatch = text.match(TIER1.prime);
    if (primeMatch?.[1]) {
      const n = parseInt(primeMatch[1], 10);
      if (n <= 1_000_000) {
        return {
          solved: true,
          result: isPrime(n) ? "YES" : "NO",
          method: "primality",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // FIBONACCI: "8th fibonacci" - guard on "fibonacci"
  if (lower.includes("fibonacci")) {
    const fibMatch = lower.match(TIER1.fibonacci);
    if (fibMatch?.[1]) {
      const n = parseInt(fibMatch[1], 10);
      if (n > 0 && n <= 100) {
        return {
          solved: true,
          result: fibonacci(n),
          method: "fibonacci",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
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
        const result = Math.sqrt(val);
        return {
          solved: true,
          result: formatResult(result),
          method: "square_root",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
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
          return {
            solved: true,
            result: formatResult(result),
            method: "power",
            confidence: 1.0,
            time_ms: performance.now() - start,
          };
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
      return {
        solved: true,
        result: gcd(a, b),
        method: "gcd",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // LCM: "lcm of 12 and 18" - guard on "lcm"
  if (lower.includes("lcm") || lower.includes("least common")) {
    const lcmMatch = text.match(TIER2.lcm);
    if (lcmMatch?.[1] && lcmMatch[2]) {
      const a = parseInt(lcmMatch[1], 10);
      const b = parseInt(lcmMatch[2], 10);
      return {
        solved: true,
        result: lcm(a, b),
        method: "lcm",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  return null;
}

/**
 * TIER 3: Medium-cost formulas (more complex patterns)
 * - Logarithms, quadratic, combinations, permutations, last digit
 */
function tryFormulaTier3(text: string, lower: string): ComputeResult | null {
  const start = performance.now();

  // LOGARITHMS: log₁₀(x), ln(x) - guard on "log" or "ln"
  if (lower.includes("log") || lower.includes("ln")) {
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
  }

  // QUADRATIC: ax² + bx + c = 0 - guard on "x²" or "x^2" or "x2" and "= 0"
  if (GUARDS.hasX(text) && text.includes("0")) {
    const quadMatch = text.match(TIER3.quadratic);
    if (quadMatch?.[2] && quadMatch[3] && quadMatch[4] && quadMatch[5]) {
      const a = quadMatch[1] ? parseInt(quadMatch[1], 10) : 1;
      const bSign = quadMatch[2] === "-" ? -1 : 1;
      const b = bSign * parseInt(quadMatch[3], 10);
      const cSign = quadMatch[4] === "-" ? -1 : 1;
      const c = cSign * parseInt(quadMatch[5], 10);
      const discriminant = b * b - 4 * a * c;

      if (discriminant >= 0) {
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
    }
  }

  // COMBINATIONS: "10 choose 3" - guard on "choose" or " C " or "combination"
  if (lower.includes("choose") || / c /i.test(text) || lower.includes("combination")) {
    const combMatch =
      text.match(TIER3.combinationsChoose) ||
      text.match(TIER3.combinationsFrom) ||
      text.match(TIER3.combinationsHowMany);
    if (combMatch?.[1] && combMatch[2]) {
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
    }
  }

  // PERMUTATIONS: "10 P 3" - guard on " P " or "permutation"
  if (/ p /i.test(text) || lower.includes("permutation") || lower.includes("arrangement")) {
    const permMatch = text.match(TIER3.permutationsP) || text.match(TIER3.permutationsWord);
    if (permMatch?.[1] && permMatch[2]) {
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
    }
  }

  // LAST DIGIT: "7^100 mod 10" or "last digit of 7^100" - guard on "last digit" or "mod 10"
  if (lower.includes("last digit") || /mod\s*10/i.test(text)) {
    const lastDigitMatch = text.match(TIER3.lastDigitMod);
    if (lastDigitMatch) {
      const base = parseInt(lastDigitMatch[1] || lastDigitMatch[3] || "", 10);
      const exp = parseInt(lastDigitMatch[2] || lastDigitMatch[4] || "", 10);
      if (!Number.isNaN(base) && !Number.isNaN(exp) && exp > 0) {
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
    }
  }

  return null;
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
          const c = Math.sqrt(a * a + b * b);
          return {
            solved: true,
            result: formatResult(c),
            method: "pythagorean",
            confidence: 1.0,
            time_ms: performance.now() - start,
          };
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
        return {
          solved: true,
          result: zeros,
          method: "trailing_zeros",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
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
          const sum = 1 / (1 - r);
          return {
            solved: true,
            result: formatResult(sum),
            method: "geometric_series",
            confidence: 1.0,
            time_ms: performance.now() - start,
          };
        }
      }
    }
  }

  // MATRIX DETERMINANT: guard on "[" and "det"
  if (GUARDS.hasBracket(text) && (lower.includes("det") || lower.includes("determinant"))) {
    // Try parsing NxN matrix from various formats
    const matrix = parseMatrix(text);
    if (matrix && matrix.length > 0) {
      const det = matrixDeterminant(matrix);
      if (det !== null) {
        const n = matrix.length;
        return {
          solved: true,
          result: formatResult(det),
          method: `determinant_${n}x${n}`,
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
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
      const A = P * (1 + r) ** t;
      return {
        solved: true,
        result: Math.round(A),
        method: "compound_interest",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
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
