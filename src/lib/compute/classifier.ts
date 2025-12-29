/**
 * Question Classifier - Fast-path routing via bitmask
 *
 * Runs ONCE per question and returns a bitmask indicating which solver
 * types are likely to match. This allows skipping entire solver categories
 * without running their expensive regex patterns.
 *
 * Performance: ~0.01ms to classify, saves ~0.05ms per skipped solver tier
 */

// =============================================================================
// SOLVER TYPE BITMASK
// =============================================================================

/** Bitmask flags for solver types */
export const SolverType = {
  NONE: 0,
  ARITHMETIC: 1 << 0, // 1
  FORMULA_TIER1: 1 << 1, // 2  - percentage, factorial, modulo, prime, fibonacci
  FORMULA_TIER2: 1 << 2, // 4  - sqrt, power, gcd, lcm
  FORMULA_TIER3: 1 << 3, // 8  - log, quadratic, combinations, permutations, last digit
  FORMULA_TIER4: 1 << 4, // 16 - pythagorean, trailing zeros, series, matrix, interest
  WORD_PROBLEM: 1 << 5, // 32
  MULTI_STEP: 1 << 6, // 64
  CALCULUS: 1 << 7, // 128
  FACTS: 1 << 8, // 256 - known mathematical facts (rationality, etc.)
  LOGIC: 1 << 9, // 512 - propositional logic (modus ponens/tollens, syllogism, XOR)
  PROBABILITY: 1 << 10, // 1024 - independent events, gambler's fallacy
} as const;

/** Combined flags for convenience */
export const SolverGroup = {
  FORMULA_ALL:
    SolverType.FORMULA_TIER1 |
    SolverType.FORMULA_TIER2 |
    SolverType.FORMULA_TIER3 |
    SolverType.FORMULA_TIER4,
  WORD_ALL: SolverType.WORD_PROBLEM | SolverType.MULTI_STEP,
  ALL: 0x7ff, // All solvers (11 bits)
} as const;

export type SolverMask = number;

// =============================================================================
// CLASSIFIER RESULT
// =============================================================================

export interface ClassifierResult {
  /** Bitmask of likely matching solver types */
  mask: SolverMask;
  /** Lowercase version of text (computed once, reused) */
  lower: string;
  /** Quick character presence flags */
  chars: {
    hasDigit: boolean;
    hasPercent: boolean;
    hasCaret: boolean;
    hasBracket: boolean;
    hasDollar: boolean;
    hasExclaim: boolean;
    hasX: boolean;
  };
}

// =============================================================================
// FAST CHARACTER CHECKS (inlined for speed)
// =============================================================================

const DIGIT_RE = /\d/;
const X_RE = /x/i;

// =============================================================================
// CLASSIFIER RULES
// Each rule adds solver types to the mask based on cheap checks
// =============================================================================

interface ClassifierRule {
  /** Quick guard - if false, skip this rule */
  guard: (text: string, lower: string, chars: ClassifierResult["chars"]) => boolean;
  /** Solver types to add if guard passes */
  types: SolverMask;
}

const CLASSIFIER_RULES: ClassifierRule[] = [
  // ARITHMETIC: needs digits and operators
  {
    guard: (text, _lower, chars) =>
      chars.hasDigit && /[+\-*/]/.test(text) && !/[a-df-wyzA-DF-WYZ]/.test(text),
    types: SolverType.ARITHMETIC,
  },

  // TIER 1: percentage
  {
    guard: (_text, _lower, chars) => chars.hasPercent && chars.hasDigit,
    types: SolverType.FORMULA_TIER1,
  },

  // TIER 1: factorial
  {
    guard: (_text, lower, chars) =>
      (chars.hasExclaim && chars.hasDigit) || lower.includes("factorial"),
    types: SolverType.FORMULA_TIER1,
  },

  // TIER 1: modulo
  {
    guard: (_text, lower, _chars) => lower.includes("mod") || lower.includes("remainder"),
    types: SolverType.FORMULA_TIER1,
  },

  // TIER 1: prime
  {
    guard: (_text, lower, _chars) => lower.includes("prime"),
    types: SolverType.FORMULA_TIER1,
  },

  // TIER 1: fibonacci
  {
    guard: (_text, lower, _chars) => lower.includes("fibonacci"),
    types: SolverType.FORMULA_TIER1,
  },

  // TIER 2: sqrt
  {
    guard: (text, lower, _chars) =>
      lower.includes("sqrt") || text.includes("\u221A") || lower.includes("root"),
    types: SolverType.FORMULA_TIER2,
  },

  // TIER 2: power
  {
    guard: (_text, lower, chars) => chars.hasCaret || lower.includes("power"),
    types: SolverType.FORMULA_TIER2,
  },

  // TIER 2: gcd/lcm
  {
    guard: (_text, lower, _chars) =>
      lower.includes("gcd") ||
      lower.includes("lcm") ||
      lower.includes("greatest common") ||
      lower.includes("least common"),
    types: SolverType.FORMULA_TIER2,
  },

  // TIER 3: logarithm
  {
    guard: (_text, lower, _chars) => lower.includes("log") || lower.includes("ln"),
    types: SolverType.FORMULA_TIER3,
  },

  // TIER 3: quadratic (x² or x^2 with = 0)
  {
    guard: (text, _lower, chars) => chars.hasX && text.includes("0") && /x[\u00B22^]/.test(text),
    types: SolverType.FORMULA_TIER3,
  },

  // TIER 3: combinations/permutations
  {
    guard: (text, lower, _chars) =>
      lower.includes("choose") ||
      / c /i.test(text) ||
      / p /i.test(text) ||
      lower.includes("combination") ||
      lower.includes("permutation") ||
      lower.includes("arrangement"),
    types: SolverType.FORMULA_TIER3,
  },

  // TIER 3: last digit
  {
    guard: (text, lower, _chars) => lower.includes("last digit") || /mod\s*10/i.test(text),
    types: SolverType.FORMULA_TIER3,
  },

  // TIER 4: pythagorean
  {
    guard: (_text, lower, _chars) => lower.includes("hypoten"),
    types: SolverType.FORMULA_TIER4,
  },

  // TIER 4: trailing zeros
  {
    guard: (_text, lower, _chars) => lower.includes("trailing"),
    types: SolverType.FORMULA_TIER4,
  },

  // TIER 4: geometric series
  {
    guard: (text, lower, _chars) =>
      lower.includes("infinite") ||
      lower.includes("series") ||
      text.includes("...") ||
      (lower.includes("sum") && /1\s*\+\s*1\/\d/.test(text)),
    types: SolverType.FORMULA_TIER4,
  },

  // TIER 4: matrix determinant
  {
    guard: (_text, lower, chars) =>
      chars.hasBracket && (lower.includes("det") || lower.includes("determinant")),
    types: SolverType.FORMULA_TIER4,
  },

  // TIER 4: compound interest
  {
    guard: (_text, lower, chars) =>
      (chars.hasDollar || lower.includes("interest")) && lower.includes("year"),
    types: SolverType.FORMULA_TIER4,
  },

  // WORD PROBLEMS: multiplication words
  {
    guard: (_text, lower, _chars) =>
      lower.includes("twice") ||
      lower.includes("double") ||
      lower.includes("triple") ||
      lower.includes("times"),
    types: SolverType.WORD_PROBLEM,
  },

  // WORD PROBLEMS: division words
  {
    guard: (_text, lower, _chars) =>
      lower.includes("half") ||
      lower.includes("third") ||
      lower.includes("quarter") ||
      lower.includes("divided"),
    types: SolverType.WORD_PROBLEM,
  },

  // WORD PROBLEMS: addition/subtraction words
  {
    guard: (_text, lower, _chars) =>
      lower.includes("sum of") ||
      lower.includes("plus") ||
      lower.includes("minus") ||
      lower.includes("difference") ||
      lower.includes("more than") ||
      lower.includes("less than"),
    types: SolverType.WORD_PROBLEM,
  },

  // WORD PROBLEMS: other patterns
  {
    guard: (_text, lower, _chars) =>
      lower.includes("product of") ||
      lower.includes("quotient") ||
      lower.includes("squared") ||
      lower.includes("cubed") ||
      lower.includes("average of"),
    types: SolverType.WORD_PROBLEM,
  },

  // MULTI-STEP: entity patterns (Name has X)
  {
    guard: (text, lower, _chars) =>
      /[A-Z][a-z]+\s+has/.test(text) &&
      (lower.includes("twice") ||
        lower.includes("half") ||
        lower.includes("more than") ||
        lower.includes("less than") ||
        lower.includes("fewer")),
    types: SolverType.MULTI_STEP,
  },

  // MULTI-STEP: question about entity
  {
    guard: (text, _lower, _chars) => /how\s+many\s+does\s+[A-Z]/i.test(text),
    types: SolverType.MULTI_STEP,
  },

  // CALCULUS: derivative
  {
    guard: (_text, lower, _chars) =>
      lower.includes("derivative") || lower.includes("d/dx") || lower.includes("differentiate"),
    types: SolverType.CALCULUS,
  },

  // CALCULUS: integral
  {
    guard: (text, lower, _chars) =>
      lower.includes("integral") || lower.includes("integrate") || text.includes("\u222B"),
    types: SolverType.CALCULUS,
  },

  // FACTS: rationality questions (sqrt(2) rational/irrational, pi rational, etc.)
  {
    guard: (_text, lower, _chars) => lower.includes("rational") || lower.includes("irrational"),
    types: SolverType.FACTS,
  },

  // LOGIC: modus ponens/tollens patterns (If P then Q...)
  {
    guard: (_text, lower, _chars) =>
      lower.includes("if ") &&
      (lower.includes("yes or no") || lower.includes("is it") || lower.includes("is the")),
    types: SolverType.LOGIC,
  },

  // LOGIC: syllogism (All A are B...)
  {
    guard: (_text, lower, _chars) =>
      lower.includes("all ") && lower.includes(" are ") && lower.includes("valid"),
    types: SolverType.LOGIC,
  },

  // LOGIC: XOR violation (exclusive or + both)
  {
    guard: (_text, lower, _chars) =>
      lower.includes(" or ") && lower.includes("exclusive") && lower.includes("both"),
    types: SolverType.LOGIC,
  },

  // PROBABILITY: Fair coin with streak context
  {
    guard: (_text, lower, _chars) =>
      lower.includes("fair") &&
      lower.includes("coin") &&
      (lower.includes("probability") || lower.includes("chance")),
    types: SolverType.PROBABILITY,
  },

  // PROBABILITY: Independent events with probability question
  {
    guard: (_text, lower, _chars) =>
      lower.includes("independent") && (lower.includes("probability") || lower.includes("chance")),
    types: SolverType.PROBABILITY,
  },

  // PROBABILITY: Streak + probability question (hot hand, gambler's fallacy)
  {
    guard: (_text, lower, _chars) =>
      lower.includes("in a row") &&
      (lower.includes("probability") || lower.includes("chance") || lower.includes("what's")),
    types: SolverType.PROBABILITY,
  },

  // PROBABILITY: Birthday paradox (people + share birthday)
  {
    guard: (_text, lower, _chars) =>
      lower.includes("birthday") &&
      (lower.includes("share") || lower.includes("same")) &&
      (lower.includes("people") ||
        lower.includes("person") ||
        lower.includes("room") ||
        lower.includes("group")),
    types: SolverType.PROBABILITY,
  },

  // CRT: Bat and ball style (X costs $Y more than Z)
  {
    guard: (_text, lower, chars) =>
      chars.hasDollar && lower.includes("more than") && lower.includes("cost"),
    types: SolverType.WORD_PROBLEM,
  },

  // CRT: Lily pad doubling (doubles + days + half/cover)
  {
    guard: (_text, lower, _chars) =>
      lower.includes("double") &&
      lower.includes("day") &&
      (lower.includes("half") || lower.includes("cover")),
    types: SolverType.WORD_PROBLEM,
  },

  // CRT: Widget/machine (machines + minutes + widgets)
  {
    guard: (_text, lower, _chars) =>
      lower.includes("machine") && lower.includes("minute") && lower.includes("widget"),
    types: SolverType.WORD_PROBLEM,
  },

  // CRT: Harmonic mean (speed + returns/back + average)
  {
    guard: (_text, lower, _chars) =>
      (lower.includes("mph") || lower.includes("km/h")) &&
      (lower.includes("return") || lower.includes("back")) &&
      lower.includes("average"),
    types: SolverType.WORD_PROBLEM,
  },

  // CRT: Catch-up problem (m/s or mph + head start/ahead)
  {
    guard: (_text, lower, _chars) =>
      (lower.includes("m/s") || lower.includes("mph")) &&
      (lower.includes("head start") || lower.includes("ahead")),
    types: SolverType.WORD_PROBLEM,
  },

  // CRT: Sock drawer / pigeonhole (socks/balls + minimum + guarantee + pair/matching)
  {
    guard: (_text, lower, _chars) =>
      (lower.includes("sock") || lower.includes("ball")) &&
      (lower.includes("minimum") || lower.includes("least")) &&
      lower.includes("guarantee") &&
      (lower.includes("pair") || lower.includes("matching")),
    types: SolverType.WORD_PROBLEM,
  },
];

// =============================================================================
// MAIN CLASSIFIER FUNCTION
// =============================================================================

/**
 * Classify a question to determine which solvers might match.
 * Runs once per question, returns bitmask + precomputed values.
 *
 * @param text - The question text
 * @returns ClassifierResult with mask and precomputed values
 */
export function classifyQuestion(text: string): ClassifierResult {
  const lower = text.toLowerCase();

  // Precompute character flags (very fast)
  const chars = {
    hasDigit: DIGIT_RE.test(text),
    hasPercent: text.includes("%"),
    hasCaret: text.includes("^") || text.includes("**"),
    hasBracket: text.includes("["),
    hasDollar: text.includes("$"),
    hasExclaim: text.includes("!"),
    hasX: X_RE.test(text),
  };

  // Build mask by checking all rules
  let mask: SolverMask = 0;

  for (const rule of CLASSIFIER_RULES) {
    if (rule.guard(text, lower, chars)) {
      mask |= rule.types;
    }
  }

  // If no specific matches, try arithmetic as fallback (bare expressions)
  if (mask === 0 && chars.hasDigit) {
    mask = SolverType.ARITHMETIC;
  }

  return { mask, lower, chars };
}

/**
 * Check if a specific solver type should be tried
 */
export function shouldTrySolver(mask: SolverMask, solverType: number): boolean {
  return (mask & solverType) !== 0;
}

/**
 * Get human-readable list of solver types in mask
 */
export function describeMask(mask: SolverMask): string[] {
  const types: string[] = [];
  if (mask & SolverType.ARITHMETIC) types.push("arithmetic");
  if (mask & SolverType.FORMULA_TIER1) types.push("formula_tier1");
  if (mask & SolverType.FORMULA_TIER2) types.push("formula_tier2");
  if (mask & SolverType.FORMULA_TIER3) types.push("formula_tier3");
  if (mask & SolverType.FORMULA_TIER4) types.push("formula_tier4");
  if (mask & SolverType.WORD_PROBLEM) types.push("word_problem");
  if (mask & SolverType.MULTI_STEP) types.push("multi_step");
  if (mask & SolverType.CALCULUS) types.push("calculus");
  if (mask & SolverType.FACTS) types.push("facts");
  if (mask & SolverType.LOGIC) types.push("logic");
  if (mask & SolverType.PROBABILITY) types.push("probability");
  return types;
}
