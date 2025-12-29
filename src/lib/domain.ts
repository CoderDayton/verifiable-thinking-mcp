/**
 * Unified Domain Detector
 *
 * Single source of truth for domain detection used by:
 * - Complexity router (think/complexity.ts) → complexity weight
 * - Compute engine (compute/) → solver relevance filtering
 * - Verification (verification.ts) → domain-specific checks
 *
 * Architecture: O(n) keyword matching with precomputed lowercase
 * Returns both granular domain and meta-category for different consumers.
 */

import { type SolverMask, SolverType } from "./compute/classifier.ts";

// =============================================================================
// TYPES
// =============================================================================

/** Granular domain for complexity scoring */
export type GranularDomain =
  | "quantum_computing"
  | "cryptography"
  | "complexity_theory"
  | "distributed_systems"
  | "networking"
  | "competitive_analysis"
  | "paradox"
  | "probability_statistics"
  | "machine_learning"
  | "cognitive_reasoning"
  | "algorithms"
  | "calculus"
  | "linear_algebra"
  | "logic_puzzle"
  | "game_theory"
  | "number_theory"
  | "combinatorics"
  | "constraint_reasoning"
  | "conditional_probability"
  | "lateral_thinking"
  | "rate_problems"
  | "clock_problems"
  | "common_knowledge"
  | "financial"
  | "teaching"
  | "general";

/** Meta-category for compute filtering */
export type MetaDomain = "financial" | "coding" | "scientific" | "educational" | "general";

/** Verification domain (legacy compat) */
export type VerificationDomain = "math" | "logic" | "code" | "general";

/** Full detection result */
export interface DomainResult {
  /** Granular domain name */
  domain: GranularDomain;
  /** Complexity weight (0-1) for router */
  weight: number;
  /** Meta-category for compute filtering */
  meta: MetaDomain;
  /** Verification domain for legacy compat */
  verification: VerificationDomain;
  /** Solver types relevant for this domain */
  relevantSolvers: SolverMask;
}

// =============================================================================
// DOMAIN DEFINITIONS
// =============================================================================

interface DomainDef {
  keywords: string[];
  weight: number;
  meta: MetaDomain;
  verification: VerificationDomain;
  /** Which solver types are relevant (bitmask) */
  solvers: SolverMask;
}

/** All solver types - for educational/general where we want everything */
const ALL_SOLVERS =
  SolverType.ARITHMETIC |
  SolverType.FORMULA_TIER1 |
  SolverType.FORMULA_TIER2 |
  SolverType.FORMULA_TIER3 |
  SolverType.FORMULA_TIER4 |
  SolverType.WORD_PROBLEM |
  SolverType.MULTI_STEP |
  SolverType.CALCULUS |
  SolverType.FACTS |
  SolverType.LOGIC |
  SolverType.PROBABILITY;

/** Basic math only - for general questions */
const BASIC_MATH =
  SolverType.ARITHMETIC | SolverType.FORMULA_TIER1 | SolverType.FORMULA_TIER2 | SolverType.FACTS;

/** Financial computations */
const FINANCIAL_SOLVERS =
  SolverType.ARITHMETIC |
  SolverType.FORMULA_TIER1 | // percentage
  SolverType.FORMULA_TIER4 | // interest
  SolverType.WORD_PROBLEM;

/** Coding-relevant computations */
const CODING_SOLVERS =
  SolverType.ARITHMETIC |
  SolverType.FORMULA_TIER1 | // modulo, factorial
  SolverType.FORMULA_TIER2 | // power, gcd, lcm
  SolverType.FORMULA_TIER3; // log, combinations

/** Scientific computations (all math) */
const SCIENTIFIC_SOLVERS = ALL_SOLVERS;

/** Logic and probability */
const LOGIC_SOLVERS =
  SolverType.LOGIC | SolverType.PROBABILITY | SolverType.FACTS | SolverType.ARITHMETIC;

const DOMAINS: Record<GranularDomain, DomainDef> = {
  // === HIGH COMPLEXITY (0.9+) ===
  quantum_computing: {
    keywords: ["quantum", "qubit", "superposition", "entanglement", "shor's algorithm"],
    weight: 0.95,
    meta: "scientific",
    verification: "math",
    solvers: SCIENTIFIC_SOLVERS,
  },
  cryptography: {
    keywords: [
      "cryptograph",
      "rsa",
      "lattice",
      "zero-knowledge",
      "discrete logarithm",
      "public-key",
      "security reduction",
    ],
    weight: 0.95,
    meta: "coding",
    verification: "math",
    solvers: CODING_SOLVERS,
  },
  common_knowledge: {
    keywords: [
      "blue eyes",
      "blue-eyed",
      "islanders",
      "leave at midnight",
      "know your",
      "common knowledge",
      "induction",
      "eye color",
      "days until",
    ],
    weight: 0.95,
    meta: "educational",
    verification: "logic",
    solvers: ALL_SOLVERS,
  },
  complexity_theory: {
    keywords: [
      "p ≠ np",
      "p vs np",
      "np-complete",
      "np-hard",
      "polynomial-time",
      "exponential time",
      "sat solver",
      "sat instance",
      "halting problem",
      "undecidable",
      "computability",
      "turing machine",
    ],
    weight: 0.9,
    meta: "coding",
    verification: "logic",
    solvers: CODING_SOLVERS,
  },
  distributed_systems: {
    keywords: [
      "lock-free",
      "consensus",
      "distributed",
      "byzantine",
      "memory ordering",
      "cache coherence",
      "two-phase commit",
      "paxos",
      "raft",
    ],
    weight: 0.9,
    meta: "coding",
    verification: "code",
    solvers: CODING_SOLVERS,
  },
  paradox: {
    keywords: [
      "two envelopes",
      "envelope paradox",
      "sleeping beauty",
      "halfers",
      "thirders",
      "monty hall",
      "naive argument",
      "symmetrically",
      "prisoners",
      "loop-following",
      "survival probability",
      "100 boxes",
      "boy born on tuesday",
      "born on",
      "probability both are boys",
      "both children",
      "two children",
      "this statement",
      "self-referential",
      "liar paradox",
      "sorites",
      "heap paradox",
      "grain",
      "simpson",
      "aggregation paradox",
    ],
    weight: 0.92,
    meta: "educational",
    verification: "logic",
    solvers: ALL_SOLVERS,
  },
  logic_puzzle: {
    keywords: [
      "knight",
      "knave",
      "liar",
      "truth-teller",
      "truthteller",
      "syllogism",
      "valid argument",
      "sound argument",
      "premise",
      "conclusion follows",
      "logically",
      "VALID",
      "INVALID",
      "UNSOUND",
      "valid or invalid",
      "sound or unsound",
    ],
    weight: 0.92,
    meta: "educational",
    verification: "logic",
    solvers: LOGIC_SOLVERS,
  },
  game_theory: {
    keywords: [
      "prisoner's dilemma",
      "nash equilibrium",
      "payoff",
      "dominant strategy",
      "zero-sum",
      "minimax",
      "game theory",
    ],
    weight: 0.9,
    meta: "scientific",
    verification: "math",
    solvers: SCIENTIFIC_SOLVERS,
  },
  conditional_probability: {
    keywords: [
      "given that",
      "conditional",
      "revolver",
      "russian roulette",
      "chamber",
      "bullet",
      "envelope",
      "adjacent",
      "spin",
      "fire",
    ],
    weight: 0.9,
    meta: "scientific",
    verification: "math",
    solvers: SolverType.PROBABILITY | SolverType.ARITHMETIC,
  },
  competitive_analysis: {
    keywords: ["competitive ratio", "online algorithm", "ski-rental", "adversarial"],
    weight: 0.88,
    meta: "coding",
    verification: "math",
    solvers: CODING_SOLVERS,
  },

  // === MODERATE-HIGH COMPLEXITY (0.7-0.89) ===
  number_theory: {
    keywords: [
      "prime",
      "factorial",
      "divisible",
      "remainder",
      "modulo",
      "mod ",
      "trailing zero",
      "integer",
      "divisor",
      "gcd",
      "lcm",
      "last digit",
      "^100",
      "^10",
    ],
    weight: 0.85,
    meta: "scientific",
    verification: "math",
    solvers:
      SolverType.FORMULA_TIER1 |
      SolverType.FORMULA_TIER2 |
      SolverType.FORMULA_TIER3 |
      SolverType.ARITHMETIC,
  },
  combinatorics: {
    keywords: [
      "arrange",
      "permutation",
      "combination",
      "ways to",
      "how many ways",
      "choose",
      "select",
      "distribute",
      "partition",
      "letters in",
      "anagram",
      "mississippi",
      "arrange the letters",
    ],
    weight: 0.85,
    meta: "scientific",
    verification: "math",
    solvers: SolverType.FORMULA_TIER3 | SolverType.ARITHMETIC,
  },
  constraint_reasoning: {
    keywords: [
      "minimum number",
      "guarantee",
      "worst case",
      "at least",
      "at most",
      "balance scale",
      "weighing",
      "pigeonhole",
      "must draw",
      "must flip",
    ],
    weight: 0.85,
    meta: "educational",
    verification: "logic",
    solvers: ALL_SOLVERS,
  },
  clock_problems: {
    keywords: ["clock hands", "hour hand", "minute hand", "overlap", "12 hours", "24 hours"],
    weight: 0.85,
    meta: "scientific",
    verification: "math",
    solvers: SolverType.ARITHMETIC | SolverType.FORMULA_TIER1,
  },
  probability_statistics: {
    keywords: [
      "probability",
      "bayesian",
      "conditional probability",
      "bayes",
      "distribution",
      "regression",
      "statistical",
      "expected value",
      "variance",
      "sample size",
      "more reliable",
      "less reliable",
      "survey of",
      "expected number",
      "expected flips",
      "expected rolls",
    ],
    weight: 0.8,
    meta: "scientific",
    verification: "math",
    solvers: SolverType.PROBABILITY | SolverType.ARITHMETIC | SolverType.FORMULA_TIER1,
  },
  lateral_thinking: {
    keywords: ["trick", "lateral", "only enter once", "can only", "how do you", "determine which"],
    weight: 0.8,
    meta: "educational",
    verification: "logic",
    solvers: ALL_SOLVERS,
  },
  machine_learning: {
    keywords: [
      "backpropagation",
      "gradient",
      "neural network",
      "deep learning",
      "optimization",
      "loss function",
      "transformer",
      "attention mechanism",
    ],
    weight: 0.75,
    meta: "coding",
    verification: "math",
    solvers: SCIENTIFIC_SOLVERS,
  },
  cognitive_reasoning: {
    keywords: [
      "cognitive",
      "psychology",
      "logical fallacy",
      "fallacy",
      "inference",
      "heuristic",
      "bias",
    ],
    weight: 0.75,
    meta: "educational",
    verification: "logic",
    solvers: LOGIC_SOLVERS,
  },
  rate_problems: {
    keywords: [
      "machines",
      "widgets",
      "workers",
      "mph",
      "speed",
      "rate",
      "per hour",
      "per minute",
      "round trip",
      "average speed",
    ],
    weight: 0.75,
    meta: "scientific",
    verification: "math",
    solvers: SolverType.WORD_PROBLEM | SolverType.ARITHMETIC | SolverType.FORMULA_TIER1,
  },
  calculus: {
    keywords: [
      "derivative",
      "integral",
      "limit",
      "differentiation",
      "integration",
      "calculus",
      "d/dx",
      "integral of",
      "∫",
    ],
    weight: 0.72,
    meta: "scientific",
    verification: "math",
    solvers:
      SolverType.CALCULUS |
      SolverType.ARITHMETIC |
      SolverType.FORMULA_TIER1 |
      SolverType.FORMULA_TIER2,
  },
  algorithms: {
    keywords: [
      "algorithm",
      "time complexity",
      "space complexity",
      "big-o",
      "recursion",
      "dynamic programming",
      "graph traversal",
    ],
    weight: 0.7,
    meta: "coding",
    verification: "code",
    solvers: CODING_SOLVERS,
  },
  linear_algebra: {
    keywords: [
      "matrix",
      "determinant",
      "eigenvalue",
      "eigenvector",
      "inverse matrix",
      "transpose",
      "linear transformation",
    ],
    weight: 0.7,
    meta: "scientific",
    verification: "math",
    solvers: SolverType.FORMULA_TIER4 | SolverType.ARITHMETIC,
  },
  networking: {
    keywords: ["tcp", "udp", "three-way handshake", "protocol", "packet", "routing", "dns", "http"],
    weight: 0.7,
    meta: "coding",
    verification: "code",
    solvers: BASIC_MATH,
  },

  // === FINANCIAL (special category) ===
  financial: {
    keywords: [
      "interest",
      "compound",
      "investment",
      "roi",
      "return on",
      "savings",
      "loan",
      "mortgage",
      "amortization",
      "apr",
      "apy",
      "stock",
      "portfolio",
      "dividend",
      "inflation",
      "present value",
      "future value",
      "npv",
      "irr",
      "financial advisor",
      "finance",
      "budget",
      "expense",
      "revenue",
      "profit margin",
      "break-even",
    ],
    weight: 0.65,
    meta: "financial",
    verification: "math",
    solvers: FINANCIAL_SOLVERS,
  },

  // === TEACHING/EDUCATIONAL (show all work) ===
  teaching: {
    keywords: [
      "tutor",
      "teacher",
      "student",
      "homework",
      "assignment",
      "lesson",
      "learn",
      "explain",
      "teach",
      "class",
      "course",
      "education",
      "school",
      "university",
      "college",
      "exam",
      "test prep",
      "study",
      "practice problem",
      "exercise",
      "worksheet",
      "step by step",
      "show your work",
      "show work",
      "solve step",
      "walk through",
      "walkthrough",
    ],
    weight: 0.55, // Lower than most domains - should be overridden by specific math domains
    meta: "educational",
    verification: "general",
    solvers: ALL_SOLVERS,
  },

  // === DEFAULT ===
  general: {
    keywords: [],
    weight: 0.5,
    meta: "general",
    verification: "general",
    solvers: BASIC_MATH,
  },
};

// Precompute domain list for iteration (excludes "general" which is fallback)
const DOMAIN_LIST = Object.entries(DOMAINS).filter(([name]) => name !== "general") as [
  GranularDomain,
  DomainDef,
][];

// =============================================================================
// MAIN DETECTION FUNCTION
// =============================================================================

/**
 * Detect domain from text with O(n) complexity.
 * Returns granular domain, meta-category, verification domain, and relevant solvers.
 *
 * @param text - Text to analyze (question, system prompt, or thought)
 * @returns Full domain detection result
 */
export function detectDomainFull(text: string): DomainResult {
  const lower = text.toLowerCase();

  // Find first matching domain (ordered by weight descending in DOMAINS)
  for (const [name, def] of DOMAIN_LIST) {
    if (def.keywords.some((kw) => lower.includes(kw))) {
      return {
        domain: name,
        weight: def.weight,
        meta: def.meta,
        verification: def.verification,
        relevantSolvers: def.solvers,
      };
    }
  }

  // Fallback to general
  const general = DOMAINS.general;
  return {
    domain: "general",
    weight: general.weight,
    meta: general.meta,
    verification: general.verification,
    relevantSolvers: general.solvers,
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Get just the granular domain name (for complexity router)
 */
export function detectGranularDomain(text: string): GranularDomain {
  return detectDomainFull(text).domain;
}

/**
 * Get domain weight for complexity scoring
 */
export function getDomainWeight(text: string): { domain: string; weight: number } {
  const result = detectDomainFull(text);
  return { domain: result.domain, weight: result.weight };
}

/**
 * Get meta-domain for compute filtering
 */
export function detectMetaDomain(text: string): MetaDomain {
  return detectDomainFull(text).meta;
}

/**
 * Get verification domain (legacy compat with verification.ts)
 */
export function detectVerificationDomain(text: string): VerificationDomain {
  return detectDomainFull(text).verification;
}

/**
 * Get relevant solver bitmask for a text's domain
 */
export function getRelevantSolvers(text: string): SolverMask {
  return detectDomainFull(text).relevantSolvers;
}

/**
 * Check if a solver type is relevant for the detected domain
 */
export function isSolverRelevant(text: string, solverType: SolverMask): boolean {
  const relevant = detectDomainFull(text).relevantSolvers;
  return (relevant & solverType) !== 0;
}
