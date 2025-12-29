/**
 * Confidence scoring for local compute
 * Returns probability (0-1) that local compute will solve the question
 */

import {
  CONFIDENCE_NEGATIVE,
  CONFIDENCE_POSITIVE,
  LIKELY_COMPUTABLE_NEGATIVE,
  LIKELY_COMPUTABLE_POSITIVE,
} from "./patterns.ts";
import type { ComputeConfidence } from "./types.ts";

/**
 * Check if a question is likely computable locally
 * Use this for routing decisions before attempting compute
 */
export function isLikelyComputable(text: string): boolean {
  const lower = text.toLowerCase();

  const hasCompute = LIKELY_COMPUTABLE_POSITIVE.some((p) => p.test(text));
  const hasReasoning = LIKELY_COMPUTABLE_NEGATIVE.some((p) => p.test(lower));

  return hasCompute && !hasReasoning;
}

/**
 * Calculate confidence that a question can be computed locally
 * Returns a score from 0-1 with breakdown of matching signals
 */
export function computeConfidence(text: string): ComputeConfidence {
  const lower = text.toLowerCase();

  // Calculate positive score (max of matching signals)
  const matchedPositive: string[] = [];
  let positiveScore = 0;

  for (const { pattern, weight, name } of CONFIDENCE_POSITIVE) {
    if (pattern.test(text)) {
      matchedPositive.push(name);
      positiveScore = Math.max(positiveScore, weight);
    }
  }

  // Calculate negative penalty (multiplicative)
  const matchedNegative: string[] = [];
  let negativePenalty = 1.0;

  for (const { pattern, penalty, name } of CONFIDENCE_NEGATIVE) {
    if (pattern.test(lower)) {
      matchedNegative.push(name);
      negativePenalty *= 1 - penalty;
    }
  }

  // Final score
  const score = Math.max(0, Math.min(1, positiveScore * (1 - (1 - negativePenalty))));

  // Determine recommendation
  let recommendation: ComputeConfidence["recommendation"];
  if (score >= 0.85) {
    recommendation = "local_only";
  } else if (score >= 0.6) {
    recommendation = "try_local_first";
  } else if (score >= 0.3) {
    recommendation = "try_local";
  } else {
    recommendation = "skip";
  }

  return {
    score,
    signals: {
      positive: matchedPositive,
      negative: matchedNegative,
    },
    recommendation,
  };
}
