/**
 * Verification Engine - Domain-specific verifiers for reasoning steps
 * Heuristic-based (no LLM calls) for <10ms overhead
 * Includes content-hash caching for repeated verifications
 */

import { verificationCache } from "./cache.ts";

export type VerificationDomain = "math" | "logic" | "code" | "general";

export interface VerificationResult {
  passed: boolean;
  confidence: number; // 0-1
  domain: VerificationDomain;
  evidence: string;
  reward: 0 | 1; // RLVR-style binary reward
  suggestions: string[];
  blindspot_marker?: string; // "Wait" if self-correction blind spot detected
  cached?: boolean; // Whether result was from cache
}

type Verifier = (
  thought: string,
  context: string[],
) => Omit<VerificationResult, "domain" | "reward">;

const verifiers: Record<VerificationDomain, Verifier> = {
  math: verifyMath,
  logic: verifyLogic,
  code: verifyCode,
  general: verifyGeneral,
};

export function verify(
  thought: string,
  domain: VerificationDomain,
  context: string[] = [],
  checkBlindspot: boolean = false,
  useCache: boolean = true,
): VerificationResult {
  // Check cache first
  if (useCache) {
    const cached = verificationCache.get(thought, domain, context);
    if (cached) {
      // Re-check blindspot since it depends on runtime flag
      const blindspot_marker =
        checkBlindspot && !cached.passed ? detectBlindspot(thought, context) : undefined;
      return { ...cached, blindspot_marker, cached: true };
    }
  }

  const verifier = verifiers[domain] || verifiers.general;
  const result = verifier(thought, context);

  const blindspot_marker =
    checkBlindspot && !result.passed ? detectBlindspot(thought, context) : undefined;

  const fullResult: VerificationResult = {
    ...result,
    domain,
    reward: result.passed ? 1 : 0,
    blindspot_marker,
    cached: false,
  };

  // Store in cache
  if (useCache) {
    verificationCache.set(thought, domain, context, fullResult);
  }

  return fullResult;
}

/** Get cache statistics */
export function getVerificationCacheStats() {
  return verificationCache.getStats();
}

/** Clear verification cache */
export function clearVerificationCache(): number {
  return verificationCache.clear();
}

// ============================================================================
// DOMAIN VERIFIERS
// ============================================================================

function verifyMath(
  thought: string,
  _context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  const lower = thought.toLowerCase();

  // Check for mathematical content
  const hasMath =
    /[\d.+\-*/()=]/.test(thought) ||
    /solve|calculate|equation|derivative|integral|sum|product/i.test(thought);

  // Check for balanced parentheses/brackets
  const balanced = checkBalanced(thought);

  // Check for contradictions
  const hasContradiction = /but also|both true and false|contradiction/i.test(lower);

  // Check for valid algebraic patterns
  const validAlgebra = !/=.*=.*=/.test(thought); // No chained equals without context

  const passed = hasMath && balanced && !hasContradiction && validAlgebra;
  const confidence = calculateConfidence([hasMath, balanced, !hasContradiction, validAlgebra]);

  const suggestions: string[] = [];
  if (!hasMath) suggestions.push("Include mathematical expressions or operations");
  if (!balanced) suggestions.push("Check parentheses/brackets are balanced");
  if (hasContradiction) suggestions.push("Resolve the logical contradiction");
  if (!validAlgebra) suggestions.push("Simplify chained equations");
  if (passed) suggestions.push("Continue with next step");

  return {
    passed,
    confidence,
    evidence: passed ? "Valid mathematical reasoning" : suggestions[0] || "Verification failed",
    suggestions,
  };
}

function verifyLogic(
  thought: string,
  context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  const lower = thought.toLowerCase();

  // Check for logical structure
  const hasLogicalKeywords =
    /if|then|therefore|because|implies|hence|thus|conclude|assume|given/i.test(thought);

  // Check for contradictions
  const contradictions = [
    "both true and false",
    "and not both",
    "yes and no simultaneously",
    "contradiction",
  ];
  const hasContradiction = contradictions.some((c) => lower.includes(c));

  // Check for circular reasoning indicators
  const hasCircular = /because it is|proves itself|self-evident without/i.test(lower);

  // Check consistency with prior context
  const consistent = checkContextConsistency(thought, context);

  const passed = hasLogicalKeywords && !hasContradiction && !hasCircular && consistent;
  const confidence = calculateConfidence([
    hasLogicalKeywords,
    !hasContradiction,
    !hasCircular,
    consistent,
  ]);

  const suggestions: string[] = [];
  if (!hasLogicalKeywords)
    suggestions.push("Add logical connectives (if/then, therefore, because)");
  if (hasContradiction) suggestions.push("Resolve the contradiction");
  if (hasCircular) suggestions.push("Avoid circular reasoning");
  if (!consistent) suggestions.push("Check consistency with previous steps");
  if (passed) suggestions.push("Reasoning is logically sound");

  return {
    passed,
    confidence,
    evidence: passed ? "Logically consistent" : suggestions[0] || "Logic check failed",
    suggestions,
  };
}

function verifyCode(
  thought: string,
  _context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  // Check for code-related content
  const hasCodeKeywords =
    /function|class|return|const|let|var|if|for|while|async|await|def|import|export|->|=>|struct|impl|fn|pub/i.test(
      thought,
    );

  // Check balanced brackets/braces
  const balanced = checkBalanced(thought);

  // Check for common code smells in reasoning
  const hasInfiniteLoop = /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)|loop\s*{/i.test(thought);
  const hasNullDeref = /\.\s*unwrap\s*\(\s*\)|\.unwrap\(\)|null\s*\./i.test(thought);

  // Check for algorithm keywords
  const hasAlgorithm =
    /algorithm|complexity|O\(|time|space|iterate|recurse|sort|search|hash|tree|graph/i.test(
      thought,
    );

  const passed = (hasCodeKeywords || hasAlgorithm) && balanced && !hasInfiniteLoop;
  const confidence = calculateConfidence([
    hasCodeKeywords || hasAlgorithm,
    balanced,
    !hasInfiniteLoop,
    !hasNullDeref,
  ]);

  const suggestions: string[] = [];
  if (!hasCodeKeywords && !hasAlgorithm)
    suggestions.push("Include code concepts or algorithm discussion");
  if (!balanced) suggestions.push("Check bracket/brace balance");
  if (hasInfiniteLoop) suggestions.push("Potential infinite loop detected");
  if (hasNullDeref) suggestions.push("Consider handling null/None cases");
  if (passed) suggestions.push("Code reasoning is valid");

  return {
    passed,
    confidence,
    evidence: passed ? "Valid code reasoning" : suggestions[0] || "Code verification failed",
    suggestions,
  };
}

function verifyGeneral(
  thought: string,
  context: string[],
): Omit<VerificationResult, "domain" | "reward"> {
  // Basic coherence checks
  const hasSubstance = thought.length > 15;
  const notJustQuestion = !thought.trim().endsWith("?") || thought.length > 50;
  const hasStructure = /\.|,|;|:/.test(thought); // Has punctuation

  // Check for vague/non-committal language
  const tooVague =
    /maybe|perhaps|possibly|might|could be|not sure/i.test(thought) && thought.length < 100;

  // Check context relevance (simple keyword overlap)
  const relevant = context.length === 0 || checkContextRelevance(thought, context);

  const passed = hasSubstance && notJustQuestion && !tooVague && relevant;
  const confidence = calculateConfidence([
    hasSubstance,
    notJustQuestion,
    !tooVague,
    relevant,
    hasStructure,
  ]);

  const suggestions: string[] = [];
  if (!hasSubstance) suggestions.push("Provide more detailed reasoning");
  if (!notJustQuestion) suggestions.push("Answer the question rather than asking another");
  if (tooVague) suggestions.push("Be more specific in your reasoning");
  if (!relevant) suggestions.push("Ensure relevance to previous context");
  if (passed) suggestions.push("Proceed to next step");

  return {
    passed,
    confidence,
    evidence: passed ? "Coherent reasoning" : suggestions[0] || "General check failed",
    suggestions,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function checkBalanced(text: string): boolean {
  const brackets: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];

  for (const char of text) {
    if (char in brackets) {
      stack.push(char);
    } else if (Object.values(brackets).includes(char)) {
      const last = stack.pop();
      if (!last || brackets[last] !== char) {
        return false;
      }
    }
  }

  return stack.length === 0;
}

function checkContextConsistency(thought: string, context: string[]): boolean {
  if (context.length === 0) return true;

  const lower = thought.toLowerCase();

  // Check for explicit contradictions with prior context
  for (const prev of context) {
    const prevLower = prev.toLowerCase();

    // Simple negation check
    if (
      lower.includes(`not ${prevLower.slice(0, 20)}`) ||
      prevLower.includes(`not ${lower.slice(0, 20)}`)
    ) {
      return false;
    }
  }

  return true;
}

function checkContextRelevance(thought: string, context: string[]): boolean {
  if (context.length === 0) return true;

  const thoughtWords = new Set(tokenize(thought));
  const contextWords = new Set(context.flatMap((c) => tokenize(c)));

  // Check for at least some word overlap
  let overlap = 0;
  for (const word of thoughtWords) {
    if (contextWords.has(word)) overlap++;
  }

  return overlap >= 1 || thoughtWords.size < 5;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function calculateConfidence(checks: boolean[]): number {
  const passed = checks.filter(Boolean).length;
  return Math.round((passed / checks.length) * 100) / 100;
}

function detectBlindspot(thought: string, _context: string[]): string | undefined {
  // Research: 64.5% average failure rate in self-correction
  // "Wait" marker reduces blind spots by 89.3%

  const hasError = /error|mistake|wrong|incorrect|bug|issue/i.test(thought);
  const hasCorrection = /but|however|actually|correction|fix|instead/i.test(thought);

  // If there's an error mention without correction attempt, suggest marker
  // Using ternary to avoid coverage gap on closing brace
  return hasError && !hasCorrection ? "Wait" : undefined;
}
