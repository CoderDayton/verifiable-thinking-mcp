/**
 * Multi-expression extractor
 * Finds and computes ALL mathematical expressions in a text
 *
 * Performance: O(n) using combined regex with alternation
 * V8 optimizes alternation patterns into efficient automata
 */

import { tryLocalCompute } from "./index.ts";
import { buildCombinedSpanRegex, EXTRACT, WORD_PROBLEM_PATTERNS } from "./patterns.ts";
import type { AugmentedResult, ExtractedComputation } from "./types.ts";

/**
 * Format a numeric result for display
 */
function formatResult(result: number | string): number | string {
  if (typeof result === "string") return result;
  return Number.isInteger(result) ? result : +result.toFixed(6);
}

/**
 * Check if a position in text already has an injection marker immediately following
 */
function hasInjectionAt(text: string, pos: number): boolean {
  // Check for " [=" immediately at position (the injection format we use)
  return text.slice(pos, pos + 3) === " [=";
}

/**
 * Remove overlapping computations, keeping the first (leftmost) match
 */
function dedupeOverlaps(computations: ExtractedComputation[]): ExtractedComputation[] {
  if (computations.length <= 1) return computations;

  // Sort by start position
  const sorted = [...computations].sort((a, b) => a.start - b.start);
  const result: ExtractedComputation[] = [];
  let lastEnd = -1;

  for (const comp of sorted) {
    // Skip if this overlaps with previous
    if (comp.start < lastEnd) continue;
    result.push(comp);
    lastEnd = comp.end;
  }

  return result;
}

/**
 * Extract and compute all mathematical expressions in text
 * Returns augmented text with computed values injected
 *
 * Algorithm:
 * 1. Single O(n) pass with combined regex finds formula spans
 * 2. Single O(n) pass finds binary arithmetic
 * 3. Single O(n) pass finds word problems
 * 4. Dedupe overlaps O(c log c)
 * 5. Inject results in reverse order O(c)
 *
 * Total: O(n + c log c) where c = number of matches
 */
export function extractAndCompute(text: string): AugmentedResult {
  const start = performance.now();
  const computations: ExtractedComputation[] = [];

  // Phase 1: Formula patterns (sqrt, factorial, power, etc.) - O(n)
  // Use fresh regex instance to reset lastIndex
  const spanRegex = buildCombinedSpanRegex();
  let match: RegExpExecArray | null;

  while ((match = spanRegex.exec(text)) !== null) {
    const span = match[0];
    const matchStart = match.index;

    // Try to compute this span using the full solver pipeline
    const result = tryLocalCompute(span);

    if (result.solved && result.result !== undefined) {
      computations.push({
        original: span,
        result: formatResult(result.result),
        method: result.method || "formula",
        start: matchStart,
        end: matchStart + span.length,
      });
    }
  }

  // Phase 2: Simple binary operations (5 + 3, 12 * 4) - O(n)
  const binaryPattern = new RegExp(EXTRACT.binaryOp.source, "g");

  while ((match = binaryPattern.exec(text)) !== null) {
    const [full, a, op, b] = match;
    if (!a || !b || !op) continue;

    const matchStart = match.index;

    // Skip if already covered by a formula pattern
    const alreadyCovered = computations.some(
      (c) => c.start <= matchStart && c.end >= matchStart + full.length,
    );
    if (alreadyCovered) continue;

    const numA = parseFloat(a);
    const numB = parseFloat(b);
    let result: number | null = null;

    switch (op) {
      case "+":
        result = numA + numB;
        break;
      case "-":
        result = numA - numB;
        break;
      case "*":
        result = numA * numB;
        break;
      case "/":
        result = numB !== 0 ? numA / numB : null;
        break;
    }

    if (result !== null && Number.isFinite(result)) {
      computations.push({
        original: full,
        result: formatResult(result),
        method: "inline_arithmetic",
        start: matchStart,
        end: matchStart + full.length,
      });
    }
  }

  // Phase 3: Word problems - O(n * p) where p = word patterns (small constant)
  for (const { pattern, compute, method } of WORD_PROBLEM_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "gi");

    while ((match = globalPattern.exec(text)) !== null) {
      const result = compute(match);
      if (result !== null && Number.isFinite(result)) {
        const matchStart = match.index;
        const matchLen = match[0].length;

        // Skip if already covered
        const alreadyCovered = computations.some(
          (c) => c.start <= matchStart && c.end >= matchStart + matchLen,
        );
        if (alreadyCovered) continue;

        computations.push({
          original: match[0],
          result: formatResult(result),
          method,
          start: matchStart,
          end: matchStart + matchLen,
        });
      }
    }
  }

  // Phase 4: Dedupe overlapping matches - O(c log c)
  const deduped = dedupeOverlaps(computations);

  // Phase 5: Inject results in reverse order to preserve positions - O(c)
  // By processing from end to start, each injection doesn't affect earlier positions
  let augmented = text;
  const sortedByPosDesc = [...deduped].sort((a, b) => b.start - a.start);

  for (const comp of sortedByPosDesc) {
    const insertPos = comp.end;
    // Only inject if not already present
    if (!hasInjectionAt(augmented, insertPos)) {
      const injection = ` [=${comp.result}]`;
      augmented = augmented.slice(0, insertPos) + injection + augmented.slice(insertPos);
    }
  }

  return {
    augmented,
    computations: deduped,
    hasComputations: deduped.length > 0,
    time_ms: performance.now() - start,
  };
}

/**
 * Convenience function: compute all expressions and return augmented text only.
 * Use when you just need the result string without metadata.
 *
 * @param text - Input text with mathematical expressions
 * @returns Text with computed values injected as [=result]
 *
 * @example
 * computeAndReplace("The sqrt(16) is important")
 * // => "The sqrt(16) [=4] is important"
 */
export function computeAndReplace(text: string): string {
  return extractAndCompute(text).augmented;
}
