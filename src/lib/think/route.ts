/**
 * Complexity-based routing for reasoning tasks
 *
 * This module encapsulates ALL routing logic that was previously in the benchmark runner.
 * The runner should just call routeQuestion() and follow the instructions.
 */

import { detectMetaDomain } from "../domain.ts";
import {
  assessPromptComplexity,
  type ComplexityResult,
  getTrivialPrompt,
  isTrivialQuestion,
} from "./complexity.ts";
import {
  formatDomainExplanatoryPrompt,
  getDomainSystemPrompt,
  getSystemPrompt,
  getUserPrompt,
  getVerbosity,
  type Verbosity,
} from "./prompts.ts";
import { needsSpotCheck } from "./spot-check.ts";

// =============================================================================
// EXPLANATORY QUESTION DETECTION
// =============================================================================

/**
 * Detect if a question is primarily explanatory/descriptive.
 * These questions benefit from reasoning but NOT from spot-check verification,
 * since verification is designed for factual/numeric answers, not open-ended explanations.
 */
export function isExplanatoryQuestion(question: string): boolean {
  const lower = question.toLowerCase();

  // Primary indicators: explicit explanation requests
  const explanatoryVerbs = [
    /^explain\b/,
    /\bexplain\s+(why|how|what|the|step)/,
    /^describe\b/,
    /\bdescribe\s+(how|what|the)/,
    /^compare\b/,
    /\bcompare\s+(and\s+)?contrast/,
    /^discuss\b/,
    /\bdiscuss\s+(why|how|the)/,
    /^outline\b/,
    /^summarize\b/,
    /\bwhat\s+is\s+the\s+difference/,
    /\bwhat\s+are\s+the\s+differences/,
    /\bwhy\s+is\s+this\s+important/,
    /\bwhy\s+does\s+this\s+matter/,
  ];

  // Check if primary request is explanatory
  const hasExplanatoryVerb = explanatoryVerbs.some((p) => p.test(lower));
  if (!hasExplanatoryVerb) return false;

  // Exclusions: questions that look explanatory but have factual answers
  const factualIndicators = [
    /\bwhat\s+is\s+the\s+(value|answer|result|sum|product|number)\b/,
    /\bhow\s+many\b/,
    /\bhow\s+much\b/,
    /\bcalculate\b/,
    /\bcompute\b/,
    /\bsolve\b/,
    /=\s*\?/, // equation to solve
  ];

  const isFactual = factualIndicators.some((p) => p.test(lower));
  return !isFactual;
}

// =============================================================================
// OVERTHINKING DETECTOR
// =============================================================================

export interface OverthinkingResult {
  /** Whether this question is prone to overthinking */
  prone: boolean;
  /** Why we think this is overthinking-prone */
  reason: string | null;
  /** Recommended action: "direct" to bypass reasoning, null to proceed normally */
  recommendation: "direct" | null;
}

/**
 * Detect questions that are prone to overthinking errors.
 *
 * These are questions where extended step-by-step reasoning can introduce errors
 * that wouldn't occur with direct intuitive answers. Key patterns:
 *
 * 1. **Binary decision questions** with clear setup (SPIN or FIRE, YES or NO)
 * 2. **Conditional probability** with explicit setup (given X happened, what's Y?)
 * 3. **Game theory decisions** with simple payoff structure
 *
 * Evidence: Benchmark showed sota_russian_roulette baseline=FIRE (correct),
 * tool=Spin (wrong). The reasoning path introduced error.
 */
export function detectOverthinking(question: string): OverthinkingResult {
  const lower = question.toLowerCase();
  const length = question.length;

  // Pattern 1: Binary decision with conditional setup
  // "First X happened. Better to A or B?"
  const binaryDecisionPatterns = [
    /better to\s+(\w+)(\s+\w+)?\s+(or|vs\.?)\s+(\w+)/i, // "better to SPIN again or FIRE"
    /should you\s+(\w+)(\s+\w+)?\s+(or|vs\.?)\s+(\w+)/i, // "should you switch doors or stay"
    /\b(spin|fire|switch|stay|fold|call|hit|stand)\s+(again\s+)?(or|vs\.?)\s+(spin|fire|switch|stay|fold|call|hit|stand)\b/i,
    /\b(spin|fire|switch|stay)\b.*\b(or|vs\.?)\b.*\b(spin|fire|switch|stay)\b/i, // Loose match
  ];

  const hasBinaryDecision = binaryDecisionPatterns.some((p) => p.test(lower));

  // Pattern 2: Conditional probability setup
  // "Given X, what is Y?" or "First X happened, then..."
  const conditionalSetupPatterns = [
    /first\s+(trigger|shot|draw|flip|roll).*?(click|empty|miss|heads|tails)/i, // "First trigger: click"
    /given (that|the)\s+\w+/i, // "Given that X"
    /after\s+(seeing|getting|drawing|rolling)\s+\w+/i, // "After seeing X"
    /\w+\s+already\s+(happened|occurred|fired|clicked)/i, // "X already happened"
  ];

  const hasConditionalSetup = conditionalSetupPatterns.some((p) => p.test(lower));

  // Pattern 3: Compact question with numbers (probabilistic setup)
  // Short questions with specific numeric setup are often well-defined
  const isCompactWithNumbers =
    length < 200 && /\d+[-\s]?chamber|\d+\s+bullet|\d+\s+door/i.test(lower);

  // Pattern 4: Game theory keywords
  const gameTheoryPatterns = [
    /revolver|russian roulette/i,
    /monty hall/i,
    /prisoner'?s dilemma/i,
    /\d+\s+doors?.*goat/i,
    /envelope\s+paradox/i,
  ];

  const hasGameTheory = gameTheoryPatterns.some((p) => p.test(lower));

  // Decision: Overthinking-prone if binary decision + conditional setup + compact
  // OR if known game theory problem with binary choice
  if (hasBinaryDecision && hasConditionalSetup && isCompactWithNumbers) {
    return {
      prone: true,
      reason: "binary_decision_with_conditional_probability",
      recommendation: "direct",
    };
  }

  if (hasGameTheory && hasBinaryDecision) {
    return {
      prone: true,
      reason: "game_theory_binary_decision",
      recommendation: "direct",
    };
  }

  return {
    prone: false,
    reason: null,
    recommendation: null,
  };
}

// =============================================================================
// TYPES
// =============================================================================

export type RoutingPath = "trivial" | "direct" | "reasoning";

export interface RouteResult {
  /** Which path to take */
  path: RoutingPath;
  /** Complexity tier for logging */
  tier: ComplexityResult["tier"];
  /** Complexity score (0-1) */
  score: number;
  /** Verbosity level for prompts */
  verbosity: Verbosity;
  /** Number of LLM calls this path requires (always 1) */
  steps: 1;
  /** Whether this is an explanatory question */
  isExplanatory: boolean;
  /** Detected meta-domain (coding, scientific, educational, financial, general) */
  metaDomain: string;
  /** Whether to run spot-check on the answer (High+ complexity with trap patterns) */
  shouldSpotCheck: boolean;
  /** Overthinking detection result */
  overthinking: OverthinkingResult;
  /** Prompts to use */
  prompts: RoutePrompts;
}

export interface RoutePrompts {
  /** Main reasoning/answer prompt */
  main: { system: string; user: string };
}

// =============================================================================
// MAIN ROUTING FUNCTION
// =============================================================================

/**
 * Route a question to the appropriate reasoning path.
 *
 * Returns everything the caller needs to execute the path:
 * - Which path to take (trivial, direct, reasoning)
 * - Pre-built prompts
 *
 * @param question The question/problem to solve
 */
export function routeQuestion(question: string): RouteResult {
  const complexity = assessPromptComplexity(question);
  const trivial = isTrivialQuestion(question);
  const explanatory = isExplanatoryQuestion(question);
  const verbosity = getVerbosity(question);
  const tier = complexity.tier;
  const metaDomain = detectMetaDomain(question);

  // Detect overthinking-prone questions
  const overthinking = detectOverthinking(question);

  // Determine if spot-check should run:
  // - Has structural trap patterns (likely to trigger intuitive but wrong answers)
  // - NOT explanatory (spot-check is for factual answers)
  // - NOT trivial (trivial questions are too simple for traps)
  const spotCheckResult = needsSpotCheck(question);
  const shouldSpotCheck = !trivial && !explanatory && spotCheckResult.required;

  // Domain-aware prompts for explanatory questions (token-light steering)
  const getExplanatoryPrompts = () => ({
    system: getDomainSystemPrompt(metaDomain),
    user: formatDomainExplanatoryPrompt(question, metaDomain),
  });

  // Standard prompts for non-explanatory questions
  const getStandardPrompts = (type: "baseline" | "reasoning") => ({
    system: getSystemPrompt(type, verbosity),
    user: getUserPrompt(type, question, verbosity),
  });

  // === TRIVIAL: Direct answer, minimal prompt ===
  if (trivial) {
    const trivialPrompt = getTrivialPrompt(question);
    return {
      path: "trivial",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      isExplanatory: explanatory,
      metaDomain,
      shouldSpotCheck: false, // Never spot-check trivial
      overthinking,
      prompts: {
        main: trivialPrompt,
      },
    };
  }

  // === TRAP BYPASS: Route to reasoning if trap patterns detected ===
  // Even if tier is Low, some questions have structural traps that need reasoning.
  // Evidence: trap_sunk_cost baseline=NO (correct), tool=YES (wrong) when using direct.
  // The spot-check correctly identifies these but we need reasoning to avoid the trap.
  //
  // EXCEPTION: Meta-questions (questions ABOUT cognitive biases, not triggering them)
  // should NOT get the trap bypass. They describe traps but don't set them.
  const isMetaQuestion = complexity.explanation.intensity_signals.includes("meta_question");
  const hasTrapPattern = !trivial && !explanatory && !isMetaQuestion && spotCheckResult.required;

  // === LOW: Direct answer with standard prompt ===
  // EXCEPT: If trap patterns detected, route to reasoning instead
  if (tier === "Low" && !hasTrapPattern) {
    return {
      path: "direct",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      isExplanatory: explanatory,
      metaDomain,
      shouldSpotCheck: false, // Low complexity doesn't need spot-check
      overthinking,
      prompts: {
        main: explanatory ? getExplanatoryPrompts() : getStandardPrompts("baseline"),
      },
    };
  }

  // === OVERTHINKING BYPASS: Route to direct if overthinking-prone ===
  // Even though tier is Moderate+, some questions do worse with extended reasoning.
  // Evidence: sota_russian_roulette baseline=FIRE (correct), tool=Spin (wrong).
  if (overthinking.prone && overthinking.recommendation === "direct") {
    return {
      path: "direct",
      tier, // Keep original tier for logging
      score: complexity.score,
      verbosity,
      steps: 1,
      isExplanatory: explanatory,
      metaDomain,
      shouldSpotCheck: false, // Direct path skips spot-check
      overthinking,
      prompts: {
        // Use baseline prompt but with a focused nudge
        main: getStandardPrompts("baseline"),
      },
    };
  }

  // === MODERATE/HIGH/TRAP-BOOSTED: Reasoning prompt (step-by-step) ===
  // Includes:
  // - Moderate, High, Almost Impossible tiers (natural routing)
  // - Low tier with trap patterns (boosted to reasoning)
  // Note: Very Hard tier routes to direct (bypass above) unless it has trap patterns
  return {
    path: "reasoning",
    tier,
    score: complexity.score,
    verbosity,
    steps: 1,
    isExplanatory: explanatory,
    metaDomain,
    shouldSpotCheck,
    overthinking,
    prompts: {
      main: explanatory ? getExplanatoryPrompts() : getStandardPrompts("reasoning"),
    },
  };
}

// =============================================================================
// CONVENIENCE: Get complexity info without full routing
// =============================================================================

export interface ComplexityInfo {
  tier: ComplexityResult["tier"];
  score: number;
  trivial: boolean;
  domain: string | null;
  signals: string[];
}

/**
 * Quick complexity assessment without full routing
 */
export function getComplexityInfo(question: string): ComplexityInfo {
  const complexity = assessPromptComplexity(question);
  return {
    tier: complexity.tier,
    score: complexity.score,
    trivial: isTrivialQuestion(question),
    domain: complexity.explanation.domain_detected,
    signals: complexity.explanation.intensity_signals,
  };
}
