/**
 * Calculus solver - derivatives and definite integrals of polynomials
 */

import { SolverType } from "../classifier.ts";
import { formatResult, normalizeUnicodeSuperscripts } from "../math.ts";
import { CALCULUS } from "../patterns.ts";
import type { ComputeResult, PolyTerm, Solver } from "../types.ts";

/** Parse a polynomial string like "3x^2 + 2x - 5" into terms @internal */
function parsePolynomial(text: string): PolyTerm[] {
  // Normalize: whitespace, case, and Unicode superscripts
  const clean = normalizeUnicodeSuperscripts(text).replace(/\s+/g, "").toLowerCase();

  const terms: PolyTerm[] = [];

  // Match terms like: "3x^2", "-x", "5", "+2x^-1"
  const termRegex = /([+-]?)(\d*\.?\d*)x(?:\^([+-]?\d+))?|([+-]?)(\d+\.?\d*)/g;
  let match: RegExpExecArray | null;

  while ((match = termRegex.exec(clean)) !== null) {
    if (match[0] === "") continue;

    // Variable term (ax^n)
    if (match[2] !== undefined && match[0].includes("x")) {
      const sign = match[1] === "-" ? -1 : 1;
      const coeffStr = match[2];
      const coeff =
        sign * (coeffStr === "" || coeffStr === "+" || coeffStr === "-" ? 1 : parseFloat(coeffStr));
      const exp = match[3] ? parseInt(match[3], 10) : 1;
      terms.push({ coeff, exp });
    }
    // Constant term
    else if (match[5] !== undefined) {
      const sign = match[4] === "-" ? -1 : 1;
      const coeff = sign * parseFloat(match[5]);
      terms.push({ coeff, exp: 0 });
    }
  }
  return terms;
}

/** Differentiate polynomial terms using power rule @internal */
function differentiateTerms(terms: PolyTerm[]): PolyTerm[] {
  return terms
    .map((t) => ({ coeff: t.coeff * t.exp, exp: t.exp - 1 }))
    .filter((t) => t.coeff !== 0);
}

/** Integrate polynomial terms using power rule @internal */
function integrateTerms(terms: PolyTerm[]): PolyTerm[] {
  return terms.map((t) => {
    if (t.exp === -1) throw new Error("Cannot integrate 1/x in polynomial mode");
    return { coeff: t.coeff / (t.exp + 1), exp: t.exp + 1 };
  });
}

/**
 * Simpson's Rule for numerical integration
 * Works for any continuous function, not just polynomials
 * Accuracy: O(h^4) where h = (b-a)/n
 */
export function simpsonIntegrate(fn: (x: number) => number, a: number, b: number, n = 100): number {
  // Handle edge cases
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (a === b) return 0;

  // n must be even for Simpson's rule, and capped for safety
  if (n % 2 !== 0) n++;
  n = Math.min(n, 10000);

  const h = (b - a) / n;
  let sum = fn(a) + fn(b);

  for (let i = 1; i < n; i++) {
    const x = a + i * h;
    // Odd indices get weight 4, even indices get weight 2
    sum += (i % 2 === 0 ? 2 : 4) * fn(x);
  }

  return (h / 3) * sum;
}

/**
 * Create a safe evaluator function for simple math expressions
 * Supports: x, numbers, +, -, *, /, ^, sin, cos, tan, exp, ln, sqrt
 * Returns null if expression is not safe to evaluate
 * @internal
 */
function createSafeFunction(expr: string): ((x: number) => number) | null {
  // Normalize
  const clean = expr.toLowerCase().replace(/\s+/g, "").replace(/\*\*/g, "^");

  // Whitelist: only allow safe math characters and functions
  const safePattern = /^[x\d+\-*/^().,sincotaexplnqr]+$/;
  if (!safePattern.test(clean)) return null;

  // Build function by replacing math operations with safe JS equivalents
  // This is still not using eval - we construct the function from parsed components
  try {
    // For now, only support polynomial-like expressions that our parser handles
    // More complex expressions (sin, cos, etc.) would need the full parser
    const terms = parsePolynomial(clean);
    if (terms.length === 0) return null;

    return (x: number) => evaluatePolynomial(terms, x);
  } catch {
    return null;
  }
}

/** Evaluate polynomial at a point @internal */
function evaluatePolynomial(terms: PolyTerm[], x: number): number {
  return terms.reduce((sum, t) => sum + t.coeff * x ** t.exp, 0);
}

/**
 * Try to solve calculus problems (derivatives and integrals)
 */
export function tryCalculus(text: string): ComputeResult {
  const start = performance.now();

  // Normalize Unicode superscripts early so regex patterns work
  const normalizedText = normalizeUnicodeSuperscripts(text);

  // =========================================================================
  // DERIVATIVES: d/dx of f(x) at x=a
  // =========================================================================
  for (const pattern of CALCULUS.derivative) {
    const match = normalizedText.match(pattern);
    if (match?.[1]) {
      try {
        // Extract just the expression part
        let expr = match[1].trim();
        // Remove trailing punctuation, extra phrases, and redundant "d/dx of"
        expr = expr
          .replace(/[.?!]+$/, "")
          .replace(/\s*(at|evaluated|when).*$/i, "")
          .replace(/^d\/dx\s*(of\s*)?/i, "")
          .replace(/^of\s+/i, "")
          .trim();

        const terms = parsePolynomial(expr);
        if (terms.length === 0) continue;

        const diffTerms = differentiateTerms(terms);

        // If evaluating at a point (group 2 present)
        if (match[2]) {
          const xVal = parseFloat(match[2]);
          const result = evaluatePolynomial(diffTerms, xVal);
          const time_ms = performance.now() - start;
          return {
            solved: true,
            result: formatResult(result),
            method: "derivative_eval",
            confidence: 1.0,
            time_ms,
          };
        }

        // Return symbolic derivative (format as string)
        const resultStr = diffTerms
          .map((t, i) => {
            const sign = t.coeff >= 0 ? (i > 0 ? " + " : "") : " - ";
            const absCoeff = Math.abs(t.coeff);
            const cStr = absCoeff === 1 && t.exp !== 0 ? "" : String(absCoeff);
            const xStr = t.exp === 0 ? "" : t.exp === 1 ? "x" : `x^${t.exp}`;
            return `${sign}${cStr}${xStr}`;
          })
          .join("")
          .trim();

        const time_ms = performance.now() - start;
        return {
          solved: true,
          result: resultStr || "0",
          method: "derivative_symbolic",
          confidence: 1.0,
          time_ms,
        };
      } catch {
        // Parsing failed, continue
      }
    }
  }

  // =========================================================================
  // DEFINITE INTEGRALS: integral of f(x) from a to b
  // =========================================================================
  for (const pattern of CALCULUS.integral) {
    const match = text.match(pattern);
    if (match?.[1] && match[2] && match[3]) {
      const a = parseFloat(match[2]);
      const b = parseFloat(match[3]);

      // First try exact polynomial integration
      try {
        const terms = parsePolynomial(match[1]);
        if (terms.length > 0) {
          const integrated = integrateTerms(terms);
          const result = evaluatePolynomial(integrated, b) - evaluatePolynomial(integrated, a);
          const time_ms = performance.now() - start;
          return {
            solved: true,
            result: formatResult(result),
            method: "definite_integral",
            confidence: 1.0,
            time_ms,
          };
        }
      } catch {
        // Polynomial parsing/integration failed, try numerical
      }

      // Fallback: Simpson's rule for numerical integration
      const fn = createSafeFunction(match[1]);
      if (fn) {
        try {
          const result = simpsonIntegrate(fn, a, b, 1000);
          const time_ms = performance.now() - start;
          return {
            solved: true,
            result: formatResult(result),
            method: "numerical_integral",
            confidence: 0.95, // Slightly lower confidence for numerical
            time_ms,
          };
        } catch {
          // Numerical integration failed
        }
      }
    }
  }

  return { solved: false, confidence: 0 };
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solver: Solver = {
  name: "calculus",
  description: "Derivatives and definite integrals of polynomials, with Simpson's rule fallback",
  types: SolverType.CALCULUS,
  priority: 50,
  solve: (text, _lower) => tryCalculus(text),
};
