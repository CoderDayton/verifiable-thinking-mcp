/**
 * Complexity-based routing for reasoning tasks
 *
 * This module encapsulates ALL routing logic that was previously in the benchmark runner.
 * The runner should just call routeQuestion() and follow the instructions.
 */

import {
  assessPromptComplexity,
  type ComplexityResult,
  getTrivialPrompt,
  isTrivialQuestion,
} from "./complexity.ts";
import { getSystemPrompt, getUserPrompt, getVerbosity, type Verbosity } from "./prompts.ts";

// =============================================================================
// TYPES
// =============================================================================

export type RoutingPath = "trivial" | "direct" | "reasoning" | "reasoning+spot";

export interface RouteResult {
  /** Which path to take */
  path: RoutingPath;
  /** Complexity tier for logging */
  tier: ComplexityResult["tier"];
  /** Complexity score (0-1) */
  score: number;
  /** Verbosity level for prompts */
  verbosity: Verbosity;
  /** Number of LLM calls this path requires */
  steps: number;
  /** Whether this path includes verification */
  hasVerification: boolean;
  /** Prompts to use for each step */
  prompts: RoutePrompts;
}

export interface RoutePrompts {
  /** Step 1: Main reasoning/answer prompt */
  main: { system: string; user: string };
  /** Step 2: Spot-check prompt (only if hasVerification) */
  spotCheck?: { system: string; userTemplate: string };
}

export interface SpotCheckInput {
  question: string;
  proposedAnswer: string;
}

// =============================================================================
// MAIN ROUTING FUNCTION
// =============================================================================

/**
 * Route a question to the appropriate reasoning path.
 *
 * Returns everything the caller needs to execute the path:
 * - Which path to take (trivial, direct, reasoning, reasoning+spot)
 * - Pre-built prompts for each step
 * - Whether verification is included
 *
 * @param question The question/problem to solve
 * @param skipVerify If true, skip verification even for High+ complexity
 */
export function routeQuestion(question: string, skipVerify = false): RouteResult {
  const complexity = assessPromptComplexity(question);
  const trivial = isTrivialQuestion(question);
  const verbosity = getVerbosity(question);
  const tier = complexity.tier;

  // === TRIVIAL: Direct answer, minimal prompt ===
  if (trivial) {
    const trivialPrompt = getTrivialPrompt(question);
    return {
      path: "trivial",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      hasVerification: false,
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
      hasVerification: false,
      prompts: {
        main: {
          system: getSystemPrompt("baseline", verbosity),
          user: getUserPrompt("baseline", question, verbosity),
        },
      },
    };
  }

  // === MODERATE: Reasoning prompt (step-by-step) ===
  if (tier === "Moderate") {
    return {
      path: "reasoning",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      hasVerification: false,
      prompts: {
        main: {
          system: getSystemPrompt("reasoning", verbosity),
          user: getUserPrompt("reasoning", question, verbosity),
        },
      },
    };
  }

  // === HIGH: Reasoning only, UNLESS trap pattern detected ===
  // Verification adds ~75% latency with marginal accuracy gain at this tier
  // Exception: Trap patterns (counterintuitive problems) benefit from verification
  if (tier === "High") {
    const hasTrapPattern = complexity.explanation.intensity_signals.includes("trap_pattern");

    if (hasTrapPattern && !skipVerify) {
      // Trap-detected High tier questions get verification
      // These are counterintuitive problems where LLM might fall into naive trap
      const mainPrompt = {
        system: getSystemPrompt("reasoning", verbosity),
        user: getUserPrompt("reasoning", question, verbosity),
      };
      return {
        path: "reasoning+spot",
        tier,
        score: complexity.score,
        verbosity,
        steps: 2,
        hasVerification: true,
        prompts: {
          main: mainPrompt,
          spotCheck: {
            system:
              "You verify answers concisely. Be especially careful with counterintuitive problems.",
            userTemplate:
              "Q: {{question}}\nProposed answer: {{answer}}\nIs this CORRECT? YES or NO, then 1 sentence why.",
          },
        },
      };
    }

    // Standard High tier: no verification
    return {
      path: "reasoning",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      hasVerification: false,
      prompts: {
        main: {
          system: getSystemPrompt("reasoning", verbosity),
          user: getUserPrompt("reasoning", question, verbosity),
        },
      },
    };
  }

  // === VERY HARD / ALMOST IMPOSSIBLE ===
  // These benefit most from spot-check verification
  const mainPrompt = {
    system: getSystemPrompt("reasoning", verbosity),
    user: getUserPrompt("reasoning", question, verbosity),
  };

  if (skipVerify) {
    // Skip verification - single reasoning call
    return {
      path: "reasoning",
      tier,
      score: complexity.score,
      verbosity,
      steps: 1,
      hasVerification: false,
      prompts: { main: mainPrompt },
    };
  }

  // Include spot-check verification for Very Hard / Almost Impossible
  return {
    path: "reasoning+spot",
    tier,
    score: complexity.score,
    verbosity,
    steps: 2,
    hasVerification: true,
    prompts: {
      main: mainPrompt,
      spotCheck: {
        system: "You verify answers concisely.",
        userTemplate:
          "Q: {{question}}\nProposed answer: {{answer}}\nIs this CORRECT? YES or NO, then 1 sentence why.",
      },
    },
  };
}

/**
 * Build the spot-check prompt from template
 */
export function buildSpotCheckPrompt(template: string, input: SpotCheckInput): string {
  return template
    .replace("{{question}}", input.question)
    .replace("{{answer}}", input.proposedAnswer);
}

/**
 * Parse spot-check response to determine if answer is correct
 */
export function parseSpotCheckResponse(response: string): boolean {
  return /^yes\b/i.test(response.trim());
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
