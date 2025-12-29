# Research: Mathematical Computation Patterns for Local Compute Engine

## Architecture

The local compute engine should evolve from a simple regex-matcher into a **multi-stage pipeline**: `Parser → Symbolizer → Solver → Verifier`. Current implementation mixes parsing and solving; separating them allows for recursive expression handling (e.g., `d/dx(x^2 + 3x)`). The engine should prioritize **symbolic manipulation** for algebra/calculus (exact answers) and fallback to **numerical methods** for integrals/probability.

## Key Flows

- **Symbolic Differentiation**: `Regex(Polynomial) → Parse Terms → Apply Power Rule → Format Output`
- **Numerical Integration**: `Regex(Definite Integral) → Extract Bounds/Function → Simpson's Rule → Format Output`
- **Matrix Operations**: `Regex(Matrix) → Parse 2D Array → Gaussian Elimination (Determinant) → Format Output`
- **Combinatorics**: `Regex(nCr/nPr) → Extract n,r → Factorial/Gamma Function → Format Output`

## Top Files

- `src/lib/compute.ts`: **Core logic**. Needs refactoring to separate parsing from solving.
- `src/lib/math/calculus.ts`: **New module**. Derivatives (symbolic) and integrals (numerical).
- `src/lib/math/linear-algebra.ts`: **New module**. Matrix determinants, multiplication, inversion.
- `src/lib/math/combinatorics.ts`: **New module**. Permutations, combinations, probability distributions.
- `src/lib/math/financial.ts`: **New module**. Compound interest, annuities (TVM formulas).
- `src/lib/math/parser.ts`: **New module**. robust expression parser (Shunting-yard or recursive descent) to replace fragile regexes.
- `src/lib/math/utils.ts`: **New module**. Shared helpers (Gamma function, precise rounding, error handling).

## Hotspots

- **Regex Fragility**: Current regexes fail on nested expressions or slight variations (e.g., spaces, variable names).
- **Numerical Precision**: Floating point errors in iterative methods (integration, compound interest).
- **Performance**: Recursive determinant calculation is O(n!) - switch to Gaussian elimination O(n³) for n > 4.
- **Security**: `new Function` in `tryArithmetic` is a risk; replace with a proper expression parser.

## Prioritization (Effort vs. Frequency)

| Feature                       | Frequency (MATH/GSM8K)            | Effort | Verdict              |
| :---------------------------- | :-------------------------------- | :----- | :------------------- |
| **Combinatorics (nCr, nPr)**  | **High** (Counting & Probability) | Low    | **Implement First**  |
| **Derivatives (Polynomials)** | Med (Calculus)                    | Med    | **Implement Second** |
| **Matrix Determinants**       | Low (Linear Algebra)              | Med    | Implement Later      |
| **Definite Integrals**        | Low (Calculus)                    | High   | Implement Later      |
| **Compound Interest**         | Low (Financial)                   | Low    | Low Priority         |
| **Probability**               | Med (Counting & Probability)      | Med    | **Implement Third**  |

---

## 1. Implementation Patterns

### A. Combinatorics (High Priority)

**Pattern**: Direct formula application using pre-computed factorials or Gamma function for non-integers.

```typescript
// src/lib/math/combinatorics.ts
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n / 2) k = n - k; // Symmetry
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - i + 1)) / i;
  }
  return Math.round(res);
}
```

### B. Symbolic Differentiation (Polynomials Only)

**Pattern**: Parse `ax^n` terms, apply `d/dx = anx^(n-1)`.

```typescript
// src/lib/math/calculus.ts
function derivePolynomial(poly: string): string {
  // Matches: [sign, coef, var, exp] e.g. "-3x^2" -> ["-", "3", "x", "2"]
  const termRegex = /([+-]?)\s*(\d*)x(?:\^(\d+))?/g;
  let result = [];
  let match;
  while ((match = termRegex.exec(poly)) !== null) {
    let [_, sign, coefStr, expStr] = match;
    if (!coefStr && !expStr && !match[0].includes("x")) continue; // Skip constants
    let coef = coefStr ? parseInt(coefStr) : 1;
    if (sign === "-") coef = -coef;
    let exp = expStr ? parseInt(expStr) : match[0].includes("x") ? 1 : 0;

    if (exp === 0) continue; // Derivative of constant is 0
    let newCoef = coef * exp;
    let newExp = exp - 1;

    let term = newCoef.toString();
    if (newExp > 0) term += newExp === 1 ? "x" : `x^${newExp}`;
    if (newCoef > 0 && result.length > 0) term = "+" + term;
    result.push(term);
  }
  return result.join("") || "0";
}
```

### C. Matrix Determinant (Gaussian Elimination)

**Pattern**: Convert to upper triangular matrix, then multiply diagonal.

```typescript
// src/lib/math/linear-algebra.ts
function determinant(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 0) return 0;
  if (n === 1) return matrix[0][0];
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];

  // Gaussian elimination (simplified)
  let det = 1;
  let mat = matrix.map((row) => [...row]); // Clone
  for (let i = 0; i < n; i++) {
    let pivot = i;
    while (pivot < n && mat[pivot][i] === 0) pivot++;
    if (pivot === n) return 0; // Singular
    if (pivot !== i) {
      [mat[i], mat[pivot]] = [mat[pivot], mat[i]];
      det *= -1;
    }
    det *= mat[i][i];
    for (let j = i + 1; j < n; j++) {
      const factor = mat[j][i] / mat[i][i];
      for (let k = i; k < n; k++) mat[j][k] -= factor * mat[i][k];
    }
  }
  return det;
}
```

### D. Numerical Integration (Simpson's Rule)

**Pattern**: Approximate area under curve using quadratic interpolation.

```typescript
// src/lib/math/calculus.ts
function integrate(
  fn: (x: number) => number,
  a: number,
  b: number,
  n: number = 100
): number {
  if (n % 2 !== 0) n++; // n must be even
  const h = (b - a) / n;
  let sum = fn(a) + fn(b);
  for (let i = 1; i < n; i++) {
    sum += (i % 2 === 0 ? 2 : 4) * fn(a + i * h);
  }
  return (h / 3) * sum;
}
```

## 2. Regex Patterns

| Type             | Pattern                                                                | Example                                             |
| :--------------- | :--------------------------------------------------------------------- | :-------------------------------------------------- | ------------------------ |
| **Combinations** | `(\d+)\s\*(?:choose                                                    | C)\s\*(\d+)`                                        | "10 choose 3", "10C3"    |
| **Permutations** | `(\d+)\s\*(?:permute                                                   | P)\s\*(\d+)`                                        | "10 permute 3", "10P3"   |
| **Derivative**   | `(?:derivative                                                         | d\/dx)\s*(?:of\s*)?([x\d\^+\-\s]+)`                 | "derivative of x^3 + 2x" |
| **Integral**     | `integral\s*(?:of\s*)?([x\d\^+\-\s]+)\s*from\s*(\d+)\s*to\s*(\d+)`     | "integral of 2x from 0 to 3"                        |
| **Matrix Det**   | `determinant\s*(?:of\s*)?\[\[([\d,]+)\],\[([\d,]+)\]\]`                | "determinant of [[1,2],[3,4]]"                      |
| **Interest**     | `compound\s*interest.*principal\s*(\d+).*rate\s*(\d+)%.*(\d+)\s*years` | "compound interest principal 1000 rate 5% 10 years" |

## 3. Edge Cases & Precision

- **Floating Point**: `0.1 + 0.2 !== 0.3`. Use an epsilon for equality checks (`Math.abs(a - b) < 1e-10`).
- **Large Numbers**: Factorials grow fast. `170!` is max for `number`. Return `Infinity` or use `BigInt` (but `BigInt` doesn't support decimals).
- **Singular Matrices**: Determinant 0 checks are crucial before inversion.
- **Polynomial Parsing**: "x" implies "1x^1". "-x" implies "-1x^1". Constants have "x^0".
- **Integration Discontinuities**: Simpson's rule fails if function is discontinuous in `[a, b]` (e.g., `1/x` across 0).

## 4. Next Questions

- Should we replace the regex parser with a proper **Recursive Descent Parser** to handle nested expressions like `(3x + 2)^2`?
- Can we use a lightweight **Computer Algebra System (CAS)** library instead of rolling our own? (e.g., `nerdamer` is 100kb).
- How do we handle **implicit multiplication** (e.g., `2x` vs `2*x`) consistently?
