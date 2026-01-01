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
  // Modus tollens: "If P→Q and ¬Q, then ¬P"
  // The CONSEQUENT is negated (dry = not wet), asking about the ANTECEDENT
  // Exclude "therefore" which signals denying antecedent pattern
  return (
    lower.includes("if ") &&
    (lower.includes(" dry") || lower.includes(" not ") || lower.includes("n't")) &&
    !lower.includes("therefore") // "therefore" indicates a conclusion claim, not a question
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
 * - Basic stemming (ing → "", ed → "", s → "" for verbs)
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(?:the|a|an|it['']?s|it\s+is|it)\b/gi, "")
    .replace(/ing\b/g, "") // raining → rain
    .replace(/ed\b/g, "") // rained → rain
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: logic solver requires exhaustive pattern matching for logical forms
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

  // AFFIRMING THE CONSEQUENT (invalid): If P→Q and Q, cannot conclude P
  // "If it rains, ground is wet. Ground is wet. Therefore it rained. Valid?" → NO
  // "If it rains, ground is wet. Ground is wet. Can we conclude it rained?" → NO
  if (lower.includes("if ") && (lower.includes("valid") || lower.includes("conclude"))) {
    // Pattern 1: "If P, Q. Q. Therefore P. Valid?"
    const affirmConseq1 =
      /if\s+([^,]+),\s*(?:then\s+)?(?:the\s+)?([^.]+)\.\s*(?:the\s+)?([^.]+)\s+is\s+([^.]+)\.\s*therefore\s+(?:it\s+)?([^.]+)\.\s*valid/i;
    const match1 = text.match(affirmConseq1);
    if (match1) {
      const [, premise, consequent, subject, _state, conclusion] = match1;
      if (
        premise &&
        consequent &&
        conclusion &&
        matchesConcept(subject || "", consequent) &&
        matchesConcept(conclusion, premise)
      ) {
        return {
          solved: true,
          result: "NO",
          method: "affirming_consequent",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }

    // Pattern 2: "If P, Q. Q. Can we conclude P?" (more natural phrasing)
    const affirmConseq2 =
      /if\s+([^,]+),\s*(?:then\s+)?(?:the\s+)?([^.]+)\.\s*(?:the\s+)?([^.]+?)\.\s*(?:can\s+we\s+)?conclude\s+(?:that\s+)?(?:it\s+)?([^?]+)\?/i;
    const match2 = text.match(affirmConseq2);
    if (match2) {
      const [, premise, consequent, assertion, conclusion] = match2;
      // Check if assertion matches consequent (affirming Q)
      // And conclusion tries to derive premise (claiming P)
      if (
        premise &&
        consequent &&
        assertion &&
        conclusion &&
        matchesConcept(assertion, consequent) &&
        matchesConcept(conclusion, premise)
      ) {
        return {
          solved: true,
          result: "NO",
          method: "affirming_consequent",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }

    // Pattern 3: "If P then Q. Q is true. Therefore P is true. Valid?"
    const affirmConseq3 =
      /if\s+(\w+)\s+then\s+(\w+)\.\s*(\w+)\s+is\s+true\.\s*therefore\s+(\w+)\s+is\s+true\.\s*valid/i;
    const match3 = text.match(affirmConseq3);
    if (match3) {
      const [, P, Q, assertedQ, concludedP] = match3;
      // Affirming consequent: Q is true, claiming P is true (invalid)
      if (
        Q &&
        assertedQ &&
        P &&
        concludedP &&
        Q.toLowerCase() === assertedQ.toLowerCase() &&
        P.toLowerCase() === concludedP.toLowerCase()
      ) {
        return {
          solved: true,
          result: "NO",
          method: "affirming_consequent",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // DENYING THE ANTECEDENT (invalid): If P→Q and ¬P, cannot conclude ¬Q
  // "If it rains, ground is wet. It's not raining. Therefore ground is dry. Valid?" → NO
  if (lower.includes("valid") && lower.includes("therefore") && lower.includes("not ")) {
    const denyAntecedent =
      /if\s+([^,]+),\s*(?:then\s+)?(?:the\s+)?([^.]+)\.\s*(?:it['']?s\s+)?not\s+([^.]+)\.\s*therefore\s+(?:the\s+)?([^.]+)\s+is\s+([^.]+)\.\s*valid/i;
    const match = text.match(denyAntecedent);
    if (match) {
      const [, premise, consequent, negatedPremise, subject, _conclusion] = match;
      // If negating premise and concluding about consequent, it's invalid
      if (
        premise &&
        consequent &&
        negatedPremise &&
        matchesConcept(negatedPremise, premise) &&
        matchesConcept(subject || "", consequent)
      ) {
        return {
          solved: true,
          result: "NO",
          method: "denying_antecedent",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // DE MORGAN'S LAWS
  // NOT(A AND B) = (NOT A) OR (NOT B)
  // NOT(A OR B) = (NOT A) AND (NOT B)
  if (
    lower.includes("not") &&
    (lower.includes("equivalent") || lower.includes("fill") || lower.includes("="))
  ) {
    // NOT(A AND B) = (NOT A) ___ (NOT B) → OR
    // Also matches "is equivalent to"
    const deMorganAnd = /not\s*\(\s*a\s+and\s+b\s*\).*?\(not\s+a\)\s*(?:_+|and|or)\s*\(not\s+b\)/i;
    if (deMorganAnd.test(text) && lower.includes("and b")) {
      // Check if it's NOT(A AND B) pattern
      if (/not\s*\(\s*a\s+and\s+b\s*\)/i.test(text)) {
        return {
          solved: true,
          result: "OR",
          method: "de_morgan_and",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }

    // NOT(A OR B) = (NOT A) ___ (NOT B) → AND
    const deMorganOr = /not\s*\(\s*a\s+or\s+b\s*\).*?\(not\s+a\)\s*(?:_+|and|or)\s*\(not\s+b\)/i;
    if (deMorganOr.test(text) && lower.includes("or b")) {
      // Check if it's NOT(A OR B) pattern
      if (/not\s*\(\s*a\s+or\s+b\s*\)/i.test(text)) {
        return {
          solved: true,
          result: "AND",
          method: "de_morgan_or",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
    }
  }

  // INVALID SYLLOGISM: "Some A are B. Some B are C. Therefore some A are C." → NO
  if (lower.includes("some") && lower.includes("valid")) {
    const invalidSyllogism =
      /some\s+(\w+)\s+are\s+(\w+)\.\s*some\s+(\w+)\s+are\s+(\w+)\.\s*(?:therefore\s+)?some\s+(\w+)\s+are\s+(\w+)\.\s*valid/i;
    const match = text.match(invalidSyllogism);
    if (match) {
      // "Some A are B. Some B are C." does NOT imply "Some A are C"
      // This is an undistributed middle term fallacy
      return {
        solved: true,
        result: "NO",
        method: "invalid_syllogism_some",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // CONTRAPOSITIVE: "All A are B" is equivalent to "All non-B are non-A" → YES
  // "All dogs are mammals" = "All non-mammals are non-dogs"
  if (lower.includes("equivalent") && lower.includes("all ") && lower.includes("non-")) {
    // Pattern: "All X are Y" is equivalent to "All non-Y are non-X"
    const contrapositiveMatch = text.match(
      /["']?all\s+(\w+)\s+are\s+(\w+)["']?\s+is\s+equivalent\s+to\s+["']?all\s+non-(\w+)\s+are\s+non-(\w+)["']?/i,
    );
    if (contrapositiveMatch) {
      const [, A, B, notB, notA] = contrapositiveMatch;
      // Valid contrapositive: All A→B ≡ All ¬B→¬A
      // Check if the terms match correctly (B matches notB, A matches notA)
      if (
        A &&
        B &&
        notB &&
        notA &&
        B.toLowerCase() === notB.toLowerCase() &&
        A.toLowerCase() === notA.toLowerCase()
      ) {
        return {
          solved: true,
          result: "YES",
          method: "contrapositive",
          confidence: 1.0,
          time_ms: performance.now() - start,
        };
      }
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
