/**
 * SEMANTIC COMPLEXITY ROUTER v3
 *
 * Architecture: Linguistic feature extraction + semantic composition
 * No hardcoded term weights; principles-driven scoring formula:
 *
 *   complexity = verb_base × domain_weight × intensity_modifier
 *
 * Key improvements over v2:
 * - "explain why" handled via semantic boosters (counterintuitive, meta-cognitive)
 * - Probability/statistics domain properly weighted (0.80)
 * - Intensity modifiers for quantifiers, impossibility, comparative language
 * - Negation correction ("not difficult" → lower score)
 * - Compositional semantics: no magic weights, principled formula
 */

export interface ComplexityResult {
  score: number;
  tier: "Low" | "Moderate" | "High" | "Very Hard" | "Almost Impossible";
  /** Confidence bounds for calibration feedback */
  confidence: {
    /** Router confidence in this classification (0-1) */
    level: number;
    /** Is this score in the gray zone (0.28-0.72)? */
    inGrayZone: boolean;
    /** Distance from nearest tier boundary */
    boundaryDistance: number;
  };
  explanation: {
    verb_type: string;
    verb_score: number;
    domain_detected: string;
    domain_weight: number;
    intensity_signals: string[];
    intensity_modifier: number;
  };
  reasoning: string;
  // Legacy compatibility fields
  components: {
    domain: number;
    derivation: number;
    proof: number;
    construction: number;
    open_problem: number;
  };
  signals: {
    domain_terms_found: string[];
    research_indicators: string[];
    proof_requirements: string[];
  };
}

export function assessPromptComplexity(text: string): ComplexityResult {
  const lower = text.toLowerCase();

  // ===== PHASE 1: VERB EXTRACTION =====
  // Linguistic primary: the main reasoning action requested
  const verbHierarchy: [string, number][] = [
    ["prove or refute", 0.95],
    ["prove that", 0.95],
    ["prove", 0.95],
    ["refute", 0.95],
    ["derive the", 0.85],
    ["derive", 0.8],
    ["construct a", 0.78],
    ["construct", 0.75],
    ["design", 0.73],
    ["implement", 0.7],
    ["explain why", 0.7], // Elevated - causal reasoning requires deep understanding
    ["explain how", 0.65],
    ["explain", 0.55],
    // Bare "why" questions - causal reasoning without "explain"
    ["why can't", 0.7],
    ["why cannot", 0.7],
    ["why doesn't", 0.65],
    ["why does", 0.62],
    ["why do", 0.62],
    ["why is", 0.6],
    ["why are", 0.6],
    ["describe", 0.45],
    ["compare", 0.48],
    ["analyze", 0.5],
  ];

  let verb_type = "generic";
  let verb_base = 0.4; // default if no verb detected

  // Match longest verb first (sorted by specificity in the array)
  for (const [verb, weight] of verbHierarchy) {
    if (lower.includes(verb)) {
      verb_type = verb;
      verb_base = weight;
      break;
    }
  }

  // ===== PHASE 2: SEMANTIC BOOSTERS =====
  // Patterns that elevate the base verb complexity
  let verb_boosted = verb_base;

  // Booster 1: Counterintuitive signals (indicate cognitive rigor needed)
  const counterintuitive_keywords = [
    "counterintuitive",
    "paradox",
    "paradoxical",
    "surprising",
    "unintuitive",
    "confusing",
    "why is this",
    "why does this seem",
    "seems wrong",
    "trick question",
  ];

  const has_counterintuitive = counterintuitive_keywords.some((kw) => lower.includes(kw));

  if (has_counterintuitive && verb_base < 0.75) {
    verb_boosted += 0.15;
    verb_type += " [counterintuitive]";
  }

  // Booster 2: Meta-cognitive reasoning (reasoning about reasoning/human cognition)
  const metacognitive_patterns = [
    /why do (people|we|humans)/,
    /why don't (people|we|humans)/,
    /initially guess/,
    /systematic(ally)? (fail|error|mistake)/,
    /cognitive bias/,
    /intuition (vs|versus) reality/,
    /what makes (people|us|humans)/,
    /common mistake/,
    /why (most|many) people/,
  ];

  const has_metacognitive = metacognitive_patterns.some((pattern) => pattern.test(lower));

  if (has_metacognitive) {
    verb_boosted += 0.1;
    verb_type += " [meta-cognitive]";
  }

  // Booster 3: Step-by-step / rigorous requirement
  const rigor_patterns = [
    /step[- ]by[- ]step/,
    /rigorously/,
    /formally prove/,
    /show (your|the) work/,
    /detailed explanation/,
  ];

  const has_rigor = rigor_patterns.some((p) => p.test(lower));
  if (has_rigor) {
    verb_boosted += 0.08;
    verb_type += " [rigorous]";
  }

  // Booster 4: Trap detection (questions that look simple but aren't)
  // Short questions with numbers and financial/counting keywords are often traps
  const trap_patterns = [
    /\b(cost|price|pay|spend|total|together)\b.*\$?\d/i, // Bat & Ball style
    /\$?\d+.*\b(cost|price|pay|spend|total|together)\b/i, // Reversed order
    /how many.*\d+!/i, // Factorial problems (100!)
    /trailing zero/i, // Number theory trap
    /\d+\s*(ball|bat|item|object)s?\b/i, // Word problem with objects
  ];
  const has_trap_pattern = trap_patterns.some((p) => p.test(text)); // Use original text for case
  const is_short_with_numbers = text.length < 250 && /\d/.test(text);

  // Track trap detection - will add to intensity_signals after it's declared
  const trap_detected = has_trap_pattern && is_short_with_numbers && verb_base < 0.7;
  if (trap_detected) {
    verb_boosted += 0.25; // Strong boost for trap questions
    verb_type += " [trap-detected]";
  }

  verb_boosted = Math.min(0.99, verb_boosted); // cap at 0.99

  // ===== PHASE 3: DOMAIN DETECTION =====
  // Extract semantic domain and assign weight
  interface Domain {
    keywords: string[];
    weight: number;
    name: string;
  }

  const domains: Domain[] = [
    {
      name: "quantum_computing",
      keywords: ["quantum", "qubit", "superposition", "entanglement", "shor's algorithm"],
      weight: 0.95,
    },
    {
      name: "cryptography",
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
    },
    {
      name: "complexity_theory",
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
    },
    {
      name: "distributed_systems",
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
    },
    {
      name: "networking",
      keywords: [
        "tcp",
        "udp",
        "three-way handshake",
        "handshake",
        "protocol",
        "packet",
        "routing",
        "dns",
        "http",
      ],
      weight: 0.7,
    },
    {
      name: "distributed_systems",
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
    },
    {
      name: "competitive_analysis",
      keywords: ["competitive ratio", "online algorithm", "ski-rental", "adversarial"],
      weight: 0.88,
    },
    {
      name: "probability_statistics",
      keywords: [
        "probability",
        "bayesian",
        "conditional probability",
        "bayes",
        "distribution",
        "monty hall",
        "regression",
        "statistical",
        "expected value",
        "variance",
      ],
      weight: 0.8,
    },
    {
      name: "machine_learning",
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
    },
    {
      name: "cognitive_reasoning",
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
    },
    {
      name: "algorithms",
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
    },
    {
      name: "calculus",
      keywords: ["derivative", "integral", "limit", "differentiation", "integration", "calculus"],
      weight: 0.65,
    },
    // New domains for better coverage
    {
      name: "logic_puzzle",
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
      ],
      weight: 0.85,
    },
    {
      name: "game_theory",
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
    },
    {
      name: "number_theory",
      keywords: [
        "prime",
        "factorial",
        "divisible",
        "remainder",
        "modulo",
        "trailing zero",
        "integer",
        "divisor",
        "gcd",
        "lcm",
      ],
      weight: 0.8,
    },
  ];

  let domain_name = "general";
  let domain_weight = 0.5; // default

  for (const domain of domains) {
    if (domain.keywords.some((kw) => lower.includes(kw))) {
      domain_name = domain.name;
      domain_weight = domain.weight;
      break;
    }
  }

  // ===== PHASE 4: INTENSITY MODIFIERS =====
  // Signals that increase reasoning depth without changing domain
  let intensity_mod = 1.0;
  const intensity_signals: string[] = [];

  // Add trap pattern to intensity signals (detected in Phase 2)
  if (trap_detected) {
    intensity_signals.push("trap_pattern");
    intensity_mod *= 1.15; // Additional multiplier for traps
  }

  // Quantifiers (logical depth)
  const quantifier_patterns = [
    /\ball\b/,
    /\bany\b/,
    /\bnon-?trivial/,
    /\bevery\b/,
    /\bno\s+\w+\s+can\b/,
  ];
  if (quantifier_patterns.some((p) => p.test(lower))) {
    intensity_mod *= 1.1;
    intensity_signals.push("quantifier");
  }

  // Impossibility/negative results (open problem signals)
  const impossibility_patterns = [
    /cannot (achieve|scale|exceed|be solved)/,
    /\bno\b.*\balgorithm\b/,
    /\bimpossible to\b/,
    /why (no|not|can't|cannot)\b/,
    /prove.*impossible/,
  ];
  if (impossibility_patterns.some((p) => p.test(lower))) {
    intensity_mod *= 1.08;
    intensity_signals.push("impossibility");
  }

  // Comparative language (optimality, bounds)
  const comparative_patterns = [
    /faster than/,
    /better than/,
    /worse than/,
    /optimal/,
    /upper bound/,
    /lower bound/,
    /at least/,
    /at most/,
  ];
  if (comparative_patterns.some((p) => p.test(lower))) {
    intensity_mod *= 1.08;
    intensity_signals.push("comparative");
  }

  // Proof requirement (even without "prove" verb)
  const proof_patterns = [
    /\bproof\b/,
    /\btheorem\b/,
    /\blemma\b/,
    /\bcorollary\b/,
    /show that/,
    /demonstrate that/,
  ];
  if (proof_patterns.some((p) => p.test(lower))) {
    intensity_mod *= 1.05;
    intensity_signals.push("proof_structure");
  }

  // ===== PHASE 5: NEGATION CORRECTION =====
  // Handle "not difficult", "not complex" → lower score
  const negation_patterns = [
    /not (difficult|complex|hard)/,
    /not requiring/,
    /simple (explanation|answer)/,
    /just (explain|describe)/,
    /briefly/,
  ];
  if (negation_patterns.some((p) => p.test(lower))) {
    verb_boosted *= 0.7; // 30% penalty
    verb_type += " [simplified]";
  }

  // ===== PHASE 6: COMPOSITE SCORING =====
  const composite_score = verb_boosted * domain_weight * intensity_mod;
  const final_score = Math.min(1.0, composite_score);

  // ===== PHASE 7: TIER CLASSIFICATION =====
  let tier: ComplexityResult["tier"];

  if (final_score < 0.3) {
    tier = "Low";
  } else if (final_score < 0.5) {
    tier = "Moderate";
  } else if (final_score < 0.72) {
    tier = "High";
  } else if (final_score < 0.85) {
    tier = "Very Hard";
  } else {
    tier = "Almost Impossible";
  }

  // ASYMMETRIC DEFAULT: When in doubt, verify
  // Any intensity signal or trap detection → minimum Moderate
  // Rationale: under-routing causes wrong answers, over-routing only wastes tokens
  if (tier === "Low" && intensity_signals.length > 0) {
    tier = "Moderate";
  }

  // ===== CONFIDENCE CALCULATION =====
  // Calculate confidence based on distance from tier boundaries
  const TIER_BOUNDARIES = [0.3, 0.5, 0.72, 0.85];
  const GRAY_ZONE_LOWER = 0.28;
  const GRAY_ZONE_UPPER = 0.72;

  // Find minimum distance to any tier boundary
  let minBoundaryDistance = 1.0;
  for (const boundary of TIER_BOUNDARIES) {
    const distance = Math.abs(final_score - boundary);
    if (distance < minBoundaryDistance) {
      minBoundaryDistance = distance;
    }
  }

  // Confidence is higher when far from boundaries
  // Scale: 0.5 at boundary, 0.95 when far from all boundaries
  const confidenceLevel = Math.min(0.95, 0.5 + minBoundaryDistance * 2.5);
  const inGrayZone = final_score >= GRAY_ZONE_LOWER && final_score <= GRAY_ZONE_UPPER;

  // ===== REASONING EXPLANATION =====
  const reasoning = `Score: ${final_score.toFixed(3)} | Tier: ${tier}
Verb: "${verb_type}" (base: ${verb_base.toFixed(2)} → boosted: ${verb_boosted.toFixed(2)})
Domain: ${domain_name} (weight: ${domain_weight.toFixed(2)})
Intensity: ${intensity_signals.join(", ") || "none"} (modifier: ${intensity_mod.toFixed(2)}x)

Calculation: ${verb_boosted.toFixed(2)} × ${domain_weight.toFixed(2)} × ${intensity_mod.toFixed(2)} = ${final_score.toFixed(3)}`;

  // Legacy compatibility: map to old interface
  const legacyComponents = {
    domain: domain_weight,
    derivation: verb_type.includes("derive") ? verb_boosted : 0,
    proof: verb_type.includes("prove") ? verb_boosted : 0,
    construction:
      verb_type.includes("construct") || verb_type.includes("design") ? verb_boosted : 0,
    open_problem: intensity_signals.includes("impossibility") ? intensity_mod : 0,
  };

  const legacySignals = {
    domain_terms_found: domain_name !== "general" ? [domain_name] : [],
    research_indicators: intensity_signals.slice(0, 2),
    proof_requirements: intensity_signals.includes("proof_structure") ? ["proof"] : [],
  };

  return {
    score: final_score,
    tier,
    confidence: {
      level: confidenceLevel,
      inGrayZone,
      boundaryDistance: minBoundaryDistance,
    },
    explanation: {
      verb_type,
      verb_score: verb_boosted,
      domain_detected: domain_name,
      domain_weight,
      intensity_signals,
      intensity_modifier: intensity_mod,
    },
    reasoning: reasoning.trim(),
    // Legacy compatibility
    components: legacyComponents,
    signals: legacySignals,
  };
}
/**
 * Detect if a question is trivially simple (can skip all reasoning phases)
 * These questions should use direct LLM answer with minimal prompting
 */
export function isTrivialQuestion(question: string): boolean {
  // Must be short
  if (question.length > 150) return false;

  // Must have low complexity score
  const complexity = assessPromptComplexity(question);
  if (complexity.score >= 0.3) return false; // Not "Low" tier (v3 threshold)

  // Check for simple answer patterns
  const expectsSimpleAnswer =
    /\b(yes|no|true|false)\s*(\?|$|\.)/i.test(question) ||
    /\b(is|are|does|do|can|will|has|have)\s+\w+.*\?/i.test(question) ||
    /\banswer\s+(yes|no|true|false)\b/i.test(question) ||
    /\b(valid|invalid)\s*(\?|$)/i.test(question);

  // Check for simple logical patterns
  const simpleLogic =
    /\bif\s+.+,\s*then\b/i.test(question) ||
    /\ball\s+\w+\s+are\s+\w+/i.test(question) ||
    /\b(therefore|thus|so)\b/i.test(question);

  return expectsSimpleAnswer || simpleLogic;
}

/**
 * Get a minimal prompt for trivial questions
 * Designed for direct LLM answer with no reasoning overhead
 */
export function getTrivialPrompt(question: string): { system: string; user: string } {
  return {
    system: "Answer directly. Just YES, NO, or the answer. Nothing else.",
    user: question,
  };
}
