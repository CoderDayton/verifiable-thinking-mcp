/**
 * Derivation LaTeX - converts derivations to LaTeX format
 *
 * Produces LaTeX code suitable for mathematical documents with proper
 * alignment of equals signs and optional step numbering.
 *
 * @module derivation-latex
 */

import { extractDerivationSteps } from "./derivation-core.ts";

/** Options for LaTeX derivation formatting */
export interface DerivationLatexOptions {
  /** Use align environment for multi-step (default: true) */
  useAlign?: boolean;
  /** Add step numbers as comments (default: false) */
  showStepNumbers?: boolean;
  /** Include "therefore" symbol before final step (default: false) */
  showTherefore?: boolean;
  /** Custom label for the derivation (default: none) */
  label?: string;
}

/**
 * Convert an expression to LaTeX notation
 */
function toLatex(expr: string): string {
  let result = expr;

  // Convert multiplication: * or · → \cdot
  result = result.replace(/\s*[*·×]\s*/g, " \\cdot ");

  // Convert division: ÷ → \div (or could use \frac)
  result = result.replace(/\s*÷\s*/g, " \\div ");

  // Convert powers: x^2 → x^{2}, x^10 → x^{10}
  result = result.replace(/\^(\d+)/g, "^{$1}");
  result = result.replace(/\^([a-zA-Z])/g, "^{$1}");

  // Convert sqrt: sqrt(x) → \sqrt{x}
  result = result.replace(/sqrt\(([^)]+)\)/gi, "\\sqrt{$1}");

  // Convert common functions
  result = result.replace(/\b(sin|cos|tan|log|ln|exp)\b/g, "\\$1");

  // Convert pi → \pi
  result = result.replace(/\bpi\b/gi, "\\pi");

  // Convert fractions: a/b → \frac{a}{b} (simple cases only)
  result = result.replace(/(\d+)\s*\/\s*(\d+)/g, "\\frac{$1}{$2}");

  // Handle minus signs for better rendering
  result = result.replace(/−/g, "-");

  return result;
}

/**
 * Convert a derivation chain to LaTeX format with aligned equations
 *
 * Produces LaTeX code suitable for mathematical documents with proper
 * alignment of equals signs and optional step numbering.
 *
 * @param steps Array of {lhs, rhs} pairs representing the derivation
 * @param options Formatting options
 * @returns LaTeX string
 *
 * @example
 * derivationToLatex([
 *   { lhs: "x + x", rhs: "2x" },
 *   { lhs: "2x", rhs: "2 * x" }
 * ])
 * // Returns:
 * // \begin{align}
 * //   x + x &= 2x \\
 * //   &= 2 \cdot x
 * // \end{align}
 */
export function derivationToLatex(
  steps: Array<{ lhs: string; rhs: string }>,
  options: DerivationLatexOptions = {},
): string {
  const { useAlign = true, showStepNumbers = false, showTherefore = false, label } = options;

  if (steps.length === 0) {
    return "";
  }

  const lines: string[] = [];

  if (useAlign) {
    const envStart = label ? `\\begin{align}\\label{${label}}` : "\\begin{align}";
    lines.push(envStart);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      const isFirst = i === 0;
      const isLast = i === steps.length - 1;

      const lhsLatex = toLatex(step.lhs);
      const rhsLatex = toLatex(step.rhs);

      let line: string;

      if (isFirst) {
        // First line shows full equation
        line = `  ${lhsLatex} &= ${rhsLatex}`;
      } else {
        // Subsequent lines only show RHS (aligned at =)
        if (showTherefore && isLast) {
          line = `  &\\therefore ${rhsLatex}`;
        } else {
          line = `  &= ${rhsLatex}`;
        }
      }

      // Add step number comment
      if (showStepNumbers) {
        line += ` && \\text{(${i + 1})}`;
      }

      // Add line continuation (except last line)
      if (!isLast) {
        line += " \\\\";
      }

      lines.push(line);
    }

    lines.push("\\end{align}");
  } else {
    // Simple equation environment (no alignment)
    const allExprs = steps.map((s) => `${toLatex(s.lhs)} = ${toLatex(s.rhs)}`);
    lines.push("\\begin{equation}");
    lines.push(`  ${allExprs.join(" = ")}`);
    lines.push("\\end{equation}");
  }

  return lines.join("\n");
}

/**
 * Convert text containing a derivation to LaTeX
 *
 * @param text Text containing a derivation
 * @param options Formatting options
 * @returns LaTeX string or null if no derivation found
 */
export function derivationTextToLatex(
  text: string,
  options: DerivationLatexOptions = {},
): string | null {
  const steps = extractDerivationSteps(text);
  if (steps.length === 0) {
    return null;
  }
  return derivationToLatex(steps, options);
}
