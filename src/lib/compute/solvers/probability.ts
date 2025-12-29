/**
 * Probability Solver - Handles simple probability patterns
 *
 * Supports:
 * - Independent events: "fair coin landed heads N times, probability of heads?" → 50%
 * - Gambler's fallacy detection: Previous outcomes don't affect independent events
 * - Hot hand fallacy: Streak doesn't change underlying probability
 * - Birthday paradox: "N people, probability at least 2 share birthday?"
 *
 * O(n) pattern matching - no backtracking, single-pass regex
 *
 * Key mathematical insight (from research):
 * For independent events, P(A_n | A_1 ∩ A_2 ∩ ... ∩ A_{n-1}) = P(A_n)
 * A fair coin has P(heads) = 0.5 regardless of previous outcomes.
 */

import { SolverType } from "../classifier.ts";
import type { ComputeResult, Solver } from "../types.ts";

// =============================================================================
// PATTERNS
// =============================================================================

const PATTERNS = {
  // Fair coin after streak: "fair coin landed heads N times, probability of heads?"
  // Captures: the number of times (optional), "heads" or "tails", asking about next flip
  fairCoinStreak:
    /fair\s+coin.*(?:landed|flipped|come\s+up|gotten?)\s+(?:heads|tails)\s*(\d+)?\s*(?:times?)?\s*(?:in\s+a\s+row)?[^.?]*(?:probability|chance|what['']?s|likely)/i,

  // Independent events with stated probability
  // "independent with 50% success rate" or "each shot is independent with 50%"
  independentEvent:
    /(?:independent|each\s+(?:shot|flip|roll|event)\s+is\s+independent).*?(\d+(?:\.\d+)?)\s*%\s*(?:success|rate|chance|probability)/i,

  // Gambler's fallacy explicit: "due for a win" patterns
  gamblersFallacy: /(?:due\s+for|must\s+(?:be|get)|bound\s+to|has\s+to|overdue)/i,

  // Hot hand patterns: "on a streak" + asking about probability
  hotHand:
    /(?:made|hit|scored|succeeded)\s+(\d+)\s+(?:shots?|times?|in\s+a\s+row).*?(?:probability|chance|what['']?s|likely).*?(?:next|following)/i,

  // Direct probability question for fair coin
  directFairCoin:
    /(?:probability|chance)\s+(?:of\s+)?(?:the\s+)?next\s+(?:flip|toss|coin).*(?:heads|tails)/i,

  // "What's the probability" patterns for independent events
  whatProbability:
    /what['']?s?\s+(?:the\s+)?(?:probability|chance).*(?:next|following)\s+(?:flip|shot|roll|toss)/i,

  // Birthday paradox: "N people in a room, probability at least 2 share birthday"
  birthdayParadox:
    /(\d+)\s*(?:people|persons?|students?|guests?|employees?|members?).*?(?:probability|chance|what['']?s|likely).*?(?:at\s+least\s+(?:two|2)|two\s+or\s+more|same\s+birthday|share\s+(?:a\s+)?birthday)/i,

  // Alternative birthday pattern: "probability that at least 2 of N people share a birthday"
  birthdayParadoxAlt:
    /(?:probability|chance).*?(?:at\s+least\s+(?:two|2)|two\s+or\s+more).*?(\d+)\s*(?:people|persons?|students?|guests?).*?(?:same\s+birthday|share\s+(?:a\s+)?birthday)/i,

  // Birthday pattern starting with "In a room of N people"
  birthdayRoom:
    /(?:in\s+a\s+)?(?:room|group|class|team)\s+(?:of\s+)?(\d+)\s*(?:people|persons?|students?|guests?).*?(?:birthday|born\s+on\s+the\s+same)/i,
} as const;

// =============================================================================
// GUARDS (cheap detection before expensive regex)
// =============================================================================

function hasFairCoin(lower: string): boolean {
  return lower.includes("fair") && lower.includes("coin");
}

function hasIndependent(lower: string): boolean {
  return lower.includes("independent");
}

/**
 * Detect if this is a birthday paradox question
 */
function hasBirthdayContext(lower: string): boolean {
  return (
    lower.includes("birthday") ||
    (lower.includes("share") && lower.includes("born")) ||
    (lower.includes("same day") && lower.includes("people"))
  );
}

/**
 * Detect if this is asking about probability of next event
 * NOT just mentioning "chance" or "%" in context of expected value
 */
function hasProbabilityQuestion(lower: string): boolean {
  // Exclude expected value / decision questions
  if (lower.includes("expected value") || lower.includes("which has higher")) {
    return false;
  }

  return (
    lower.includes("probability") ||
    // "chance" must be about asking probability, not stating odds like "100% chance of $50"
    (lower.includes("chance") && (lower.includes("next") || lower.includes("at least"))) ||
    lower.includes("what's the prob") ||
    lower.includes("what is the prob")
  );
}

function hasStreakContext(lower: string): boolean {
  return (
    lower.includes("in a row") ||
    lower.includes("times") ||
    lower.includes("made") ||
    lower.includes("landed") ||
    lower.includes("flipped")
  );
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Extract stated probability from text (e.g., "50% success rate" → 50)
 */
function extractStatedProbability(text: string): number | null {
  // Look for explicit percentage
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (match?.[1]) {
    return parseFloat(match[1]);
  }

  // Look for "1/2" or "50-50" patterns
  if (/50[\s-]*50|1\/2|one\s+half/i.test(text)) {
    return 50;
  }

  return null;
}

/**
 * Check if question asks about percentage vs decimal
 */
function wantsPercentage(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("percent") ||
    lower.includes("%") ||
    lower.includes("as a percentage") ||
    lower.includes("answer as percent")
  );
}

/**
 * Calculate birthday paradox probability
 * P(at least 2 share) = 1 - P(all different)
 * P(all different) = 365/365 * 364/365 * ... * (365-n+1)/365
 *
 * @param n - Number of people
 * @returns Probability as percentage (0-100)
 */
function birthdayParadoxProbability(n: number): number {
  if (n <= 1) return 0;
  if (n >= 365) return 100;

  // Calculate P(all different) = ∏(365-i)/365 for i=0 to n-1
  let pAllDifferent = 1;
  for (let i = 0; i < n; i++) {
    pAllDifferent *= (365 - i) / 365;
  }

  // P(at least 2 share) = 1 - P(all different)
  return (1 - pAllDifferent) * 100;
}

// =============================================================================
// SOLVER
// =============================================================================

export function tryProbability(text: string): ComputeResult {
  const start = performance.now();
  const lower = text.toLowerCase();

  // Quick exit if no probability-related keywords
  if (!hasProbabilityQuestion(lower) && !hasBirthdayContext(lower)) {
    return { solved: false, confidence: 0 };
  }

  // BIRTHDAY PARADOX: "N people, probability at least 2 share birthday?"
  if (hasBirthdayContext(lower)) {
    let n: number | null = null;

    // Try multiple patterns to extract N
    const match1 = text.match(PATTERNS.birthdayParadox);
    if (match1?.[1]) n = parseInt(match1[1], 10);

    if (n === null) {
      const match2 = text.match(PATTERNS.birthdayParadoxAlt);
      if (match2?.[1]) n = parseInt(match2[1], 10);
    }

    if (n === null) {
      const match3 = text.match(PATTERNS.birthdayRoom);
      if (match3?.[1]) n = parseInt(match3[1], 10);
    }

    if (n !== null && n > 0 && n <= 1000) {
      const probability = birthdayParadoxProbability(n);
      // Round to nearest integer for percentage answers
      // Default to percentage for birthday paradox (common convention)
      const rounded = Math.round(probability);
      // Only return decimal if explicitly asking for decimal/fraction
      const wantsDecimal =
        lower.includes("decimal") || lower.includes("fraction") || lower.includes("0.");
      const result = wantsDecimal ? (probability / 100).toFixed(4) : String(rounded);

      return {
        solved: true,
        result,
        method: "birthday_paradox",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // FAIR COIN: Independent events with known 50% probability
  // "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads?"
  if (hasFairCoin(lower) && hasStreakContext(lower)) {
    const match = text.match(PATTERNS.fairCoinStreak);
    if (match) {
      // Fair coin = 50% regardless of previous outcomes
      const result = wantsPercentage(text) ? "50" : "0.5";
      return {
        solved: true,
        result,
        method: "fair_coin_independence",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }

    // Also catch simpler patterns
    if (PATTERNS.directFairCoin.test(text) || PATTERNS.whatProbability.test(text)) {
      const result = wantsPercentage(text) ? "50" : "0.5";
      return {
        solved: true,
        result,
        method: "fair_coin_direct",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // INDEPENDENT EVENTS WITH STATED PROBABILITY
  // "shots are independent with 50% success rate, what's probability of next shot?"
  if (hasIndependent(lower) && hasProbabilityQuestion(lower)) {
    const statedProb = extractStatedProbability(text);
    if (statedProb !== null) {
      // For independent events, probability stays the same
      const result = wantsPercentage(text) ? String(statedProb) : String(statedProb / 100);
      return {
        solved: true,
        result,
        method: "independent_event",
        confidence: 1.0,
        time_ms: performance.now() - start,
      };
    }
  }

  // HOT HAND: "made 5 shots in a row, assuming independent with 50%..."
  if (hasStreakContext(lower) && hasIndependent(lower)) {
    const statedProb = extractStatedProbability(text);
    if (statedProb !== null) {
      const result = wantsPercentage(text) ? String(statedProb) : String(statedProb / 100);
      return {
        solved: true,
        result,
        method: "hot_hand_independence",
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
  name: "probability",
  description:
    "Independent events, fair coin, gambler's fallacy, hot hand fallacy, birthday paradox",
  types: SolverType.PROBABILITY,
  priority: 12, // After facts and arithmetic, before logic
  solve: (text, _lower) => tryProbability(text),
};
