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
      prompts: {
        main: trivialPrompt,
      },
    };
  }

  // === LOW: Direct answer with standard prompt ===
  if (tier === "Low") {
    return {
      path: "direct",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      isExplanatory: explanatory,
      metaDomain,
      shouldSpotCheck: false, // Low complexity doesn't need spot-check
      prompts: {
        main: explanatory ? getExplanatoryPrompts() : getStandardPrompts("baseline"),
      },
    };
  }

  // === MODERATE+: Reasoning prompt (step-by-step) or explanatory (domain-aware) ===
  // All higher tiers (Moderate, High, Very Hard, Almost Impossible) use reasoning
  return {
    path: "reasoning",
    tier,
    score: complexity.score,
    verbosity,
    steps: 1,
    isExplanatory: explanatory,
    metaDomain,
    shouldSpotCheck,
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
