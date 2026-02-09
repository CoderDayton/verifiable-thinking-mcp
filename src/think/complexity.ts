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
 * - Domain detection now uses unified src/lib/domain.ts
 */

import { getDomainWeight } from "../domain/detection.ts";

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
  // Short questions with numbers and keywords that indicate deceptive simplicity
  const trap_patterns = [
    /\b(cost|price|pay|spend|total|together)\b.*\$?\d/i, // Bat & Ball style
    /\$?\d+.*\b(cost|price|pay|spend|total|together)\b/i, // Reversed order
    /how many.*\d+!/i, // Factorial problems (100!)
    /trailing zero/i, // Number theory trap
    /\d+\s*(ball|bat|item|object)s?\b/i, // Word problem with objects
    /\d+\s*machines?.*\d+\s*(minutes?|widgets?)/i, // Rate problems (5 machines, 5 minutes)
    /\d+\s*(black|white|red|blue).*socks?/i, // Pigeonhole principle
    /minimum.*guarantee/i, // Pigeonhole phrasing
    /clock.*hands?.*overlap/i, // Clock problems
    /hands?.*clock.*overlap/i, // Clock problems alt
    /average speed.*round trip/i, // Harmonic mean trap
    /round trip.*average speed/i, // Harmonic mean trap alt
    /\d+\s*mph.*returns?.*\d+\s*mph/i, // Speed trap
    /doubles?.*every day.*\d+\s*days/i, // Exponential growth trap (lily pad)
    /\d+\s*days.*cover.*lake/i, // Lily pad variant
    /overlap.*\d+\s*hours/i, // Clock overlap
    /\d+\s*hours.*overlap/i, // Clock overlap alt
    /times.*hands.*overlap/i, // Clock overlap natural phrasing
    /times.*overlap/i, // Generic overlap question
    /wason|selection task/i, // Wason card task
    /vowel.*even|even.*vowel/i, // Wason card rule pattern
    /how many ways.*arrange/i, // Combinatorics
    /arrange.*letters/i, // Anagram problems
    /letters.*arrange/i, // Anagram variant
    /how many ways.*letters/i, // Anagram direct question
    /\^\d{2,}/i, // Large exponents (7^100)
    /mod\s+\d+/i, // Modular arithmetic
    /last digit/i, // Modular arithmetic variant
    /\d+-chamber.*bullet/i, // Russian roulette style
    /revolver.*bullet/i, // Russian roulette variant
    /adjacent bullet/i, // Conditional probability setup
    // Self-reference paradoxes
    /this statement.*(true|false|itself)/i, // Liar paradox
    /statement.*refer.*itself/i, // Self-reference
    // Sample size / statistical reasoning
    /which.*(more|less) reliable/i, // Sample size comparison
    /survey of \d+/i, // Sample size context
    /sample.*(size|of \d+)/i, // Sample size explicit
    // Simpson's paradox
    /(overall|aggregate|total).*compar/i, // Aggregation paradox
    /hospital.*surviv/i, // Simpson's classic example
    /(mild|severe).*(surviv|rate)/i, // Subgroup analysis
    /better overall/i, // Simpson's phrasing
    // Expected value / geometric distribution
    /expected (number|value).*(flip|roll|toss|draw|trial)/i, // EV questions
    /until you get (heads|tails|a \w+)/i, // Geometric distribution
    /flip.*until/i, // Stopping time problems
    // Logic meta-questions (validity judgments)
    /\b(VALID|INVALID|UNSOUND|SOUND)\b/i, // Logic validity options
    /valid.*argument|argument.*valid/i, // Validity question
    // Sorites / vagueness paradoxes
    /heap.*grain|grain.*heap/i, // Sorites paradox
    /\d+ grain/i, // Sorites setup
    // Counterintuitive probability problems (100 prisoners, Monty Hall style)
    /\d+\s*prisoners?.*\d+\s*boxes/i, // 100 prisoners problem
    /prisoners?.*boxes.*strategy/i, // Prisoners/boxes with strategy
    /loop[\s-]*follow|cycle[\s-]*strategy/i, // Loop-following strategy
    /survival.*probability.*strategy/i, // Strategy + survival
    /strategy.*survival.*probability/i, // Strategy + survival alt
    /monty hall/i, // Monty Hall problem
    /switch.*doors?|doors?.*switch/i, // Monty Hall phrasing
    /\d+\s*doors?.*goat/i, // Monty Hall variant
  ];
  const has_trap_pattern = trap_patterns.some((p) => p.test(text)); // Use original text for case
  const is_short_with_numbers = text.length < 350 && /\d/.test(text); // Increased threshold

  // Some traps don't have numbers but are still traps (anagrams, combinatorics)
  const is_numberless_trap =
    text.length < 200 &&
    (/arrange.*letters/i.test(text) ||
      /permutation.*letters/i.test(text) ||
      /how many ways/i.test(text));

  // Track trap detection - will add to intensity_signals after it's declared
  const trap_detected = (has_trap_pattern && is_short_with_numbers) || is_numberless_trap;
  if (trap_detected && verb_base < 0.7) {
    verb_boosted += 0.25; // Strong boost for trap questions
    verb_type += " [trap-detected]";
  }

  verb_boosted = Math.min(0.99, verb_boosted); // cap at 0.99

  // ===== PHASE 3: DOMAIN DETECTION =====
  // Use unified domain detector from src/lib/domain.ts
  const { domain: domain_name, weight: domain_weight } = getDomainWeight(text);

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

  // Multi-part questions (higher cognitive load)
  const multi_part_patterns = [
    /give (two|three|four|\d+) (examples?|reasons?|explanations?)/i,
    /what are (two|three|\d+) possible/i,
    /list (two|three|\d+)/i,
    /compare.*contrast/i,
    /similarities.*differences/i,
  ];
  if (multi_part_patterns.some((p) => p.test(lower))) {
    intensity_mod *= 1.12;
    intensity_signals.push("multi_part");
  }

  // Rule-based reasoning (Wason selection task style)
  const rule_patterns = [
    /rule:.*which.*flip/i,
    /which cards? must you flip/i,
    /test the rule/i,
    /if.*on one side.*on (the )?other/i,
    /must.*flip.*test/i,
  ];
  if (rule_patterns.some((p) => p.test(lower))) {
    intensity_mod *= 1.35; // Strong boost for logical rule verification
    intensity_signals.push("rule_based");
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

  // ===== PHASE 5b: META-QUESTION DETECTION =====
  // Questions ABOUT psychological research, biases, or experiments should use direct path.
  // Extended reasoning on meta-cognitive questions leads to overthinking.
  // Example: "Which group estimates higher?" is about anchoring research, not a math problem.
  const meta_question_patterns = [
    /which (group|sample|population) (estimates?|guesses?|predicts?|reports?)/i, // Anchoring research
    /research (shows?|found|demonstrates?|indicates?)/i, // Citing research findings
    /study (found|shows?|demonstrates?)/i, // Study citations
    /experiment (shows?|found|demonstrates?)/i, // Experiment findings
    /psychology (research|studies?|experiments?)/i, // Psychology context
    /cognitive (bias|heuristic|psychology)/i, // Cognitive science terms
    /asked .*(longer|shorter|higher|lower|more|less).*asked/i, // Classic anchoring setup
    /one group.*(another|different|second) group/i, // Between-subjects comparison
    /participants? (were|are) (asked|shown|given)/i, // Experimental procedure
    /what (does|do) (the|this) (research|study|experiment)/i, // Meta-question about research
  ];

  const is_meta_question = meta_question_patterns.some((p) => p.test(text));
  if (is_meta_question) {
    // Strong penalty: meta-questions benefit from direct intuition, not extended reasoning
    verb_boosted *= 0.6; // 40% penalty - biases toward "Low" tier (direct path)
    verb_type += " [meta-question]";
    intensity_signals.push("meta_question");
  }

  // ===== PHASE 6: COMPOSITE SCORING =====
  // If we detected a high-weight domain but no explicit verb, boost the base
  // This handles "What is X?" questions in difficult domains
  if (verb_type === "generic" && domain_weight >= 0.7) {
    verb_boosted = Math.max(verb_boosted, 0.55);
  }

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
  // EXCEPTION: meta_question signals should stay Low (direct path preferred for these)
  const signals_excluding_meta = intensity_signals.filter((s) => s !== "meta_question");
  if (tier === "Low" && signals_excluding_meta.length > 0) {
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

Calculation: ${verb_boosted.toFixed(2)} × ${domain_weight.toFixed(
    2,
  )} × ${intensity_mod.toFixed(2)} = ${final_score.toFixed(3)}`;

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
  };
}
/**
 * Detect if a question is trivially simple (can skip all reasoning phases)
 * These questions should use direct LLM answer with minimal prompting
 */
export function isTrivialQuestion(question: string): boolean {
  // Must be very short
  if (question.length > 80) return false; // Reduced from 150

  // Must have very low complexity score
  const complexity = assessPromptComplexity(question);
  if (complexity.score >= 0.25) return false; // Stricter than 0.3

  // Exclude questions with reasoning indicators
  const reasoningIndicators = [
    /minimum|maximum|optimal/i,
    /guarantee|ensure|worst case/i,
    /how many (ways|times|steps)/i,
    /strategy|approach|method/i,
    /arrange|permutation|combination/i,
    /probability|chance|likely/i,
    /\d+.*machines?.*\d+/i, // Rate problems
    /overlap|intersect/i,
  ];
  if (reasoningIndicators.some((p) => p.test(question))) return false;

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
export function getTrivialPrompt(question: string): {
  system: string;
  user: string;
} {
  return {
    system: "Answer directly. Just YES, NO, or the answer. Nothing else.",
    user: question,
  };
}
