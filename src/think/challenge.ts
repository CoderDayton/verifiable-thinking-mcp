/**
 * Challenge Operation - Adversarial Self-Check for Reasoning Quality
 *
 * Generates counterarguments to combat confirmation bias by:
 * - Inverting key assumptions
 * - Finding edge cases
 * - Verifying premises were established
 * - Generating steelman counterarguments
 *
 * O(n) complexity using regex-based claim extraction.
 */

/** Types of challenges that can be generated */
export type ChallengeType =
  | "assumption_inversion"
  | "edge_case"
  | "premise_check"
  | "steelman_counter";

/** A generated challenge to a claim */
export interface Challenge {
  /** Type of challenge */
  type: ChallengeType;
  /** The original claim being challenged */
  original_claim: string;
  /** The challenge/counterargument */
  challenge: string;
  /** How serious is this challenge */
  severity: "low" | "medium" | "high";
  /** Suggested way to address this challenge */
  suggested_response: string;
}

/** Result of running challenge operation */
export interface ChallengeResult {
  /** Number of challenges generated */
  challenges_generated: number;
  /** The challenges */
  challenges: Challenge[];
  /** Overall robustness score (0-1) */
  overall_robustness: number;
  /** Summary of findings */
  summary: string;
}

// Patterns to extract claims/conclusions from text
const CLAIM_PATTERNS = [
  /(?:therefore|thus|hence|consequently|so)\s+(.{10,100}?)(?:\.|$)/gi,
  /(?:we conclude|this means|this shows|this proves)\s+(?:that\s+)?(.{10,100}?)(?:\.|$)/gi,
  /(?:it follows that|it must be that)\s+(.{10,100}?)(?:\.|$)/gi,
  /(.{5,50})\s+(?:is|are)\s+(?:true|false|correct|incorrect|valid|invalid)(?:\.|$)/gi,
  /(?:the answer is|the result is|the solution is)\s+(.{5,100}?)(?:\.|$)/gi,
];

// Patterns for conditional statements (if P then Q)
const CONDITIONAL_PATTERN = /if\s+(.{5,80}?)(?:,\s*)?then\s+(.{5,80}?)(?:\.|,|$)/gi;

// Assumption words to invert
const ASSUMPTION_INVERSIONS: Record<string, string> = {
  always: "sometimes not",
  never: "sometimes",
  all: "some",
  none: "some",
  every: "some",
  must: "might not",
  cannot: "might",
  impossible: "possible",
  certain: "uncertain",
  definitely: "possibly not",
  obviously: "not necessarily",
  clearly: "arguably",
};

// Numeric patterns for edge case detection
const NUMERIC_PATTERN = /\b(\d+(?:\.\d+)?)\b/g;

/**
 * Extract claims from text using pattern matching
 */
function extractClaims(text: string): string[] {
  const claims: string[] = [];
  const seen = new Set<string>();

  for (const pattern of CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const claim = match[1]?.trim();
      if (claim && claim.length > 10 && !seen.has(claim.toLowerCase())) {
        claims.push(claim);
        seen.add(claim.toLowerCase());
      }
    }
  }

  return claims;
}

/**
 * Extract conditional statements (if P then Q)
 */
function extractConditionals(text: string): Array<{ premise: string; conclusion: string }> {
  const conditionals: Array<{ premise: string; conclusion: string }> = [];
  CONDITIONAL_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CONDITIONAL_PATTERN.exec(text)) !== null) {
    const premise = match[1]?.trim();
    const conclusion = match[2]?.trim();
    if (premise && conclusion) {
      conditionals.push({ premise, conclusion });
    }
  }

  return conditionals;
}

/**
 * Generate assumption inversion challenges
 */
function generateAssumptionInversions(claim: string): Challenge[] {
  const challenges: Challenge[] = [];
  const lowerClaim = claim.toLowerCase();

  for (const [word, inversion] of Object.entries(ASSUMPTION_INVERSIONS)) {
    if (lowerClaim.includes(word)) {
      challenges.push({
        type: "assumption_inversion",
        original_claim: claim,
        challenge: `What if "${word}" should be "${inversion}"? The claim assumes absolute certainty.`,
        severity: "medium",
        suggested_response: `Verify the "${word}" claim with evidence or soften to "${inversion}".`,
      });
    }
  }

  return challenges;
}

/**
 * Generate edge case challenges from numeric values
 */
function generateEdgeCases(claim: string): Challenge[] {
  const challenges: Challenge[] = [];

  // Find numeric values
  NUMERIC_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMERIC_PATTERN.exec(claim)) !== null) {
    const matchValue = match[1];
    if (!matchValue) continue;
    const num = parseFloat(matchValue);
    if (!Number.isNaN(num)) {
      const edgeCases = [0, -1, 1, num - 1, num + 1];
      if (num > 0) edgeCases.push(-num);

      challenges.push({
        type: "edge_case",
        original_claim: claim,
        challenge: `Does the claim hold for edge cases: ${edgeCases.slice(0, 3).join(", ")}?`,
        severity: "low",
        suggested_response: `Test the claim with boundary values: ${edgeCases.join(", ")}.`,
      });
      break; // One edge case challenge per claim
    }
  }

  return challenges;
}

/**
 * Generate premise check challenges from conditionals
 */
function generatePremiseChecks(
  conditionals: Array<{ premise: string; conclusion: string }>,
  allText: string,
): Challenge[] {
  const challenges: Challenge[] = [];
  const lowerText = allText.toLowerCase();

  for (const { premise, conclusion } of conditionals) {
    // Check if premise was established (mentioned affirmatively)
    const premiseWords = premise
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const premiseInText = premiseWords.filter((w) => lowerText.includes(w)).length;
    const coverage = premiseWords.length > 0 ? premiseInText / premiseWords.length : 0;

    if (coverage < 0.5) {
      challenges.push({
        type: "premise_check",
        original_claim: `If ${premise} then ${conclusion}`,
        challenge: `The premise "${premise}" was not clearly established before concluding "${conclusion}".`,
        severity: "high",
        suggested_response: `Add a step that explicitly establishes: "${premise}".`,
      });
    }
  }

  return challenges;
}

/**
 * Generate steelman counterargument
 */
function generateSteelmanCounter(claim: string): Challenge {
  return {
    type: "steelman_counter",
    original_claim: claim,
    challenge: `Steel-man opposing view: What's the strongest argument AGAINST "${claim.slice(0, 50)}${claim.length > 50 ? "..." : ""}"?`,
    severity: "medium",
    suggested_response: "Address the strongest possible counterargument before finalizing.",
  };
}

/**
 * Calculate overall robustness score
 */
function calculateRobustness(challenges: Challenge[]): number {
  if (challenges.length === 0) return 1.0;

  const severityWeights = { low: 0.1, medium: 0.25, high: 0.5 };
  const totalPenalty = challenges.reduce((sum, c) => sum + severityWeights[c.severity], 0);

  // Robustness decreases with more/severe challenges
  return Math.max(0, 1 - Math.min(totalPenalty, 1));
}

/**
 * Run adversarial challenge on reasoning steps
 *
 * @param steps - Array of reasoning step texts
 * @param targetClaim - Optional specific claim to challenge
 * @returns Challenge result with generated counterarguments
 */
export function challenge(
  steps: Array<{ step: number; thought: string }>,
  targetClaim?: string,
): ChallengeResult {
  if (steps.length === 0) {
    return {
      challenges_generated: 0,
      challenges: [],
      overall_robustness: 1.0,
      summary: "No steps to challenge.",
    };
  }

  // Combine all text for analysis
  const allText = steps.map((s) => s.thought).join(" ");

  // Extract claims and conditionals
  const claims = targetClaim ? [targetClaim] : extractClaims(allText);
  const conditionals = extractConditionals(allText);

  const challenges: Challenge[] = [];

  // Generate challenges for each claim
  for (const claim of claims.slice(0, 5)) {
    // Limit to 5 claims
    challenges.push(...generateAssumptionInversions(claim));
    challenges.push(...generateEdgeCases(claim));

    // Add one steelman counter for the most recent claim
    if (claim === claims[claims.length - 1]) {
      challenges.push(generateSteelmanCounter(claim));
    }
  }

  // Generate premise checks from conditionals
  challenges.push(...generatePremiseChecks(conditionals, allText));

  // Dedupe by challenge text
  const seen = new Set<string>();
  const uniqueChallenges = challenges.filter((c) => {
    const key = c.challenge.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Calculate robustness
  const robustness = calculateRobustness(uniqueChallenges);

  // Generate summary
  const highCount = uniqueChallenges.filter((c) => c.severity === "high").length;
  const summary =
    uniqueChallenges.length === 0
      ? "No significant challenges found. Reasoning appears robust."
      : highCount > 0
        ? `⚠️ Found ${highCount} high-severity challenge(s). Address before finalizing.`
        : `Found ${uniqueChallenges.length} challenge(s). Robustness: ${(robustness * 100).toFixed(0)}%`;

  return {
    challenges_generated: uniqueChallenges.length,
    challenges: uniqueChallenges,
    overall_robustness: robustness,
    summary,
  };
}

/**
 * Quick check if reasoning should be challenged (for auto-trigger)
 * Returns true if overconfidence detected or claims lack support
 */
export function shouldChallenge(
  chainConfidence: number,
  stepCount: number,
  hasVerification: boolean,
): boolean {
  // Trigger on overconfidence: high confidence with few steps and no verification
  if (chainConfidence > 0.9 && stepCount < 3 && !hasVerification) {
    return true;
  }

  // Trigger on very high confidence regardless
  if (chainConfidence > 0.95) {
    return true;
  }

  return false;
}
