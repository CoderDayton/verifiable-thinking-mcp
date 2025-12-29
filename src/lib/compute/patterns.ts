/**
 * Pre-compiled regex patterns for the compute module
 *
 * All patterns are compiled once at module load time, not per-call.
 * This saves ~0.05ms per unique pattern on first call.
 */

import type { NegativeSignal, WeightedSignal, WordProblemMatch } from "./types.ts";

// =============================================================================
// GUARDS: Cheap character-based pre-checks
// =============================================================================

export const GUARDS = {
  hasDigit: (t: string) => /\d/.test(t),
  hasX: (t: string) => /x/i.test(t),
  hasPercent: (t: string) => t.includes("%"),
  hasCaret: (t: string) => t.includes("^") || t.includes("**"),
  hasBracket: (t: string) => t.includes("["),
  hasDollar: (t: string) => t.includes("$"),
  hasExclaim: (t: string) => t.includes("!"),
} as const;

// =============================================================================
// ARITHMETIC PATTERNS
// =============================================================================

export const ARITHMETIC = {
  whatIs: /what\s+is\s+([\d\s+\-*/().]+)/i,
  calculate: /calculate\s+([\d\s+\-*/().]+)/i,
  compute: /compute\s+([\d\s+\-*/().]+)/i,
  evaluate: /evaluate\s+([\d\s+\-*/().]+)/i,
  equalsQuestion: /([\d\s+\-*/().]+)\s*=\s*\?/,
  bareExpression: /^([\d\s+\-*/().]+)$/,
  validChars: /^[\d+\-*/().]+$/,
  invalidPatterns: /\(\)|\+\+|--|\*\*|\/\/|\+-|-\+|\*\/|\/\*/,
} as const;

// =============================================================================
// FORMULA PATTERNS - Tier 1 (Ultra-fast)
// =============================================================================

export const TIER1 = {
  percentage: /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(\d+(?:\.\d+)?)/i,
  factorial: /(\d+)!|factorial\s*(?:of\s*)?(\d+)/i,
  moduloBasic: /(\d+)\s*(?:mod|modulo)\s*(\d+)/i,
  moduloRemainder: /remainder.*?(\d+).*?(?:divided\s+by|\/)\s*(\d+)/i,
  moduloLastDigitGuard: /\^\s*\d+\s*mod\s*10/i,
  prime: /is\s+(\d+)\s+(?:a\s+)?prime/i,
  fibonacci: /(\d+)(?:th|st|nd|rd)\s+fibonacci/i,
} as const;

// =============================================================================
// FORMULA PATTERNS - Tier 2 (Fast)
// =============================================================================

export const TIER2 = {
  sqrt: /(?:\u221A|sqrt\s*\(?\s*|square\s+root\s+(?:of\s+)?)(\d+(?:\.\d+)?)/i,
  power: /(\d+(?:\.\d+)?)\s*(?:\^|\*\*|to\s+the\s+(?:power\s+(?:of\s+)?)?)\s*(\d+(?:\.\d+)?)/i,
  powerLastDigitGuard: /last\s+digit/i,
  powerModGuard: /\^\s*\d+\s*mod/i,
  gcd: /(?:gcd|greatest\s+common\s+divisor).*?(\d+).*?(\d+)/i,
  lcm: /(?:lcm|least\s+common\s+multiple).*?(\d+).*?(\d+)/i,
} as const;

// =============================================================================
// FORMULA PATTERNS - Tier 3 (Medium)
// =============================================================================

export const TIER3 = {
  logBase10: /log[₁1]?[₀0]?\s*\(?\s*(\d+)\s*\)?/gi,
  logNatural: /ln\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/i,
  quadratic: /(\d*)x[\u00B22^2]\s*([+-])\s*(\d+)x\s*([+-])\s*(\d+)\s*=\s*0/i,
  combinationsChoose: /(\d+)\s*(?:choose|C|c)\s*(\d+)/i,
  combinationsFrom:
    /(?:choose|combination|ways\s+to\s+choose)\s+(\d+)\s+(?:from|items?\s+from)\s+(\d+)/i,
  combinationsHowMany: /how\s+many\s+ways\s+(?:to\s+)?choose\s+(\d+)\s+(?:items?\s+)?from\s+(\d+)/i,
  permutationsP: /(\d+)\s*(?:P|p)\s*(\d+)/i,
  permutationsWord: /(?:permutation|arrangement).*?(\d+).*?(\d+)/i,
  lastDigitMod: /(\d+)\s*\^\s*(\d+)\s*mod\s*10|last\s+digit\s+(?:of\s+)?(\d+)\s*\^\s*(\d+)/i,
} as const;

// =============================================================================
// FORMULA PATTERNS - Tier 4 (Expensive)
// =============================================================================

export const TIER4 = {
  pythagorean: [
    /(?:legs?|sides?)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*and\s*(\d+(?:\.\d+)?)[^]*?hypoten/i,
    /triangle[^]*?(\d+(?:\.\d+)?)[^]*?(\d+(?:\.\d+)?)[^]*?hypoten/i,
    /right\s*triangle[^]*?(\d+(?:\.\d+)?)[^,]*?(\d+(?:\.\d+)?)/i,
  ] as const,
  trailingZeros: /trailing\s+zeros?\s+(?:in\s+)?(\d+)[!]?\s*(?:factorial)?/i,
  geometricSeries: [
    /1\s*\+\s*1\/(\d+)\s*\+\s*1\/\d+\s*\+.*(?:sum|infinite|\.\.\.)/i,
    /sum.*1\s*\+\s*1\/(\d+)\s*\+\s*1\/\d+/i,
  ] as const,
  matrixDet:
    /(?:determinant|det).*?\[\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*,\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\s*\]/i,
  compoundInterest:
    /\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:at|with)\s*(\d+(?:\.\d+)?)\s*%\s*(?:annual\s+)?(?:compound\s+)?interest\s*(?:for\s+)?(\d+)\s*years?/i,
} as const;

// =============================================================================
// CALCULUS PATTERNS
// =============================================================================

export const CALCULUS = {
  derivative: [
    /(?:derivative|d\/dx)\s+(?:of\s+)?(.+?)\s+(?:at|evaluated\s+at|when)\s+x\s*=\s*(\d+)/i,
    /(?:derivative|d\/dx)\s+(?:of\s+)?([^.?!]+)/i,
    /(?:differentiate)\s+(.+?)\s+(?:at|evaluated\s+at)\s+x\s*=\s*(\d+)/i,
    /(?:differentiate)\s+([^.?!]+)/i,
  ] as const,
  integral: [
    /(?:integral|integrate)\s+(?:of\s+)?(.+?)\s+from\s+(-?\d+)\s+to\s+(-?\d+)/i,
    /\u222B\s*(.+?)\s*(?:dx)?\s*from\s*(-?\d+)\s*to\s*(-?\d+)/i,
  ] as const,
  polynomial: /([+-]?)(\d*\.?\d*)x(?:\^([+-]?\d+))?|([+-]?)(\d+\.?\d*)/g,
} as const;

// =============================================================================
// WORD PROBLEM PATTERNS
// =============================================================================

export const WORD_PROBLEM_PATTERNS: WordProblemMatch[] = [
  // Multiplication patterns
  {
    pattern: /twice\s+(?:as\s+(?:many|much)\s+(?:as\s+)?)?(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) * 2 : null),
    method: "word_twice",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+times\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) * parseFloat(m[2]) : null),
    method: "word_times",
  },
  {
    pattern: /triple\s+(?:of\s+)?(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) * 3 : null),
    method: "word_triple",
  },
  {
    pattern: /double\s+(?:of\s+)?(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) * 2 : null),
    method: "word_double",
  },

  // Division patterns
  {
    pattern: /half\s+(?:of\s+)?(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) / 2 : null),
    method: "word_half",
  },
  {
    pattern: /(?:one\s+)?third\s+(?:of\s+)?(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) / 3 : null),
    method: "word_third",
  },
  {
    pattern: /(?:one\s+)?quarter\s+(?:of\s+)?(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) / 4 : null),
    method: "word_quarter",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+divided\s+by\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => {
      if (!m[1] || !m[2]) return null;
      const b = parseFloat(m[2]);
      return b !== 0 ? parseFloat(m[1]) / b : null;
    },
    method: "word_divide",
  },

  // Addition patterns
  {
    pattern: /sum\s+of\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) + parseFloat(m[2]) : null),
    method: "word_sum",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+plus\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) + parseFloat(m[2]) : null),
    method: "word_plus",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+added\s+to\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) + parseFloat(m[2]) : null),
    method: "word_add",
  },
  {
    pattern: /total\s+of\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) + parseFloat(m[2]) : null),
    method: "word_total",
  },

  // Subtraction patterns
  {
    pattern: /difference\s+(?:between|of)\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? Math.abs(parseFloat(m[1]) - parseFloat(m[2])) : null),
    method: "word_difference",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+minus\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) - parseFloat(m[2]) : null),
    method: "word_minus",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+less\s+than\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[2]) - parseFloat(m[1]) : null), // Note: reversed!
    method: "word_less_than",
  },
  {
    pattern: /subtract\s+(\d+(?:\.\d+)?)\s+from\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[2]) - parseFloat(m[1]) : null), // Note: reversed!
    method: "word_subtract",
  },

  // Product pattern
  {
    pattern: /product\s+of\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) * parseFloat(m[2]) : null),
    method: "word_product",
  },

  // Quotient pattern
  {
    pattern: /quotient\s+of\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => {
      if (!m[1] || !m[2]) return null;
      const b = parseFloat(m[2]);
      return b !== 0 ? parseFloat(m[1]) / b : null;
    },
    method: "word_quotient",
  },

  // "X more than Y"
  {
    pattern: /(\d+(?:\.\d+)?)\s+more\s+than\s+(\d+(?:\.\d+)?)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[2]) + parseFloat(m[1]) : null),
    method: "word_more_than",
  },

  // Squared / Cubed
  {
    pattern: /(\d+(?:\.\d+)?)\s+squared/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) ** 2 : null),
    method: "word_squared",
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s+cubed/i,
    compute: (m) => (m[1] ? parseFloat(m[1]) ** 3 : null),
    method: "word_cubed",
  },

  // Rate calculations
  {
    pattern:
      /(\d+(?:\.\d+)?)\s+(?:items?|things?|units?)?\s*(?:at|for)\s+\$?(\d+(?:\.\d+)?)\s+(?:each|per|apiece)/i,
    compute: (m) => (m[1] && m[2] ? parseFloat(m[1]) * parseFloat(m[2]) : null),
    method: "word_rate",
  },

  // Average of numbers
  {
    pattern: /average\s+of\s+([\d,\s]+(?:and\s+\d+)?)/i,
    compute: (m) => {
      if (!m[1]) return null;
      const nums = m[1].match(/\d+(?:\.\d+)?/g);
      if (!nums || nums.length === 0) return null;
      const sum = nums.reduce((a, b) => a + parseFloat(b), 0);
      return sum / nums.length;
    },
    method: "word_average",
  },
];

// =============================================================================
// MULTI-STEP WORD PROBLEM PATTERNS
// =============================================================================

export const MULTI_STEP = {
  twice: /(\b[A-Z][a-z]+\b)\s+has\s+twice\s+(?:as\s+many\s+(?:as\s+)?)?(\b[A-Z][a-z]+\b)/gi,
  half: /(\b[A-Z][a-z]+\b)\s+has\s+half\s+(?:as\s+many\s+(?:as\s+)?)?(\b[A-Z][a-z]+\b)/gi,
  more: /(\b[A-Z][a-z]+\b)\s+has\s+(\d+)\s+more\s+than\s+(\b[A-Z][a-z]+\b)/gi,
  less: /(\b[A-Z][a-z]+\b)\s+has\s+(\d+)\s+(?:less|fewer)\s+than\s+(\b[A-Z][a-z]+\b)/gi,
  triple:
    /(\b[A-Z][a-z]+\b)\s+has\s+(?:three|triple)\s+(?:times\s+)?(?:as\s+many\s+(?:as\s+)?)?(\b[A-Z][a-z]+\b)/gi,
  directValue: /(\b[A-Z][a-z]+\b)\s+(?:has|have|had|owns?|bought|got|earned)\s+(\d+(?:\.\d+)?)/gi,
  question: /(?:how\s+many|what)\s+(?:does|do)\s+(\b[A-Z][a-z]+\b)\s+have/i,
} as const;

// =============================================================================
// EXTRACT PATTERNS
// =============================================================================

export const EXTRACT = {
  binaryOp: /\b(\d+(?:\.\d+)?)\s*([+\-*/])\s*(\d+(?:\.\d+)?)\b/g,
} as const;

// =============================================================================
// CONFIDENCE PATTERNS
// =============================================================================

export const CONFIDENCE_POSITIVE: WeightedSignal[] = [
  // Very high confidence (0.9+)
  { pattern: /^[\d\s+\-*/().]+$/, weight: 0.95, name: "pure_arithmetic" },
  { pattern: /what\s+is\s+\d+\s*[+\-*/]\s*\d+/i, weight: 0.95, name: "explicit_arithmetic" },
  { pattern: /calculate\s+\d+/i, weight: 0.9, name: "calculate_number" },
  { pattern: /\d+!/i, weight: 0.9, name: "factorial" },
  { pattern: /fibonacci\s*\d+|(\d+)(?:st|nd|rd|th)\s*fibonacci/i, weight: 0.9, name: "fibonacci" },

  // High confidence (0.7-0.9)
  { pattern: /sqrt|square\s*root|\u221A/i, weight: 0.85, name: "sqrt" },
  { pattern: /log[\u2081\u2080]?\s*\(?\d/i, weight: 0.85, name: "logarithm" },
  { pattern: /\d+\s*\^\s*\d+|\d+\s*\*\*\s*\d+/i, weight: 0.85, name: "power" },
  { pattern: /\d+\s*%\s*of\s*\d+/i, weight: 0.85, name: "percentage" },
  { pattern: /gcd|lcm/i, weight: 0.85, name: "gcd_lcm" },
  { pattern: /\d+\s*mod(ulo)?\s*\d+/i, weight: 0.85, name: "modulo" },
  { pattern: /is\s+\d+\s+(?:a\s+)?prime/i, weight: 0.85, name: "primality" },
  { pattern: /legs?\s+\d+\s+and\s+\d+.*hypoten/i, weight: 0.85, name: "pythagorean" },
  { pattern: /x[\u00B22]\s*[+-]\s*\d+x\s*[+-]\s*\d+\s*=\s*0/i, weight: 0.85, name: "quadratic" },
  { pattern: /trailing\s+zeros?\s+.*\d+[!]/i, weight: 0.85, name: "trailing_zeros" },
  { pattern: /last\s+digit.*\^\d+|\d+\s*\^\s*\d+\s*mod\s*10/i, weight: 0.85, name: "last_digit" },
  // Calculus
  { pattern: /derivative.*x\^?\d|d\/dx/i, weight: 0.85, name: "derivative" },
  { pattern: /integral.*from.*to|integrate.*from/i, weight: 0.85, name: "definite_integral" },
  // Combinatorics
  { pattern: /\d+\s*choose\s*\d+/i, weight: 0.9, name: "combinations" },
  { pattern: /\d+\s*[CP]\s*\d+/i, weight: 0.85, name: "perm_comb" },
  // Matrix
  { pattern: /determinant.*\[\[/i, weight: 0.85, name: "determinant" },
  // Compound interest
  { pattern: /compound\s+interest.*\d+\s*%.*\d+\s*year/i, weight: 0.85, name: "compound_interest" },
  // Math facts (rationality)
  { pattern: /rational\s+or\s+irrational/i, weight: 0.95, name: "rationality" },
  {
    pattern: /is\s+(?:sqrt|√|pi|e|phi)\b.*\b(?:rational|irrational)/i,
    weight: 0.95,
    name: "known_rationality",
  },

  // Logic patterns (modus ponens, modus tollens, syllogism, XOR)
  {
    pattern: /if\s+.+?,?\s+(?:then\s+)?.+?\.\s+.+?\.\s+(?:is\s+)?/i,
    weight: 0.9,
    name: "conditional_logic",
  },
  {
    pattern: /all\s+\w+\s+are\s+\w+.*all\s+\w+\s+are\s+\w+.*valid/i,
    weight: 0.95,
    name: "syllogism",
  },
  { pattern: /exclusive.*both|both.*exclusive/i, weight: 0.9, name: "xor_violation" },
  { pattern: /yes\s+or\s+no.*\?/i, weight: 0.8, name: "yes_no_question" },

  // Probability patterns (independent events, gambler's fallacy)
  {
    pattern: /fair\s+coin.*(?:probability|chance)/i,
    weight: 0.95,
    name: "fair_coin_prob",
  },
  {
    pattern: /independent.*(?:probability|chance)/i,
    weight: 0.9,
    name: "independent_event",
  },
  {
    pattern: /in\s+a\s+row.*(?:probability|chance|what['']?s)/i,
    weight: 0.85,
    name: "streak_probability",
  },
  {
    pattern: /(?:heads|tails)\s*\d+\s*(?:times?)?.*(?:next|probability)/i,
    weight: 0.9,
    name: "coin_streak",
  },

  // Medium confidence (0.5-0.7)
  { pattern: /twice\s+\d+/i, weight: 0.75, name: "twice_number" },
  { pattern: /half\s+(?:of\s+)?\d+/i, weight: 0.75, name: "half_number" },
  { pattern: /\d+\s+(?:plus|minus|times)\s+\d+/i, weight: 0.75, name: "word_operation" },
  { pattern: /sum\s+of\s+\d+\s+and\s+\d+/i, weight: 0.75, name: "sum_of" },
  { pattern: /average\s+of.*\d+/i, weight: 0.7, name: "average" },
  { pattern: /\d+\s+(?:more|less)\s+than\s+\d+/i, weight: 0.7, name: "more_less" },

  // Lower confidence (multi-step word problems)
  { pattern: /[A-Z][a-z]+\s+has\s+twice.*[A-Z][a-z]+/i, weight: 0.6, name: "entity_twice" },
  { pattern: /[A-Z][a-z]+\s+has\s+\d+\s+more\s+than/i, weight: 0.6, name: "entity_more" },
  { pattern: /how\s+many\s+does\s+[A-Z][a-z]+\s+have/i, weight: 0.5, name: "entity_question" },
  { pattern: /total|altogether|combined/i, weight: 0.5, name: "total_question" },

  // Generic signals (low weight)
  { pattern: /calculate/i, weight: 0.4, name: "calculate" },
  { pattern: /compute/i, weight: 0.4, name: "compute" },
  { pattern: /what\s+is/i, weight: 0.3, name: "what_is" },
  { pattern: /\d+\s*[+\-*/]\s*\d+/, weight: 0.5, name: "has_operation" },
];

export const CONFIDENCE_NEGATIVE: NegativeSignal[] = [
  { pattern: /prove/i, penalty: 0.8, name: "prove" },
  { pattern: /why/i, penalty: 0.7, name: "why" },
  { pattern: /explain/i, penalty: 0.7, name: "explain" },
  { pattern: /derive/i, penalty: 0.6, name: "derive" },
  { pattern: /show\s+(that|how|why)/i, penalty: 0.6, name: "show" },
  { pattern: /compare/i, penalty: 0.5, name: "compare" },
  { pattern: /what\s+is\s+the\s+best/i, penalty: 0.5, name: "best" },
  { pattern: /should/i, penalty: 0.4, name: "should" },
  // Removed: rational/irrational penalty - now handled by math facts solver
  { pattern: /true\s+or\s+false/i, penalty: 0.8, name: "boolean" },
  { pattern: /infinite.*(?!sum|series)/i, penalty: 0.5, name: "infinite_general" },
];

// =============================================================================
// LIKELY COMPUTABLE PATTERNS
// =============================================================================

export const LIKELY_COMPUTABLE_POSITIVE = [
  /what\s+is\s+\d/i,
  /what\s+is\s+x[\u00B22^]/i,
  /calculate/i,
  /compute/i,
  /\d+\s*[+\-*/]\s*\d+/,
  /fibonacci/i,
  /factorial|\d+!/,
  /sqrt|square\s*root|\u221A/i,
  /log[\u2081\u2080]?\s*\(?/i,
  /\^|to\s+the\s+power/i,
  /%\s*of\s*\d/i,
  /hypoten/i,
  /quadratic/i,
  /gcd|lcm/i,
  /mod(ulo)?/i,
  /=\s*0.*root/i,
  /larger\s+root|smaller\s+root/i,
  /legs?\s+\d+\s+and\s+\d+/i,
  /is\s+\d+\s+(?:a\s+)?prime/i,
  /twice\s+(?:as\s+)?/i,
  /half\s+(?:of\s+)?/i,
  /double\s+(?:of\s+)?/i,
  /triple\s+(?:of\s+)?/i,
  /sum\s+of\s+\d+\s+and\s+\d+/i,
  /difference\s+(?:between|of)/i,
  /product\s+of\s+\d+\s+and\s+\d+/i,
  /quotient\s+of/i,
  /\d+\s+(?:plus|minus|times)\s+\d+/i,
  /\d+\s+(?:divided\s+by|multiplied\s+by)\s+\d+/i,
  /\d+\s+(?:more|less)\s+than\s+\d+/i,
  /\d+\s+squared|\d+\s+cubed/i,
  /average\s+of/i,
  /third\s+(?:of\s+)?/i,
  /quarter\s+(?:of\s+)?/i,
  /trailing\s+zeros?/i,
  /infinite\s+(?:series|sum)|geometric\s+series/i,
  /last\s+digit/i,
  /derivative|d\/dx|differentiate/i,
  /integral|integrate|\u222B/i,
  /\d+\s*choose\s*\d+/i,
  /combination|permutation/i,
  /ways\s+to\s+choose/i,
  /determinant|det\s*\(/i,
  /compound\s+interest/i,
  // Math facts (rationality questions)
  /rational\s+or\s+irrational/i,
  /is\s+(?:sqrt|√|pi|e|phi)\b.*\b(?:rational|irrational)/i,
  // Logic patterns (modus ponens, modus tollens, syllogism, XOR)
  /if\s+[^,]+,\s*[^.]+\.\s*[^.]+\.\s*is\s+/i, // If X, Y. Z. Is ...?
  /all\s+\w+\s+are\s+\w+.*valid/i,
  /exclusive.*both.*violated/i,
  // Probability patterns (independent events, gambler's fallacy)
  /fair\s+coin.*(?:probability|chance)/i,
  /independent.*(?:probability|chance)/i,
  /in\s+a\s+row.*(?:probability|chance|what['']?s)/i,
] as const;

export const LIKELY_COMPUTABLE_NEGATIVE = [
  /prove/i,
  /why/i,
  /explain/i,
  /derive/i,
  /show\s+(that|how|why)/i,
  /what\s+is\s+the\s+best/i,
  /should/i,
  /compare/i,
  // Removed: /rational\s+or\s+irrational/i - now handled by math facts solver
  /true\s+or\s+false/i,
] as const;

// =============================================================================
// SPAN PATTERNS - For multi-expression extraction (combined regex approach)
// These patterns can identify computable spans within arbitrary text.
// Used by extractAndCompute() for O(n) text scanning.
// =============================================================================

export interface SpanPattern {
  /** Regex to match the span (should capture the full computable expression) */
  regex: RegExp;
  /** Name for debugging/tracking */
  name: string;
}

/**
 * Patterns suitable for span extraction from text.
 * Each pattern should match a complete, self-contained computable expression.
 * Excludes patterns that require question context (e.g., "is X prime?")
 */
export const SPAN_PATTERNS: SpanPattern[] = [
  // Tier 1: Ultra-fast
  { regex: /(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i, name: "percentage" },
  { regex: /(\d+)!/i, name: "factorial_symbol" },
  { regex: /factorial\s*(?:of\s*)?(\d+)/i, name: "factorial_word" },

  // Tier 2: Fast
  { regex: /sqrt\s*\(\s*(\d+(?:\.\d+)?)\s*\)/i, name: "sqrt_parens" },
  { regex: /√(\d+(?:\.\d+)?)/i, name: "sqrt_symbol" },
  { regex: /square\s+root\s+of\s+(\d+(?:\.\d+)?)/i, name: "sqrt_words" },
  { regex: /(\d+(?:\.\d+)?)\s*\^\s*(\d+(?:\.\d+)?)/i, name: "power_caret" },
  { regex: /(\d+(?:\.\d+)?)\s*\*\*\s*(\d+(?:\.\d+)?)/i, name: "power_stars" },
  { regex: /gcd\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i, name: "gcd" },
  { regex: /lcm\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/i, name: "lcm" },

  // Tier 3: Medium
  { regex: /(\d+)\s*choose\s*(\d+)/i, name: "combinations" },
  { regex: /(\d+)\s*C\s*(\d+)/i, name: "combinations_c" },
  { regex: /(\d+)\s*P\s*(\d+)/i, name: "permutations" },
  { regex: /log\s*\(\s*(\d+(?:\.\d+)?)\s*\)/i, name: "log" },
  { regex: /ln\s*\(\s*(\d+(?:\.\d+)?)\s*\)/i, name: "ln" },

  // Tier 4: Expensive
  { regex: /det\s*\(\s*\[\[[\d,\s\-[\]]+\]\]\s*\)/i, name: "determinant" },
  { regex: /determinant\s+of\s+\[\[[\d,\s\-[\]]+\]\]/i, name: "determinant_of" },

  // Calculus
  {
    regex: /derivative\s+of\s+([x\d\s+\-*^]+)\s+at\s+x\s*=\s*(\d+)/i,
    name: "derivative_at",
  },
  {
    regex: /d\/dx\s*\(\s*([x\d\s+\-*^]+)\s*\)\s*at\s+x\s*=\s*(\d+)/i,
    name: "derivative_dx_at",
  },
  {
    regex: /integrate\s+([x\d\s+\-*^]+)\s+from\s+(-?\d+)\s+to\s+(-?\d+)/i,
    name: "integral_from_to",
  },
  {
    regex: /integral\s+of\s+([x\d\s+\-*^]+)\s+from\s+(-?\d+)\s+to\s+(-?\d+)/i,
    name: "integral_of_from_to",
  },
];

/**
 * Build combined regex for O(n) scanning.
 * Uses alternation which V8 optimizes into an efficient automaton.
 */
export function buildCombinedSpanRegex(): RegExp {
  const combined = SPAN_PATTERNS.map((p) => `(?:${p.regex.source})`).join("|");
  return new RegExp(combined, "gi");
}

/** Pre-built combined regex for span extraction */
export const COMBINED_SPAN_REGEX = buildCombinedSpanRegex();
