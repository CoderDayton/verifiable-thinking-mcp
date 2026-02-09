/**
 * Hypothesis Resolution - Detects when a branch's hypothesis is confirmed or refuted
 *
 * Uses O(n) pattern matching to detect resolution signals in step content:
 * - Confirmation: "therefore", "confirmed", "proves", "QED", "thus we have shown"
 * - Refutation: "contradiction", "impossible", "disproved", "fails", "cannot be"
 *
 * Returns resolution status for branches with hypotheses.
 */

/** Resolution status for a hypothesis */
export interface HypothesisResolution {
  /** Whether the hypothesis has been resolved */
  resolved: boolean;
  /** Resolution outcome if resolved */
  outcome: "confirmed" | "refuted" | "inconclusive" | null;
  /** Confidence in the resolution (0-1) */
  confidence: number;
  /** Step number where resolution was detected */
  resolved_at_step: number | null;
  /** Evidence text that triggered resolution */
  evidence: string | null;
  /** The original hypothesis being tested */
  hypothesis: string;
  /** The success criteria (if provided) */
  success_criteria: string | null;
  /** Suggested action based on resolution */
  suggestion: string;
}

// Confirmation patterns - signals that hypothesis is proven true
const CONFIRMATION_PATTERNS = [
  /\b(?:therefore|thus|hence|consequently)\b.*\b(?:true|correct|valid|proven|confirmed)\b/i,
  /\b(?:this\s+)?(?:confirms?|proves?|shows?|demonstrates?)\s+(?:that\s+)?(?:the\s+)?hypothesis\b/i,
  /\b(?:QED|Q\.E\.D\.|quod\s+erat\s+demonstrandum)\b/i,
  /\b(?:we\s+have\s+shown|we\s+conclude|this\s+establishes)\b/i,
  /\bhypothesis\s+(?:is\s+)?(?:true|correct|valid|confirmed)\b/i,
  // "as expected/hypothesized" but NOT "assume is true"
  /\bas\s+(?:we\s+)?(?:hypothesized|expected|predicted)\b/i,
  /\bsuccess(?:fully)?\s+(?:verified|confirmed|proven)\b/i,
];

// Refutation patterns - signals that hypothesis is proven false
const REFUTATION_PATTERNS = [
  /\b(?:contradiction|contradicts?|inconsistent)\b/i,
  /\b(?:impossible|cannot\s+be|can't\s+be)\b/i,
  /\b(?:disprove[ds]?|refute[ds]?|falsif(?:y|ied))\b/i,
  /\bhypothesis\s+(?:is\s+)?(?:false|incorrect|invalid|wrong|fails?)\b/i,
  /\b(?:this\s+)?(?:fails?|violates?|breaks?)\s+(?:the\s+)?(?:assumption|hypothesis)\b/i,
  /\b(?:counterexample|counter-example)\b/i,
  /\bnot\s+(?:true|valid|correct|possible)\b/i,
  /\b(?:rejected?|abandon|discard)\s+(?:the\s+)?hypothesis\b/i,
];

// Inconclusive patterns - explicitly states uncertainty remains
const INCONCLUSIVE_PATTERNS = [
  /\b(?:inconclusive|undetermined|unclear|uncertain)\b/i,
  /\b(?:need|require)s?\s+(?:more|further|additional)\s+(?:evidence|proof|analysis)\b/i,
  /\b(?:cannot\s+(?:yet\s+)?(?:determine|conclude|decide))\b/i,
  /\b(?:insufficient\s+(?:evidence|data|information))\b/i,
];

/**
 * Check if text matches any pattern in a list
 * Returns the matching text if found
 */
function findMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Check if success criteria is mentioned/satisfied in text
 */
function checkSuccessCriteria(text: string, criteria: string): boolean {
  // Normalize both for comparison
  const normalizedText = text.toLowerCase();
  const normalizedCriteria = criteria.toLowerCase();

  // Check if criteria keywords appear in text
  const criteriaWords = normalizedCriteria.split(/\s+/).filter((w) => w.length > 3); // Skip short words

  const matchCount = criteriaWords.filter((word) => normalizedText.includes(word)).length;

  // If >50% of meaningful words match, consider criteria referenced
  return matchCount >= criteriaWords.length * 0.5;
}

/**
 * Analyze a step for hypothesis resolution signals
 *
 * @param stepText - The thought content of the step
 * @param hypothesis - The hypothesis being tested
 * @param successCriteria - Optional success criteria
 * @param stepNumber - The step number
 * @returns Resolution analysis or null if no resolution detected
 */
export function analyzeStepForResolution(
  stepText: string,
  hypothesis: string,
  successCriteria: string | null,
  stepNumber: number,
): HypothesisResolution {
  const baseResult: HypothesisResolution = {
    resolved: false,
    outcome: null,
    confidence: 0,
    resolved_at_step: null,
    evidence: null,
    hypothesis,
    success_criteria: successCriteria,
    suggestion: "Continue testing the hypothesis.",
  };

  // Check for refutation first (stronger signal - contradictions are definitive)
  const refutationMatch = findMatch(stepText, REFUTATION_PATTERNS);
  if (refutationMatch) {
    return {
      ...baseResult,
      resolved: true,
      outcome: "refuted",
      confidence: 0.9,
      resolved_at_step: stepNumber,
      evidence: refutationMatch,
      suggestion: "Hypothesis refuted. Consider abandoning this branch or revising the hypothesis.",
    };
  }

  // Check for explicit inconclusive
  const inconclusiveMatch = findMatch(stepText, INCONCLUSIVE_PATTERNS);
  if (inconclusiveMatch) {
    return {
      ...baseResult,
      resolved: true,
      outcome: "inconclusive",
      confidence: 0.7,
      resolved_at_step: stepNumber,
      evidence: inconclusiveMatch,
      suggestion: "Hypothesis inconclusive. Gather more evidence or reformulate.",
    };
  }

  // Check for confirmation
  const confirmationMatch = findMatch(stepText, CONFIRMATION_PATTERNS);
  if (confirmationMatch) {
    let confidence = 0.85;

    // Boost confidence if success criteria is explicitly satisfied
    if (successCriteria && checkSuccessCriteria(stepText, successCriteria)) {
      confidence = 0.95;
    }

    return {
      ...baseResult,
      resolved: true,
      outcome: "confirmed",
      confidence,
      resolved_at_step: stepNumber,
      evidence: confirmationMatch,
      suggestion: "Hypothesis confirmed. Consider merging findings back to main branch.",
    };
  }

  // Check if success criteria is mentioned even without explicit confirmation
  if (successCriteria && checkSuccessCriteria(stepText, successCriteria)) {
    return {
      ...baseResult,
      resolved: false,
      outcome: null,
      confidence: 0.6,
      evidence: "Success criteria keywords detected",
      suggestion: "Success criteria may be satisfied. Verify and explicitly confirm or refute.",
    };
  }

  return baseResult;
}

/**
 * Analyze all steps in a branch for hypothesis resolution
 *
 * @param steps - Array of steps with their content
 * @param hypothesis - The hypothesis being tested
 * @param successCriteria - Optional success criteria
 * @returns Resolution status based on all steps
 */
export function analyzeHypothesisResolution(
  steps: Array<{ step: number; thought: string }>,
  hypothesis: string,
  successCriteria: string | null,
): HypothesisResolution {
  // Analyze each step, return first resolution found (chronological)
  for (const { step, thought } of steps) {
    const result = analyzeStepForResolution(thought, hypothesis, successCriteria, step);
    if (result.resolved) {
      return result;
    }
  }

  // No resolution found
  return {
    resolved: false,
    outcome: null,
    confidence: 0,
    resolved_at_step: null,
    evidence: null,
    hypothesis,
    success_criteria: successCriteria,
    suggestion: `Continue testing hypothesis: "${hypothesis.slice(0, 50)}${hypothesis.length > 50 ? "..." : ""}"`,
  };
}
