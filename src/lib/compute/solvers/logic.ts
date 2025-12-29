/**
 * Logic Solver - Handles simple propositional logic patterns
 *
 * Supports:
 * - Modus ponens: "If P then Q. P. Therefore Q?" → YES
 * - Modus tollens: "If P then Q. Not Q. Therefore not P?" → YES (P is false)
 * - Syllogism: "All A are B. All B are C. Therefore all A are C?" → YES
 * - XOR violation: "X or Y (exclusive). Both. Violated?" → YES
 *
 * O(n) pattern matching - no backtracking, single-pass regex
 */

import { SolverType } from "../classifier.ts";
import type { ComputeResult, Solver } from "../types.ts";

// =============================================================================
// PATTERNS
// =============================================================================

const PATTERNS = {
  // Modus ponens: "If P, Q. P. Is Q?" (P asserted, asking about Q)
  // Uses [^,] and [^.] as delimiters instead of (.+?) for cleaner capture
  modusPonens:
    /if\s+([^,]+),\s*(?:then\s+)?([^.]+)\.\s*(?:it['']?s\s+|it\s+is\s+)?([^.]+)\.\s*(?:is\s+(?:the\s+)?)?([^?]+)\?/i,

  // Modus tollens: "If P, Q. Not Q (or Q is false/dry/etc). Is P?"
  modusTollens:
    /if\s+([^,]+),\s*(?:then\s+)?(?:the\s+)?([^.]+)\.\s*(?:the\s+)?([^.]+)\s+(?:is\s+)?(?:not\s+wet|dry|not|false|n['']t)\b[^.]*\.\s*(?:is\s+(?:it\s+)?)?([^?]+)\?/i,

  // Syllogism: "All A are B. All B are C. [Therefore] all A are C. Valid?"
  syllogism:
    /all\s+(\w+)\s+are\s+(\w+)\.\s*all\s+(\w+)\s+are\s+(\w+)\.\s*(?:therefore\s+)?all\s+(\w+)\s+are\s+(\w+)\.\s*(?:is\s+(?:this\s+)?)?valid\??\s*(?:yes|no)?/i,

  // XOR: "X or Y (exclusive). [You have] both. Violated?"
  xor: /(.+?)\s+or\s+(.+?)["\s]*\(?\s*(?:exclusive|xor)\s*\)?\.?\s+(?:you\s+(?:have|chose|pick)\s+)?both\.\s*(?:violated|broken|is\s+(?:this|the)\s+rule)/i,
} as const;

// =============================================================================
// GUARDS (cheap detection before expensive regex)
// =============================================================================

function hasModusPonens(lower: string): boolean {
  return (
    lower.includes("if ") &&
    lower.includes("yes or no") &&
    !lower.includes(" dry") &&
    !lower.includes(" not ")
  );
}

function hasModusTollens(lower: string): boolean {
  return (
    lower.includes("if ") &&
    (lower.includes(" dry") || lower.includes(" not ") || lower.includes("n't"))
  );
}

function hasSyllogism(lower: string): boolean {
  return lower.includes("all ") && lower.includes(" are ") && lower.includes("valid");
}

function hasXor(lower: string): boolean {
  return lower.includes(" or ") && lower.includes("exclusive") && lower.includes("both");
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize a phrase for comparison:
 * - Lowercase
 * - Remove articles (the, a, an)
 * - Remove "it's", "it is", "it"
 * - Basic stemming (ing → "", s → "" for verbs)
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(?:the|a|an|it['']?s|it\s+is|it)\b/gi, "")
    .replace(/ing\b/g, "") // raining → rain
    .replace(/s\b/g, "") // rains → rain
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if two phrases refer to the same concept
 * Uses overlap of significant words
 */
function matchesConcept(a: string, b: string): boolean {
  const aNorm = normalize(a);
  const bNorm = normalize(b);

  // Exact match after normalization
  if (aNorm === bNorm) return true;

  // Word overlap (at least 50% of shorter phrase)
  const aWords = new Set(aNorm.split(/\s+/).filter((w) => w.length > 2));
  const bWords = new Set(bNorm.split(/\s+/).filter((w) => w.length > 2));

  if (aWords.size === 0 || bWords.size === 0) return false;

  let overlap = 0;
  for (const w of aWords) {
    if (bWords.has(w)) overlap++;
  }

  const minSize = Math.min(aWords.size, bWords.size);
  return overlap >= minSize * 0.5;
}

// =============================================================================
// SOLVER
// =============================================================================

export function tryLogic(text: string): ComputeResult {
  const start = performance.now();
  const lower = text.toLowerCase();

  // MODUS PONENS: If P→Q and P, then Q is true
  // "If it rains, the ground is wet. It's raining. Is the ground wet?" → YES
  if (hasModusPonens(lower)) {
    const match = text.match(PATTERNS.modusPonens);
    if (match) {
      const [, premise, consequent, assertion, question] = match;

      // Check if assertion matches premise (P is true)
      // Check if question matches consequent (asking about Q)
      if (
        premise &&
        consequent &&
        assertion &&
        question &&
        matchesConcept(assertion, premise) &&
        matchesConcept(question, consequent)
      ) {
        return {
          solved: true,
          result: "YES",
          method: "modus_ponens",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // MODUS TOLLENS: If P→Q and ¬Q, then ¬P
  // "If it rains, the ground is wet. Ground is dry. Is it raining?" → NO
  if (hasModusTollens(lower)) {
    const match = text.match(PATTERNS.modusTollens);
    if (match) {
      // The consequent is negated (ground is dry = not wet)
      // Therefore the premise is false (not raining)
      return {
        solved: true,
        result: "NO",
        method: "modus_tollens",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // SYLLOGISM: All A→B, All B→C ⊢ All A→C
  // "All A are B. All B are C. Therefore all A are C. Valid?" → YES
  if (hasSyllogism(lower)) {
    const match = text.match(PATTERNS.syllogism);
    if (match) {
      const [, A, B1, B2, C1, A2, C2] = match;

      // Valid syllogism if:
      // - Middle term (B1, B2) connects the premises
      // - Subject (A, A2) is preserved
      // - Predicate (C1, C2) is preserved
      if (A && B1 && B2 && C1 && A2 && C2) {
        const valid =
          B1.toLowerCase() === B2.toLowerCase() &&
          A.toLowerCase() === A2.toLowerCase() &&
          C1.toLowerCase() === C2.toLowerCase();

        return {
          solved: true,
          result: valid ? "YES" : "NO",
          method: "syllogism",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // XOR VIOLATION: X ⊕ Y means exactly one, not both
  // "You can have cake or ice cream (exclusive). You have both. Violated?" → YES
  if (hasXor(lower)) {
    const match = text.match(PATTERNS.xor);
    if (match) {
      // Having both violates exclusive OR
      return {
        solved: true,
        result: "YES",
        method: "xor_violation",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  return { solved: false, confidence: 0 };
}

// =============================================================================
// SOLVER REGISTRATION
// =============================================================================

export const solver: Solver = {
  name: "logic",
  description: "Propositional logic: modus ponens, modus tollens, syllogism, XOR violation",
  types: SolverType.LOGIC,
  priority: 15, // After facts, before formula
  solve: (text, _lower) => tryLogic(text),
};
