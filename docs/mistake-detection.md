# Mistake Detection Reference

The verifiable-thinking MCP server includes automatic detection of common algebraic and calculus mistakes. This document describes each error type with examples.

## Error Types

### 1. Sign Error (`sign_error`)

**Description:** Operands swapped in subtraction, or negation applied incorrectly.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `a - b = b - a` | Error | `a - b` (not commutative) |
| `5 - 3 = 3 - 5` | Error | `5 - 3 = 2` |
| `-(a + b) = -a + b` | Error | `-a - b` |

**Common cause:** Forgetting that subtraction is not commutative.

---

### 2. Coefficient Error (`coefficient_error`)

**Description:** Coefficients multiplied instead of added when combining like terms, or wrong coefficient used.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `2x + 3x = 6x` | Error (multiplied) | `5x` |
| `5x - 2x = 2x` | Error (took second coeff) | `3x` |
| `x + 2x = 4x` | Error | `3x` (implicit 1 + 2) |
| `-x + 3x = 3x` | Error | `2x` (-1 + 3) |
| `-2x - x = -2x` | Error | `-3x` (-2 + -1) |

**Common cause:** Multiplying coefficients instead of adding, or forgetting implicit coefficient of 1.

---

### 3. Exponent Error (`exponent_error`)

**Description:** Exponents multiplied instead of added when multiplying powers with the same base.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `x^2 * x^3 = x^6` | Error (multiplied) | `x^5` (2+3) |
| `x^2 * x^4 = x^8` | Error | `x^6` (2+4) |

**Rule:** When multiplying powers: `x^a * x^b = x^(a+b)`

---

### 4. Distribution Error (`distribution_error`)

**Description:** Incomplete distribution - multiplier not applied to all terms.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `a * (b + c) = ab + c` | Error | `ab + ac` |
| `2(x + 3) = 2x + 3` | Error | `2x + 6` |

**Also detects FOIL errors:**
| Input | Result | Correct |
|-------|--------|---------|
| `(x + 2)(x + 3) = x^2 + 6` | Error (missing middle) | `x^2 + 5x + 6` |
| `(x - 2)(x + 3) = x^2 - 6` | Error | `x^2 + x - 6` |
| `(x - 2)(x - 3) = x^2 + 6` | Error | `x^2 - 5x + 6` |

**Common cause:** Forgetting to distribute to the second term, or missing Outer+Inner in FOIL.

---

### 5. Subtraction Distribution Error (`subtraction_distribution_error`)

**Description:** Sign errors when distributing a negative through parentheses.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `x - (y + z) = x - y + z` | Error | `x - y - z` |
| `a - (b - c) = a - b - c` | Error | `a - b + c` |
| `a - (b - (c + d)) = a - b - c - d` | Error | `a - b + c + d` |

**Rule:** `-(a + b) = -a - b` and `-(-a) = +a`

---

### 6. Cancellation Error (`cancellation_error`)

**Description:** Invalid cancellation of terms (not factors) in fractions.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `(a + b) / a = b` | Error | `1 + b/a` or `(a+b)/a` |
| `(x + 5) / x = 5` | Error | `1 + 5/x` |

**Rule:** You can only cancel common *factors*, not terms being added.

---

### 7. Power Rule Error (`power_rule_error`)

**Description:** Errors when applying the power rule for derivatives.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `d/dx x^3 = 3x^3` | Error (didn't reduce exp) | `3x^2` |
| `derivative of x^4 = 4x^4` | Error | `4x^3` |
| `d/dx x^2 = x` | Error (forgot coefficient) | `2x` |

**Rule:** `d/dx of x^n = n*x^(n-1)` - multiply by exponent AND subtract 1 from exponent.

---

### 8. Fraction Addition Error (`fraction_error`)

**Description:** Adding numerators and denominators separately instead of finding common denominator.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `1/2 + 1/3 = 2/5` | Error | `5/6` |
| `1/4 + 1/4 = 2/8` | Error | `1/2` (= 2/4) |
| `2/3 + 1/4 = 3/7` | Error | `11/12` |

**Rule:** `a/b + c/d = (ad + bc)/(bd)`, NOT `(a+c)/(b+d)`

---

### 9. Chain Rule Error (`chain_rule_error`)

**Description:** Missing the inner derivative when differentiating composite functions.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `d/dx sin(x^2) = cos(x^2)` | Error (missing * 2x) | `2x * cos(x^2)` |
| `d/dx cos(x^2) = -sin(x^2)` | Error (missing * 2x) | `-2x * sin(x^2)` |
| `d/dx e^(2x) = e^(2x)` | Error (missing * 2) | `2 * e^(2x)` |
| `d/dx (2x+1)^3 = 3(2x+1)^2` | Error (missing * 2) | `6(2x+1)^2` |
| `d/dx ln(x^2) = 1/x^2` | Error (missing * 2x) | `2x/x^2 = 2/x` |

**Rule:** `d/dx f(g(x)) = f'(g(x)) * g'(x)` - must multiply by derivative of inner function.

---

### 10. Product Rule Error (`product_rule_error`)

**Description:** Incorrectly differentiating products by multiplying derivatives instead of using the product rule.

**Examples:**
| Input | Result | Correct |
|-------|--------|---------|
| `d/dx x^2 * sin(x) = 2x * cos(x)` | Error (multiplied f' * g') | `2x*sin(x) + x^2*cos(x)` |
| `d/dx x * e^x = e^x` | Error (missing x*e^x term) | `e^x + x*e^x` |
| `d/dx x^2 * ln(x) = 2x * 1/x` | Error (multiplied f' * g') | `2x*ln(x) + x^2/x` |
| `d/dx x * cos(x) = -sin(x)` | Error (missing cos(x) term) | `cos(x) - x*sin(x)` |

**Rule:** `d/dx [f(x) * g(x)] = f'(x)*g(x) + f(x)*g'(x)`, NOT `f'(x) * g'(x)`

---

## Usage

### From Code

```typescript
import { detectCommonMistakesFromText } from "./src/lib/compute/solvers/derivation";

const result = detectCommonMistakesFromText("2x + 3x = 6x");

if (result?.hasMistakes) {
  for (const mistake of result.mistakes) {
    console.log(`Type: ${mistake.type}`);
    console.log(`Found: ${mistake.found}`);
    console.log(`Expected: ${mistake.expected}`);
    console.log(`Explanation: ${mistake.explanation}`);
    console.log(`Suggestion: ${mistake.suggestion}`);
    console.log(`Corrected: ${mistake.suggestedFix}`);  // e.g., "2x + 3x = 5x"
  }
}
```

### DetectedMistake Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Error type (e.g., `coefficient_error`) |
| `stepNumber` | number | Which step contains the error (1-indexed) |
| `confidence` | number | Confidence score (0-1) |
| `found` | string | The incorrect RHS value |
| `expected` | string | The correct RHS value |
| `explanation` | string | Why this is an error |
| `suggestion` | string | How to fix it |
| `suggestedFix` | string | Complete corrected step (e.g., `"2x + 3x = 5x"`) |

### Validation

Run the mistake detection test suite:

```bash
cd examples/benchmarks && bun run runner.ts --mistakes-only
```

This runs 64 test cases covering all error types with expected precision/recall metrics.

---

## Detection Confidence

Each detected mistake includes a confidence score (0-1):

| Confidence | Meaning |
|------------|---------|
| 0.95 | High - pattern clearly matches known error |
| 0.85-0.90 | Medium-high - likely error with good evidence |
| 0.75-0.80 | Medium - possible error, may need review |

---

## Limitations

1. **Symbolic only:** Detection works on symbolic expressions, not word problems
2. **Single variable:** Best results with single-variable expressions
3. **Standard notation:** Expects standard mathematical notation
4. **One error per step:** Reports first detected error in each step

---

## Adding New Detectors

To add a new mistake type:

1. Add type to `MistakeType` union in `src/lib/compute/solvers/derivation.ts`
2. Create checker function following the pattern:
   ```typescript
   function checkNewError(
     lhs: string,
     rhs: string,
     lhsAst: ASTNode | null,
     rhsAst: ASTNode | null,
   ): DetectedMistake | null
   ```
3. Add checker to the `checkers` array in `detectCommonMistakes()`
4. Add unit tests in `test/lib.test.ts`
5. Add validation cases in `examples/benchmarks/runner.ts` (`MISTAKE_TEST_CASES`)
