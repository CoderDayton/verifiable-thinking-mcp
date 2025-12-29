/**
 * Pure math helper functions
 * No regex, no side effects - just computation
 */

/** Calculate combinations C(n,k) = n! / (k! * (n-k)!) without factorial overflow */
export function combinations(n: number, k: number): number {
  if (k > n - k) k = n - k; // Optimization: C(n,k) = C(n,n-k)
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/** Calculate permutations P(n,k) = n! / (n-k)! */
export function permutations(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

/** Calculate nth Fibonacci number (1-indexed) */
export function fibonacci(n: number): number {
  if (n <= 0) return 0;
  if (n <= 2) return 1;

  let a = 1,
    b = 1;
  for (let i = 3; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

/** Calculate factorial n! */
export function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

/** Calculate greatest common divisor using Euclidean algorithm */
export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Calculate least common multiple */
export function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

/** Check if n is prime using 6k+-1 optimization */
export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  if (n === 3) return true;
  if (n % 3 === 0) return false;

  // Check 6k+-1 up to sqrt(n)
  const sqrt = Math.sqrt(n);
  for (let i = 5; i <= sqrt; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/** Format a number result: integer if whole, otherwise fixed to 6 decimals */
export function formatResult(n: number): number {
  return Number.isInteger(n) ? n : +n.toFixed(6);
}

// =============================================================================
// SAFE EXPRESSION PARSER
// Recursive descent parser - no eval/Function, pure math operations only
// Grammar:
//   expr    → term (('+' | '-') term)*
//   term    → factor (('*' | '/') factor)*
//   factor  → base ('^' factor)?        // Right-associative exponentiation
//   base    → '-' base | primary
//   primary → NUMBER | '(' expr ')'
// =============================================================================

export interface ParseResult {
  success: boolean;
  value?: number;
  error?: string;
}

/**
 * Safe arithmetic expression parser
 * Supports: +, -, *, /, ^, (), negative numbers, decimals
 * NO eval, NO Function constructor - pure recursive descent
 */
export function safeEvaluate(expression: string): ParseResult {
  // Remove whitespace and normalize
  const input = expression.replace(/\s+/g, "").replace(/\*\*/g, "^");

  // Quick validation - only allow safe characters
  if (!/^[\d+\-*/^().]+$/.test(input)) {
    return { success: false, error: "Invalid characters" };
  }

  // Check for empty or invalid patterns
  // Note: We allow +- or -- (e.g., 5+-3 = 5+(-3), --5 = 5)
  // But reject: **, //, */, /*, etc.
  if (input === "" || /\(\)|[*/^]{2}|^[*/^]|[+\-*/^(]$/.test(input)) {
    return { success: false, error: "Invalid expression" };
  }

  let pos = 0;

  function peek(): string {
    return input[pos] || "";
  }

  function consume(): string {
    return input[pos++] || "";
  }

  function parseNumber(): number | null {
    const start = pos;
    // Handle leading negative that's part of the number (handled in base, but also here for safety)
    if (peek() === "-") consume();
    // Integer part
    while (/\d/.test(peek())) consume();
    // Decimal part
    if (peek() === ".") {
      consume();
      while (/\d/.test(peek())) consume();
    }
    const numStr = input.slice(start, pos);
    if (numStr === "" || numStr === "-" || numStr === ".") {
      pos = start;
      return null;
    }
    return parseFloat(numStr);
  }

  function parsePrimary(): number | null {
    if (peek() === "(") {
      consume(); // '('
      const result = parseExpr();
      if (result === null) return null;
      if (peek() !== ")") return null;
      consume(); // ')'
      return result;
    }
    return parseNumber();
  }

  function parseBase(): number | null {
    if (peek() === "-") {
      consume();
      const val = parseBase(); // Recursive for multiple negatives: --5
      return val === null ? null : -val;
    }
    return parsePrimary();
  }

  function parseFactor(): number | null {
    const left = parseBase();
    if (left === null) return null;
    if (peek() === "^") {
      consume();
      const right = parseFactor(); // Right-associative: 2^3^2 = 2^(3^2) = 512
      if (right === null) return null;
      return left ** right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;
      if (op === "*") {
        left = left * right;
      } else {
        if (right === 0) return null; // Division by zero
        left = left / right;
      }
    }
    return left;
  }

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  try {
    const result = parseExpr();
    // Ensure we consumed the entire input
    if (result === null || pos !== input.length) {
      return { success: false, error: "Parse error" };
    }
    if (!Number.isFinite(result)) {
      return { success: false, error: "Result not finite" };
    }
    return { success: true, value: result };
  } catch {
    return { success: false, error: "Parse error" };
  }
}

/** Normalize Unicode superscripts to ^n notation */
export function normalizeUnicodeSuperscripts(text: string): string {
  const superscriptMap: Record<string, string> = {
    "\u2070": "^0",
    "\u00B9": "^1",
    "\u00B2": "^2",
    "\u00B3": "^3",
    "\u2074": "^4",
    "\u2075": "^5",
    "\u2076": "^6",
    "\u2077": "^7",
    "\u2078": "^8",
    "\u2079": "^9",
  };
  let result = text;
  for (const [sup, repl] of Object.entries(superscriptMap)) {
    result = result.replaceAll(sup, repl);
  }
  return result;
}
