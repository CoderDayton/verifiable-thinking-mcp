/**
 * Confidence Drift Detection (CDD)
 *
 * Novel technique: Analyzes confidence TRAJECTORY as a meta-signal for reasoning quality.
 *
 * Key insight: LLMs often start confident, confidence DROPS mid-chain when hitting
 * difficulty, then "recovers" at the end without explicitly addressing the uncertainty.
 * This V-shaped pattern without revision indicates "pushed through" uncertainty.
 *
 * Design principles:
 * 1. O(n) single-pass analysis of confidence array
 * 2. Detects structural patterns in confidence trajectory
 * 3. Flags unresolved doubt (recovery without revision)
 * 4. Provides actionable insights for reasoning improvement
 *
 * Formula:
 *   drift_score = max_drop × recovery_magnitude / steps_to_recover
 *   unresolved = drift_score > threshold AND no revision step exists
 */

import type { ThoughtRecord } from "../session.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface DriftAnalysis {
  /** Overall drift score (0-1, higher = more concerning) */
  drift_score: number;
  /** Whether the drift represents unresolved uncertainty */
  unresolved: boolean;
  /** Confidence at trajectory minimum */
  min_confidence: number;
  /** Step number where minimum occurred */
  min_step: number;
  /** Maximum confidence drop observed */
  max_drop: number;
  /** Recovery magnitude from min to final */
  recovery: number;
  /** Whether a revision step exists after the drop */
  has_revision_after_drop: boolean;
  /** Pattern classification */
  pattern: DriftPattern;
  /** Human-readable explanation */
  explanation: string;
  /** Suggested action if unresolved */
  suggestion: string | null;
}

export type DriftPattern =
  | "stable" // Confidence stays relatively flat
  | "stable_overconfident" // All confidence values ≥0.85 with low variance (trap risk)
  | "declining" // Monotonic decrease (getting less confident)
  | "improving" // Monotonic increase (getting more confident)
  | "v_shaped" // Drop then recovery (the concerning pattern)
  | "oscillating" // Multiple ups and downs
  | "cliff" // Sudden drop at end (likely error detected)
  | "insufficient"; // Not enough steps to analyze

export interface DriftConfig {
  /** Minimum drop to consider significant (default: 0.15) */
  min_significant_drop: number;
  /** Minimum recovery to flag as V-shaped (default: 0.15) */
  min_significant_recovery: number;
  /** Drift score threshold to flag as unresolved (default: 0.3) */
  unresolved_threshold: number;
  /** Minimum steps required for analysis (default: 3) */
  min_steps: number;
  /** Minimum confidence threshold for "overconfident" detection (default: 0.85) */
  overconfident_threshold: number;
  /** Maximum variance allowed for "stable overconfident" pattern (default: 0.05) */
  overconfident_max_variance: number;
  /** Minimum final drop to flag cliff as unresolved (default: 0.3) */
  cliff_drop_threshold: number;
  /** Final confidence threshold to flag declining pattern as unresolved (default: 0.5) */
  declining_final_threshold: number;
}

const DEFAULT_CONFIG: DriftConfig = {
  min_significant_drop: 0.15,
  min_significant_recovery: 0.15,
  unresolved_threshold: 0.3,
  min_steps: 3,
  overconfident_threshold: 0.85,
  overconfident_max_variance: 0.05,
  cliff_drop_threshold: 0.3,
  declining_final_threshold: 0.5,
};

// ============================================================================
// CORE ALGORITHM
// ============================================================================

/**
 * Analyze confidence trajectory for drift patterns.
 * O(n) complexity - single pass through steps array.
 */
export function analyzeConfidenceDrift(
  steps: ThoughtRecord[],
  config: Partial<DriftConfig> = {},
): DriftAnalysis {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Handle insufficient data
  if (steps.length < cfg.min_steps) {
    return {
      drift_score: 0,
      unresolved: false,
      min_confidence: steps[0]?.verification?.confidence ?? 0.5,
      min_step: steps[0]?.step_number ?? 1,
      max_drop: 0,
      recovery: 0,
      has_revision_after_drop: false,
      pattern: "insufficient",
      explanation: `Insufficient steps for drift analysis (${steps.length} < ${cfg.min_steps})`,
      suggestion: null,
    };
  }

  // Extract confidence values (default to 0.5 if not present)
  const confidences = steps.map((s) => s.verification?.confidence ?? 0.5);
  const stepNumbers = steps.map((s) => s.step_number);

  // Single-pass analysis: find min, max drop, track trajectory
  let minConf = confidences[0]!;
  let minIdx = 0;
  let maxConf = confidences[0]!;
  let maxIdx = 0;
  let maxDropFromPeak = 0;

  // Track running peak for drop calculation
  let runningPeak = confidences[0]!;

  for (let i = 1; i < confidences.length; i++) {
    const conf = confidences[i]!;

    // Update global min
    if (conf < minConf) {
      minConf = conf;
      minIdx = i;
    }

    // Update global max
    if (conf > maxConf) {
      maxConf = conf;
      maxIdx = i;
    }

    // Track maximum drop from any previous peak
    if (conf > runningPeak) {
      runningPeak = conf;
    } else {
      const dropFromPeak = runningPeak - conf;
      if (dropFromPeak > maxDropFromPeak) {
        maxDropFromPeak = dropFromPeak;
      }
    }
  }

  // Calculate recovery (from min to final)
  const finalConf = confidences[confidences.length - 1]!;
  const recovery = finalConf - minConf;

  // Check for revision steps after the minimum
  const hasRevisionAfterDrop = steps.slice(minIdx + 1).some((s) => s.revises_step !== undefined);

  // Classify pattern
  const pattern = classifyPattern(confidences, minIdx, maxIdx, maxDropFromPeak, recovery, cfg);

  // Calculate drift score
  // Formula for V-shaped: emphasize the drop magnitude since that's the concern
  // For other patterns: use drop as primary signal
  const stepsToRecover = Math.max(1, confidences.length - 1 - minIdx);
  let driftScore: number;

  if (pattern === "v_shaped") {
    // V-shaped score: max of (drop alone) or (drop × recovery / steps)
    // Significant drops always produce significant scores
    const basicScore = maxDropFromPeak;
    const recoveryBonus = (maxDropFromPeak * recovery) / stepsToRecover;
    driftScore = Math.max(basicScore, recoveryBonus);
  } else {
    // Non-V patterns get lower score based just on drop
    driftScore = maxDropFromPeak * 0.5;
  }

  // Clamp to 0-1
  const normalizedDriftScore = Math.min(1, Math.max(0, driftScore));

  // Determine if unresolved (concerning pattern without remediation)
  const isVShaped = pattern === "v_shaped";
  const isStableOverconfident = pattern === "stable_overconfident";
  const isCliff = pattern === "cliff";
  const significantDrop = maxDropFromPeak >= cfg.min_significant_drop;
  const significantRecovery = recovery >= cfg.min_significant_recovery;

  // V-shaped is unresolved if: significant drop + recovery, no revision, above threshold
  const vShapedUnresolved =
    isVShaped &&
    significantDrop &&
    significantRecovery &&
    !hasRevisionAfterDrop &&
    normalizedDriftScore >= cfg.unresolved_threshold;

  // Cliff is unresolved if: sharp final drop exceeds threshold (error detected at end)
  // Calculate final step drop for cliff detection
  const finalStepDrop =
    confidences.length >= 2
      ? confidences[confidences.length - 2]! - confidences[confidences.length - 1]!
      : 0;
  const cliffUnresolved = isCliff && finalStepDrop >= cfg.cliff_drop_threshold;

  // Declining is unresolved if: final confidence below threshold (ended uncertain)
  const isDeclining = pattern === "declining";
  const decliningUnresolved = isDeclining && finalConf < cfg.declining_final_threshold;

  // Stable overconfident is always flagged as unresolved (warrants review)
  // This catches trap questions where LLM is confidently wrong
  const unresolved =
    vShapedUnresolved || isStableOverconfident || cliffUnresolved || decliningUnresolved;

  // For stable_overconfident, cliff, and declining: use a moderate drift score to indicate concern
  const finalDriftScore =
    isStableOverconfident || cliffUnresolved || decliningUnresolved
      ? Math.max(normalizedDriftScore, 0.4) // Ensure visible concern level
      : normalizedDriftScore;

  // Generate explanation
  const explanation = generateExplanation(
    pattern,
    maxDropFromPeak,
    recovery,
    minIdx,
    stepNumbers,
    hasRevisionAfterDrop,
    minConf,
  );

  // Generate suggestion if unresolved
  const suggestion = unresolved
    ? generateSuggestion(stepNumbers[minIdx]!, maxDropFromPeak, pattern, minConf)
    : null;

  return {
    drift_score: finalDriftScore,
    unresolved,
    min_confidence: minConf,
    min_step: stepNumbers[minIdx]!,
    max_drop: maxDropFromPeak,
    recovery,
    has_revision_after_drop: hasRevisionAfterDrop,
    pattern,
    explanation,
    suggestion,
  };
}

/**
 * Classify the overall confidence trajectory pattern.
 */
function classifyPattern(
  confidences: number[],
  minIdx: number,
  _maxIdx: number,
  maxDrop: number,
  recovery: number,
  cfg: DriftConfig,
): DriftPattern {
  const n = confidences.length;
  const range = Math.max(...confidences) - Math.min(...confidences);

  // V-shaped: significant drop followed by significant recovery
  // Min must be in middle portion (not at start or end)
  // Check FIRST - this is the most important pattern to detect
  const minInMiddle = minIdx > 0 && minIdx < n - 1;
  if (
    minInMiddle &&
    maxDrop >= cfg.min_significant_drop &&
    recovery >= cfg.min_significant_recovery
  ) {
    return "v_shaped";
  }

  // Cliff: sudden drop at the end (min is at or near the end)
  // Must be a SUDDEN drop in the final step - check this BEFORE declining
  // to catch "error detected at end" pattern
  // For cliff: final drop must be significantly larger than average step change
  if (minIdx >= n - 1 && maxDrop >= cfg.min_significant_drop && n >= 2) {
    const finalDrop = confidences[n - 2]! - confidences[n - 1]!;
    // Calculate average step change for comparison
    let totalChange = 0;
    for (let i = 1; i < n - 1; i++) {
      totalChange += Math.abs(confidences[i]! - confidences[i - 1]!);
    }
    const avgChange = n > 2 ? totalChange / (n - 2) : 0;
    // Cliff: final drop is at least 2x the average change AND meets minimum threshold
    if (finalDrop >= cfg.min_significant_drop && finalDrop >= avgChange * 2) {
      return "cliff";
    }
  }

  // Stable overconfident: all values ≥ threshold with low variance
  // This is a concerning pattern on trap questions where LLMs are confidently wrong
  // Check BEFORE generic stable to catch this specific concerning case
  const minConf = Math.min(...confidences);
  if (minConf >= cfg.overconfident_threshold && range <= cfg.overconfident_max_variance) {
    return "stable_overconfident";
  }

  // Stable: low variance throughout (check AFTER V-shaped so custom configs work)
  if (range < 0.1) {
    return "stable";
  }

  // Declining: monotonic or mostly decreasing
  let decreases = 0;
  for (let i = 1; i < n; i++) {
    if (confidences[i]! < confidences[i - 1]!) decreases++;
  }
  if (decreases >= (n - 1) * 0.7) {
    return "declining";
  }

  // Improving: monotonic or mostly increasing
  let increases = 0;
  for (let i = 1; i < n; i++) {
    if (confidences[i]! > confidences[i - 1]!) increases++;
  }
  if (increases >= (n - 1) * 0.7) {
    return "improving";
  }

  // Oscillating: multiple direction changes
  let directionChanges = 0;
  let lastDir = 0;
  for (let i = 1; i < n; i++) {
    const dir = Math.sign(confidences[i]! - confidences[i - 1]!);
    if (dir !== 0 && dir !== lastDir) {
      directionChanges++;
      lastDir = dir;
    }
  }
  if (directionChanges >= 3) {
    return "oscillating";
  }

  // Default to stable if no clear pattern
  return "stable";
}

/**
 * Generate human-readable explanation of the drift analysis.
 */
function generateExplanation(
  pattern: DriftPattern,
  maxDrop: number,
  recovery: number,
  minIdx: number,
  stepNumbers: number[],
  hasRevision: boolean,
  minConfidence?: number,
): string {
  const dropPct = (maxDrop * 100).toFixed(0);
  const recoveryPct = (recovery * 100).toFixed(0);
  const minStep = stepNumbers[minIdx];

  switch (pattern) {
    case "stable":
      return "Confidence remained stable throughout reasoning chain.";

    case "stable_overconfident":
      return `⚠️ Stable high confidence (≥${((minConfidence ?? 0.85) * 100).toFixed(0)}%) throughout chain. On complex/trap questions, consistent high confidence without doubt often correlates with incorrect answers.`;

    case "declining":
      if (minConfidence !== undefined && minConfidence < 0.5) {
        return `⚠️ Confidence declined steadily to ${(minConfidence * 100).toFixed(0)}% (${dropPct}% total drop). Ending with low confidence suggests unresolved uncertainty.`;
      }
      return `Confidence declined steadily (${dropPct}% total drop). This may indicate increasing uncertainty or problem difficulty.`;

    case "improving":
      return `Confidence improved throughout reasoning (${recoveryPct}% increase). Good progressive understanding.`;

    case "v_shaped":
      if (hasRevision) {
        return `V-shaped confidence pattern detected: ${dropPct}% drop at step ${minStep}, then ${recoveryPct}% recovery. Revision step present - uncertainty was addressed.`;
      } else {
        return `⚠️ V-shaped confidence pattern: ${dropPct}% drop at step ${minStep}, then ${recoveryPct}% recovery WITHOUT revision. The reasoning may have "pushed through" uncertainty without addressing it.`;
      }

    case "oscillating":
      return `Confidence oscillated throughout reasoning. Multiple uncertainty points encountered.`;

    case "cliff":
      return `Confidence dropped sharply at the end (${dropPct}% drop). Possible error or contradiction detected late in reasoning.`;

    case "insufficient":
      return "Not enough steps for meaningful drift analysis.";

    default:
      return "Confidence pattern analyzed.";
  }
}

/**
 * Generate actionable suggestion for unresolved drift.
 */
function generateSuggestion(
  minStep: number,
  dropMagnitude: number,
  pattern?: DriftPattern,
  minConfidence?: number,
): string {
  // Special handling for stable overconfident pattern
  if (pattern === "stable_overconfident") {
    const confPct = ((minConfidence ?? 0.85) * 100).toFixed(0);
    return `High confidence (${confPct}%+) throughout suggests possible overconfidence. Consider: Is this a trick question? Have you verified assumptions? Adding a self-check step could help catch errors.`;
  }

  // Special handling for cliff pattern - error detected at end
  if (pattern === "cliff") {
    const dropPct = (dropMagnitude * 100).toFixed(0);
    return `Sharp confidence drop (${dropPct}%) at the final step suggests an error or contradiction was detected late. Consider: What caused this doubt? Should you revise earlier steps before concluding?`;
  }

  // Special handling for declining pattern - ended uncertain
  if (pattern === "declining") {
    const finalConfPct = ((minConfidence ?? 0.5) * 100).toFixed(0);
    return `Confidence declined to ${finalConfPct}% by the end. The reasoning chain ended with significant doubt. Consider: What's causing the uncertainty? Is the approach valid? Should you try a different method?`;
  }

  if (dropMagnitude >= 0.3) {
    return `Consider revising from step ${minStep} where confidence dropped significantly. The recovery without explicit revision suggests the uncertainty was not properly addressed.`;
  } else {
    return `Review step ${minStep} where confidence was lowest. Adding explicit reasoning about why confidence recovered could strengthen the chain.`;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick check if a reasoning chain has concerning drift.
 * Use for fast filtering before detailed analysis.
 */
export function hasConcerningDrift(steps: ThoughtRecord[], _threshold: number = 0.3): boolean {
  if (steps.length < 3) return false;

  const confidences = steps.map((s) => s.verification?.confidence ?? 0.5);
  const min = Math.min(...confidences);
  const minIdx = confidences.indexOf(min);
  const final = confidences[confidences.length - 1]!;

  // Quick V-shape detection
  const hasDrop = confidences.slice(0, minIdx + 1).some((c) => c - min >= 0.15);
  const hasRecovery = final - min >= 0.15;
  const noRevision = !steps.slice(minIdx + 1).some((s) => s.revises_step !== undefined);

  return hasDrop && hasRecovery && noRevision && minIdx > 0 && minIdx < steps.length - 1;
}

/**
 * Extract just the confidence trajectory for visualization/logging.
 */
export function extractConfidenceTrajectory(
  steps: ThoughtRecord[],
): { step: number; confidence: number }[] {
  return steps.map((s) => ({
    step: s.step_number,
    confidence: s.verification?.confidence ?? 0.5,
  }));
}

/**
 * Compute aggregate statistics for a confidence trajectory.
 */
export function computeTrajectoryStats(steps: ThoughtRecord[]): {
  mean: number;
  stddev: number;
  min: number;
  max: number;
  trend: "up" | "down" | "flat";
} {
  const confidences = steps.map((s) => s.verification?.confidence ?? 0.5);
  const n = confidences.length;

  if (n === 0) {
    return { mean: 0.5, stddev: 0, min: 0.5, max: 0.5, trend: "flat" };
  }

  const sum = confidences.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const sqDiffs = confidences.map((c) => (c - mean) ** 2);
  const variance = sqDiffs.reduce((a, b) => a + b, 0) / n;
  const stddev = Math.sqrt(variance);

  const min = Math.min(...confidences);
  const max = Math.max(...confidences);

  // Linear trend: positive slope = up, negative = down
  const first = confidences[0]!;
  const last = confidences[n - 1]!;
  const trend = last - first > 0.1 ? "up" : last - first < -0.1 ? "down" : "flat";

  return { mean, stddev, min, max, trend };
}
