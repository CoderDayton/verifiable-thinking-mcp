/**
 * Scratchpad Tool - Unified CRASH-style reasoning with operation-based dispatch
 *
 * Features:
 * - Auto step increment (no manual step_number needed)
 * - Confidence tracking (average across chain)
 * - Threshold detection with 5-second warning
 * - Navigate operation for viewing history/branches/paths
 * - Branch and revise operations
 * - Auto-suggest next simplification step for math derivations
 * - Proactive stepping guidance based on question complexity
 */

import type { Context } from "fastmcp";
import { compress, needsCompression } from "../lib/compression.ts";
import { contextAwareCompute } from "../lib/compute/context.ts";
import {
  type DetectedMistake,
  detectCommonMistakesFromText,
  isLikelyComputable,
  type SimplificationStep,
  suggestNextStepFromText,
  suggestSimplificationPath,
  tryLocalCompute,
} from "../lib/compute/index.ts";
import { stripMarkdown } from "../lib/extraction.ts";
import { SessionManager, type ThoughtRecord } from "../lib/session.ts";
import { challenge, shouldChallenge } from "../lib/think/challenge.ts";
import { assessPromptComplexity } from "../lib/think/complexity.ts";
import { analyzeConfidenceDrift } from "../lib/think/confidence-drift.ts";
import { checkStepConsistency } from "../lib/think/consistency.ts";
import { detectDomain } from "../lib/think/guidance.ts";
import { analyzeStepForResolution } from "../lib/think/hypothesis.ts";
import {
  type ScratchpadArgs,
  type ScratchpadResponse,
  ScratchpadSchema,
} from "../lib/think/scratchpad-schema.ts";
import { primeQuestion, spotCheck } from "../lib/think/spot-check.ts";
import { calculateTokenUsage } from "../lib/tokens.ts";
import { verify } from "../lib/verification.ts";

type MCPContext = Context<Record<string, unknown> | undefined>;

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Threshold for adaptive maxCombined in trap priming.
 * Questions shorter than this get maxCombined=2, longer get maxCombined=1.
 *
 * Tuned empirically: all multi-trap questions in benchmark are ≥195 chars.
 * Using 190 ensures all multi-trap questions stay conservative (maxCombined=1).
 */
const ADAPTIVE_PRIMING_THRESHOLD = 190;

/**
 * Maximum question length for trap priming (security + performance).
 * Prevents memory exhaustion and ReDoS attacks on regex patterns.
 * 10k chars ≈ 2.5k tokens, sufficient for any reasonable question.
 */
const MAX_QUESTION_LENGTH = 10_000;

// ============================================================================
// STEPPING GUIDANCE
// ============================================================================

/** Map complexity tier to recommended minimum steps */
function getRecommendedSteps(
  tier: "Low" | "Moderate" | "High" | "Very Hard" | "Almost Impossible",
): number {
  switch (tier) {
    case "Low":
      return 1;
    case "Moderate":
      return 2;
    case "High":
      return 4;
    case "Very Hard":
      return 6;
    case "Almost Impossible":
      return 8;
  }
}

// ============================================================================
// CONFIDENCE TRACKING
// ============================================================================

interface ConfidenceState {
  stepConfidence: number | undefined;
  chainConfidence: number;
  stepsWithConfidence: number;
}

/** Calculate chain confidence from session thoughts + current step */
function calculateConfidence(
  sessionId: string,
  branchId: string,
  newConfidence?: number,
): ConfidenceState {
  const thoughts = SessionManager.getThoughts(sessionId, branchId);

  // Collect confidences from verification results
  const confidences: number[] = [];
  for (const t of thoughts) {
    if (t.verification?.confidence !== undefined) {
      confidences.push(t.verification.confidence);
    }
  }

  // Add new confidence if provided
  if (newConfidence !== undefined) {
    confidences.push(newConfidence);
  }

  const chainConfidence =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

  return {
    stepConfidence: newConfidence,
    chainConfidence,
    stepsWithConfidence: confidences.length,
  };
}

/** Determine status based on confidence threshold */
function determineStatus(
  chainConfidence: number,
  threshold: number,
  isComplete: boolean,
): ScratchpadResponse["status"] {
  if (isComplete) return "complete";
  if (chainConfidence >= threshold) return "threshold_reached";
  if (chainConfidence >= threshold * 0.8) return "review"; // Within 20% of threshold
  return "continue";
}

/** Get suggested action based on status */
function getSuggestedAction(status: ScratchpadResponse["status"], chainConfidence: number): string {
  switch (status) {
    case "complete":
      return "Reasoning chain complete.";
    case "threshold_reached":
      return `Confidence ${(chainConfidence * 100).toFixed(0)}% reached threshold. Consider completing or add one more verification step.`;
    case "review":
      return `Confidence ${(chainConfidence * 100).toFixed(0)}% approaching threshold. Review recent steps for completeness.`;
    case "continue":
      return `Continue reasoning. Chain confidence: ${(chainConfidence * 100).toFixed(0)}%`;
    case "verification_failed":
      return "Verification failed. Use revise, branch, or override to continue.";
    case "budget_exhausted":
      return "Token budget exhausted. Complete your reasoning or start a new session.";
  }
}

/**
 * Run step-level CDD analysis and return drift info.
 * Returns data for ALL patterns (not just concerning ones) so clients can display trajectory.
 * Streams warning only for concerning patterns.
 */
async function runStepLevelCDD(
  sessionId: string,
  branchId: string,
  streamContent: MCPContext["streamContent"],
): Promise<ScratchpadResponse["confidence_drift"] | undefined> {
  const thoughts = SessionManager.getThoughts(sessionId, branchId);

  // Need at least 3 steps for meaningful CDD analysis
  if (thoughts.length < 3) {
    return undefined;
  }

  const analysis = analyzeConfidenceDrift(thoughts);

  // Skip insufficient pattern
  if (analysis.pattern === "insufficient") {
    return undefined;
  }

  // Stream warning for concerning patterns only
  if (analysis.unresolved) {
    await streamContent({
      type: "text",
      text:
        `\n⚠️ **Early Drift Warning:** ${analysis.explanation}\n` +
        (analysis.suggestion ? `   💡 ${analysis.suggestion}\n` : ""),
    });
  }

  // Return structured data for ALL non-insufficient patterns (so clients can display trajectory)
  return {
    drift_score: analysis.drift_score,
    unresolved: analysis.unresolved,
    min_confidence: analysis.min_confidence,
    min_step: analysis.min_step,
    max_drop: analysis.max_drop,
    recovery: analysis.recovery,
    has_revision_after_drop: analysis.has_revision_after_drop,
    pattern: analysis.pattern,
    explanation: analysis.explanation,
    suggestion: analysis.suggestion,
  };
}

/**
 * Adaptive spot-check: Auto-run spot-check when CDD detects unresolved drift.
 * This catches trap patterns early, before the model reaches complete().
 *
 * Triggers when:
 * 1. CDD detected unresolved pattern (unresolved=true)
 * 2. Session has a stored question
 * 3. Current thought contains potential answer markers
 *
 * Returns spot-check result if triggered, undefined otherwise.
 */
async function runAdaptiveSpotCheck(
  sessionId: string,
  thought: string,
  cddResult: ScratchpadResponse["confidence_drift"] | undefined,
  streamContent: MCPContext["streamContent"],
): Promise<ScratchpadResponse["spot_check_result"] | undefined> {
  // Only trigger if CDD detected unresolved drift
  if (!cddResult?.unresolved) {
    return undefined;
  }

  // Need a stored question to spot-check against
  const question = SessionManager.getQuestion(sessionId);
  if (!question) {
    return undefined;
  }

  // Look for answer indicators in the thought
  // Match patterns like "answer is X", "= X", "therefore X", "result: X"
  const answerPatterns = [
    /(?:answer|result|solution|total|sum|value|equals?)\s*(?:is|:|=)\s*([^\s,.]+)/i,
    /(?:therefore|thus|so|hence)\s*[,:]?\s*([^\s,.]+)/i,
    /=\s*([^\s,.=]+)\s*$/m,
    /\*\*([^*]+)\*\*\s*$/m, // Bold answer at end
  ];

  let potentialAnswer: string | undefined;
  for (const pattern of answerPatterns) {
    const match = thought.match(pattern);
    if (match?.[1]) {
      potentialAnswer = match[1].trim();
      break;
    }
  }

  // No answer found in thought
  if (!potentialAnswer) {
    return undefined;
  }

  // Run spot-check
  const result = spotCheck(question, potentialAnswer);

  // Only report if spot-check failed (found a trap)
  if (result.passed) {
    return undefined;
  }

  // Stream warning
  await streamContent({
    type: "text",
    text:
      `\n🔍 **Adaptive Spot-Check** (triggered by ${cddResult.pattern} drift)\n` +
      `   ⚠️ ${result.trapType}: ${result.warning}\n` +
      (result.hint ? `   💡 ${result.hint}\n` : ""),
  });

  return {
    passed: result.passed,
    trap_type: result.trapType,
    warning: result.warning,
    hint: result.hint,
    confidence: result.confidence,
  };
}

/**
 * Enrich step response with optional fields (verification, compute, compression, etc).
 * Extracted to reduce handleStep complexity.
 */
function enrichStepResponse(
  response: ScratchpadResponse,
  params: {
    verificationResult: { passed: boolean; confidence: number } | null;
    domain: string;
    computeResult: {
      solved: boolean;
      result?: string | number;
      method?: string;
    } | null;
    compressionResult: ScratchpadResponse["compression"] | null;
    tokenUsage: { total: number };
    tokenBudget: number;
    budgetExceeded: boolean;
    autoCompressed: boolean;
    augmentationResult: ScratchpadResponse["augmentation"] | null;
    trapAnalysis: ScratchpadResponse["trap_analysis"] | undefined;
    nextStepSuggestion: ScratchpadResponse["next_step_suggestion"] | undefined;
    thoughtText: string; // Add thought text for token estimation
  },
): void {
  const {
    verificationResult,
    domain,
    computeResult,
    compressionResult,
    tokenUsage,
    tokenBudget,
    budgetExceeded,
    autoCompressed,
    augmentationResult,
    trapAnalysis,
    nextStepSuggestion,
    thoughtText,
  } = params;

  // Add verification info
  if (verificationResult) {
    response.verification = {
      passed: verificationResult.passed,
      confidence: verificationResult.confidence,
      domain,
    };
  }

  // Add local compute info
  if (computeResult?.solved && computeResult.result !== undefined) {
    response.local_compute = {
      solved: true,
      result: computeResult.result,
      method: computeResult.method ?? "unknown",
    };
  }

  // Add compression info
  if (compressionResult) {
    response.compression = compressionResult;
  }

  // Add token usage info (include estimated tokens for current operation)
  const currentOpTokens =
    Math.ceil((thoughtText?.length || 0) / 4) + Math.ceil(JSON.stringify(response).length / 4);
  const totalWithCurrentOp = tokenUsage.total + currentOpTokens;
  const budgetPercent = tokenBudget > 0 ? (totalWithCurrentOp / tokenBudget) * 100 : 0;
  response.token_usage = {
    total: totalWithCurrentOp,
    budget: tokenBudget,
    exceeded: budgetExceeded,
    auto_compressed: autoCompressed,
    budget_percent: Math.round(budgetPercent),
  };

  // Proactive compression suggestion when approaching budget (>60% consumed)
  if (budgetPercent >= 60 && !autoCompressed && !compressionResult) {
    const urgency = budgetPercent >= 80 ? "⚠️ " : "";
    response.compression_suggestion = {
      should_compress: true,
      current_tokens: tokenUsage.total,
      budget: tokenBudget,
      percent_used: Math.round(budgetPercent),
      nudge: `${urgency}Session at ${Math.round(budgetPercent)}% of token budget (${tokenUsage.total}/${tokenBudget}). Use compress=true on next step to reduce context size.`,
    };
  }

  // Add augmentation info
  if (augmentationResult) {
    response.augmentation = augmentationResult;
  }

  // Add trap analysis info (from priming on first step)
  if (trapAnalysis) {
    response.trap_analysis = trapAnalysis;
  }

  // Add next step suggestion for math domain
  if (nextStepSuggestion) {
    response.next_step_suggestion = nextStepSuggestion;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Build verification failure response with recovery options */
function buildVerificationFailureResponse(params: {
  sessionId: string;
  branchId: string;
  stepNumber: number;
  threshold: number;
  verificationResult: {
    passed: boolean;
    confidence: number;
    suggestions: string[];
    evidence: string;
  };
  detectedMistakes: DetectedMistake[];
  domain: string;
}): ScratchpadResponse {
  const {
    sessionId,
    branchId,
    stepNumber,
    threshold,
    verificationResult,
    detectedMistakes,
    domain,
  } = params;
  const confState = calculateConfidence(sessionId, branchId);
  const verificationError = {
    issue: verificationResult.suggestions[0] || "Verification failed",
    evidence: verificationResult.evidence,
    suggestions: verificationResult.suggestions,
    confidence: verificationResult.confidence,
    domain,
  };

  return {
    session_id: sessionId,
    current_step: stepNumber - 1,
    branch: branchId,
    operation: "step",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status: "verification_failed",
    suggested_action: "Verification failed. Use revise, branch, or override to continue.",
    verification_failure: {
      issue: verificationError.issue,
      evidence: verificationError.evidence,
      suggestions: verificationError.suggestions,
      confidence: verificationResult.confidence,
      domain,
      detected_mistakes:
        detectedMistakes.length > 0
          ? detectedMistakes.map((m) => ({
              type: m.type,
              description: m.explanation,
              fix: m.suggestion,
              corrected_step: m.suggestedFix,
            }))
          : undefined,
      recovery_options: {
        revise: {
          target_step: stepNumber,
          suggested_reason: detectedMistakes[0]
            ? `Fix ${detectedMistakes[0].type}: ${detectedMistakes[0].suggestion || detectedMistakes[0].explanation}`
            : verificationError.suggestions[0] || "Fix verification issue",
        },
        branch: {
          from_step: Math.max(1, stepNumber - 1),
          suggested_name: `Alternative after failed step ${stepNumber}`,
        },
        override: {
          flag: "force_continue",
          warning:
            "Only use if you're certain the heuristic is wrong. The step will be stored as-is.",
        },
      },
    },
  };
}

/** Stream verification failure notice with detected mistakes */
async function streamVerificationFailure(
  streamContent: MCPContext["streamContent"],
  verificationResult: {
    confidence: number;
    suggestions: string[];
    evidence: string;
  },
  detectedMistakes: DetectedMistake[],
  stepNumber: number,
): Promise<void> {
  let mistakeText = "";
  if (detectedMistakes.length > 0) {
    mistakeText = "\n**Detected algebraic mistakes:**\n";
    for (const m of detectedMistakes) {
      mistakeText += `• **${m.type}**: ${m.explanation}\n`;
      if (m.suggestedFix) {
        mistakeText += `  **Corrected:** \`${m.suggestedFix}\`\n`;
      } else if (m.suggestion) {
        mistakeText += `  Fix: ${m.suggestion}\n`;
      }
    }
  }

  const issue = verificationResult.suggestions[0] || "Verification failed";
  await streamContent({
    type: "text",
    text:
      `\n⚠️ **VERIFICATION FAILED** (${Math.round(verificationResult.confidence * 100)}% confidence)\n` +
      `**Issue:** ${issue}\n` +
      `**Evidence:** ${verificationResult.evidence}\n` +
      mistakeText +
      `\n**Recovery options:**\n` +
      `1. \`revise\` - Correct this step (target_step: ${stepNumber}, reason: "${verificationResult.suggestions[0] || "fix issue"}")\n` +
      `2. \`branch\` - Try alternative approach (from_step: ${stepNumber - 1})\n` +
      `3. \`override\` - Proceed anyway (acknowledge: true, failed_step: ${stepNumber})\n\n` +
      `**Suggested:** revise\n`,
  });
}

/** Build pending thought record for failed verification */
function buildPendingRecord(params: {
  sessionId: string;
  branchId: string;
  stepNumber: number;
  thought: string;
  domain: string;
  verificationConfidence: number;
  compressionResult: {
    original_tokens: number;
    compressed_tokens: number;
  } | null;
}): ThoughtRecord {
  const {
    sessionId,
    branchId,
    stepNumber,
    thought,
    domain,
    verificationConfidence,
    compressionResult,
  } = params;
  return {
    id: `${sessionId}:${branchId}:${stepNumber}`,
    step_number: stepNumber,
    thought,
    timestamp: Date.now(),
    branch_id: branchId,
    verification: { passed: false, confidence: verificationConfidence, domain },
    compression: compressionResult
      ? {
          input_bytes_saved:
            (compressionResult.original_tokens - compressionResult.compressed_tokens) * 4,
          output_bytes_saved: 0,
          context_bytes_saved: 0,
          original_tokens: compressionResult.original_tokens,
          compressed_tokens: compressionResult.compressed_tokens,
        }
      : undefined,
  };
}

/** Apply augmentation to thought if enabled */
async function applyAugmentation(
  thought: string,
  context: string | undefined,
  shouldAugment: boolean,
  streamContent: MCPContext["streamContent"],
): Promise<{
  thought: string;
  result: {
    applied: boolean;
    computations: number;
    filtered: number;
    domain: string;
  } | null;
}> {
  if (!shouldAugment) {
    return { thought, result: null };
  }

  const augResult = contextAwareCompute({ thought, systemPrompt: context });
  if (!augResult.hasComputations) {
    return { thought, result: null };
  }

  await streamContent({
    type: "text",
    text: `⚡ **Augmented** ${augResult.computations.length} computations (${augResult.domain})\n`,
  });

  return {
    thought: augResult.augmented,
    result: {
      applied: true,
      computations: augResult.computations.length,
      filtered: augResult.filteredCount,
      domain: augResult.domain,
    },
  };
}

/** Apply compression if needed */
async function applyCompression(
  thought: string,
  args: { compress?: boolean; compression_query?: string; context?: string },
  budgetExceeded: boolean,
  streamContent: MCPContext["streamContent"],
): Promise<{
  thought: string;
  result: {
    applied: boolean;
    original_tokens: number;
    compressed_tokens: number;
    ratio: number;
  } | null;
  autoCompressed: boolean;
}> {
  const shouldCompress =
    args.compress ||
    budgetExceeded ||
    (thought.length > 500 && needsCompression(thought).shouldCompress);

  if (!shouldCompress) {
    return { thought, result: null, autoCompressed: false };
  }

  const query = args.compression_query || args.context || "";
  const targetRatio = budgetExceeded ? 0.4 : 0.6;
  const compressOutput = compress(thought, query, {
    target_ratio: targetRatio,
  });
  const autoCompressed = budgetExceeded && !args.compress;

  const budgetTag = autoCompressed ? " [budget guard]" : "";
  await streamContent({
    type: "text",
    text: `📦 **Compressed** ${compressOutput.original_tokens}→${compressOutput.compressed_tokens} tokens (${(compressOutput.ratio * 100).toFixed(0)}%)${budgetTag}\n`,
  });

  return {
    thought: compressOutput.compressed,
    result: {
      applied: true,
      original_tokens: compressOutput.original_tokens,
      compressed_tokens: compressOutput.compressed_tokens,
      ratio: compressOutput.ratio,
    },
    autoCompressed,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Handle trap priming for step operation.
 * Stores question in session and runs trap detection on first step.
 * Returns trap analysis if traps detected, undefined otherwise.
 *
 * Uses adaptive maxCombined based on question length:
 * - Short questions (<ADAPTIVE_PRIMING_THRESHOLD chars): maxCombined=2
 * - Longer questions: maxCombined=1 (avoid prompt bloat, multi-trap confusion)
 */
async function handleTrapPriming(
  question: string,
  sessionId: string,
  stepNumber: number,
  streamContent: MCPContext["streamContent"],
): Promise<ScratchpadResponse["trap_analysis"]> {
  // Validate question length (security: prevents memory exhaustion + ReDoS)
  if (question.length > MAX_QUESTION_LENGTH) {
    await streamContent({
      type: "text",
      text: `⚠️ Question too long (${question.length} chars, max ${MAX_QUESTION_LENGTH}). Skipping trap detection.\n\n`,
    });
    return undefined;
  }

  // Store question in session for later spot-check at complete (first-write-wins)
  SessionManager.setQuestion(sessionId, question);

  // Warn if question provided late (trap analysis only runs on step 1)
  if (stepNumber !== 1) {
    await streamContent({
      type: "text",
      text: `⚠️ Question provided at step ${stepNumber}. Trap priming only runs on step 1. Stored for spot-check at complete.\n\n`,
    });
    return undefined;
  }

  // Adaptive maxCombined: short questions can handle more priming context
  const maxCombined = question.length < ADAPTIVE_PRIMING_THRESHOLD ? 2 : 1;
  const primeResult = primeQuestion(question, { maxCombined });
  if (!primeResult.shouldPrime || !primeResult.primingPrompt) return undefined;

  await streamContent({
    type: "text",
    text: `💡 **Trap Analysis:** ${primeResult.primingPrompt}\n\n`,
  });

  return {
    detected: true,
    types: primeResult.trapTypes,
    primed_count: primeResult.primedTypes.length,
    note: primeResult.primingPrompt,
    confidence: primeResult.confidence,
  };
}

/**
 * Run consistency check every N steps to detect contradictions.
 * Returns consistency_warning if contradictions found, undefined otherwise.
 */
async function runConsistencyCheck(
  sessionId: string,
  branchId: string,
  stepNumber: number,
  currentThought: string,
  streamContent: MCPContext["streamContent"],
): Promise<ScratchpadResponse["consistency_warning"]> {
  // Only check every 3 steps, and only if we have prior steps
  if (stepNumber < 3 || stepNumber % 3 !== 0) {
    return undefined;
  }

  const thoughts = SessionManager.getThoughts(sessionId, branchId);
  const stepData = thoughts.map((t) => ({
    step: t.step_number,
    thought: t.thought,
  }));
  const contradictions = checkStepConsistency(
    { step: stepNumber, thought: currentThought },
    stepData.slice(0, -1), // Exclude current step (already in thoughts)
  );

  if (contradictions.length === 0) {
    return undefined;
  }

  await streamContent({
    type: "text",
    text:
      `\n⚠️ **Consistency Warning:** ${contradictions.length} contradiction(s) detected\n` +
      contradictions.map((c) => `  - ${c.description}`).join("\n") +
      "\n",
  });

  return {
    has_contradictions: true,
    count: contradictions.length,
    contradictions: contradictions.map((c) => ({
      type: c.type,
      description: c.description,
      subject: c.subject,
      original_step: c.original_step,
      conflicting_step: c.conflicting_step,
      confidence: c.confidence,
    })),
    nudge: `⚠️ Found ${contradictions.length} potential contradiction(s). Review steps ${contradictions.map((c) => c.original_step).join(", ")} for consistency.`,
  };
}

/**
 * Run hypothesis resolution check for branch steps.
 * Returns hypothesis_resolution and optional merge_suggestion if confirmed.
 */
async function runHypothesisResolution(
  sessionId: string,
  branchId: string,
  stepNumber: number,
  currentThought: string,
  streamContent: MCPContext["streamContent"],
): Promise<{
  resolution?: ScratchpadResponse["hypothesis_resolution"];
  mergeSuggestion?: ScratchpadResponse["merge_suggestion"];
}> {
  const session = SessionManager.get(sessionId);
  if (!session) {
    return {};
  }

  // Check all branches with hypotheses
  for (const branch of session.branches.values()) {
    if (!branch.hypothesis || branch.id === "main") {
      continue;
    }

    // Only check if the current step is on this branch
    if (branchId !== branch.id) {
      continue;
    }

    const resolution = analyzeStepForResolution(
      currentThought,
      branch.hypothesis,
      branch.success_criteria ?? null,
      stepNumber,
    );

    if (!resolution.resolved && resolution.confidence <= 0.5) {
      continue;
    }

    // Stream resolution status
    if (resolution.resolved) {
      const emoji =
        resolution.outcome === "confirmed" ? "✅" : resolution.outcome === "refuted" ? "❌" : "❓";
      await streamContent({
        type: "text",
        text:
          `\n${emoji} **Hypothesis ${resolution.outcome?.toUpperCase()}:** "${branch.hypothesis.slice(0, 60)}${branch.hypothesis.length > 60 ? "..." : ""}"\n` +
          `   Evidence: ${resolution.evidence}\n` +
          `   ${resolution.suggestion}\n`,
      });
    }

    // Build merge suggestion if hypothesis confirmed
    let mergeSuggestion: ScratchpadResponse["merge_suggestion"];
    if (resolution.outcome === "confirmed") {
      mergeSuggestion = {
        should_merge: true,
        from_branch: branch.id,
        confirmed_hypothesis: branch.hypothesis,
        key_findings: resolution.evidence || currentThought.slice(0, 100),
        nudge: `💡 Hypothesis confirmed! Consider incorporating findings from branch "${branch.name || branch.id}" into your main reasoning.`,
      };

      await streamContent({
        type: "text",
        text: `\n${mergeSuggestion.nudge}\n`,
      });
    }

    return { resolution, mergeSuggestion };
  }

  return {};
}

/**
 * Check if reasoning should be challenged and build suggestion.
 * Returns challenge_suggestion if overconfidence detected, undefined otherwise.
 */
async function runAutoChallenge(
  chainConfidence: number,
  stepCount: number,
  hasVerification: boolean,
  streamContent: MCPContext["streamContent"],
): Promise<ScratchpadResponse["challenge_suggestion"]> {
  if (!shouldChallenge(chainConfidence, stepCount, hasVerification)) {
    return undefined;
  }

  // Determine reason for challenge suggestion
  let reason: string;
  let suggestedType: ScratchpadResponse["challenge_suggestion"] extends
    | { suggested_type: infer T }
    | undefined
    ? T
    : never;

  if (chainConfidence > 0.95) {
    reason = `Very high confidence (${(chainConfidence * 100).toFixed(0)}%) warrants adversarial review`;
    suggestedType = "all";
  } else if (stepCount < 3 && !hasVerification) {
    reason = `High confidence (${(chainConfidence * 100).toFixed(0)}%) with only ${stepCount} step(s) and no verification`;
    suggestedType = "premise_check";
  } else {
    reason = `Confidence pattern suggests potential overconfidence`;
    suggestedType = "assumption_inversion";
  }

  const nudge = `🎯 Consider using \`challenge\` operation: ${reason}`;

  await streamContent({
    type: "text",
    text: `\n${nudge}\n`,
  });

  return {
    should_challenge: true,
    reason,
    suggested_type: suggestedType,
    nudge,
  };
}

/**
 * Calculate stepping guidance based on question complexity.
 * Only runs on step 1 when a question is provided.
 */
async function calculateSteppingGuidance(
  question: string | undefined,
  stepNumber: number,
  streamContent: MCPContext["streamContent"],
): Promise<ScratchpadResponse["stepping_guidance"]> {
  if (!question || stepNumber !== 1) {
    return undefined;
  }

  const complexity = assessPromptComplexity(question);
  const recommendedSteps = getRecommendedSteps(complexity.tier);
  const guidance: ScratchpadResponse["stepping_guidance"] = {
    complexity_tier: complexity.tier,
    recommended_steps: recommendedSteps,
    current_steps: 1,
    needs_more_steps: recommendedSteps > 1,
    nudge:
      recommendedSteps > 2
        ? `⚠️ This is a ${complexity.tier} complexity question. Take ${recommendedSteps}+ reasoning steps before concluding.`
        : null,
  };

  if (guidance.nudge) {
    await streamContent({
      type: "text",
      text: `${guidance.nudge}\n\n`,
    });
  }

  return guidance;
}

/**
 * Run verification on thought and return failure response if verification fails.
 * Returns null if verification passes or is not required.
 */
async function runVerificationCheck(
  args: ScratchpadArgs,
  sessionId: string,
  branchId: string,
  stepNumber: number,
  thought: string,
  domain: "math" | "logic" | "code" | "general",
  threshold: number,
  compressionResult: {
    applied: boolean;
    original_tokens: number;
    compressed_tokens: number;
    ratio: number;
  } | null,
  streamContent: MCPContext["streamContent"],
): Promise<
  | {
      passed: true;
      result: ReturnType<typeof verify> | null;
    }
  | {
      passed: false;
      response: ScratchpadResponse;
    }
> {
  // Run verification if requested OR auto-enabled for longer chains
  // Auto-verify when: chain has >3 steps AND verify wasn't explicitly set to false
  const priorThoughts = SessionManager.getThoughts(sessionId, branchId);
  const shouldAutoVerify = priorThoughts.length >= 3 && args.verify !== false;
  const shouldVerify = args.verify === true || shouldAutoVerify;

  if (!shouldVerify) {
    return { passed: true, result: null };
  }

  const autoVerifyEnabled = shouldAutoVerify && args.verify !== true;
  const contextStrings = priorThoughts.map((t) => t.thought);
  const verificationResult = verify(thought, domain, contextStrings, true);

  // Note auto-verification in stream if it was triggered
  if (autoVerifyEnabled) {
    await streamContent({
      type: "text",
      text: `🔍 **Auto-verification enabled** (chain length: ${priorThoughts.length + 1} steps)\n`,
    });
  }

  // HALT ON VERIFICATION FAILURE
  if (!verificationResult.passed) {
    const mistakeResult = domain === "math" ? detectCommonMistakesFromText(thought) : null;
    const detectedMistakes = mistakeResult?.mistakes ?? [];

    // Build and store pending record
    const pendingRecord = buildPendingRecord({
      sessionId,
      branchId,
      stepNumber,
      thought,
      domain,
      verificationConfidence: verificationResult.confidence,
      compressionResult,
    });
    const verificationError = {
      issue: verificationResult.suggestions[0] || "Verification failed",
      evidence: verificationResult.evidence,
      suggestions: verificationResult.suggestions,
      confidence: verificationResult.confidence,
      domain,
    };
    SessionManager.setPendingThought(sessionId, pendingRecord, verificationError);

    // Stream failure and return response
    await streamVerificationFailure(
      streamContent,
      verificationResult,
      detectedMistakes,
      stepNumber,
    );
    return {
      passed: false,
      response: buildVerificationFailureResponse({
        sessionId,
        branchId,
        stepNumber,
        threshold,
        verificationResult,
        detectedMistakes,
        domain,
      }),
    };
  }

  return { passed: true, result: verificationResult };
}

// ============================================================================
// OPERATION HANDLERS
// ============================================================================

/** Handle step operation - add a new thought */
async function handleStep(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;

  // Runtime validation: thought is required for step operation
  if (!args.thought) {
    throw new Error("thought is required for step operation");
  }
  let thought = args.thought;

  // sessionId managed server-side
  const branchId = "main"; // Default branch for step operation
  const threshold = args.confidence_threshold ?? 0.8;
  const tokenBudget = args.token_budget ?? 3000;

  // S1: Token budget guard - check EARLY if session exceeds budget
  const tokenUsage = SessionManager.getTokenUsage(sessionId);
  const budgetExceeded = tokenUsage.total >= tokenBudget;

  // Compression - apply EARLY to reduce input tokens (before all other processing)
  const compression = await applyCompression(thought, args, budgetExceeded, streamContent);
  thought = compression.thought;
  const compressionResult = compression.result;
  const autoCompressed = compression.autoCompressed;

  // S3: Check max_step_tokens limit (after compression, so limit applies to compressed size)
  const maxStepTokens = args.max_step_tokens;
  if (maxStepTokens !== undefined && !args.force_large) {
    // Estimate tokens: ~4 chars per token
    const estimatedTokens = Math.ceil(thought.length / 4);
    if (estimatedTokens > maxStepTokens) {
      throw new Error(
        `Step exceeds max_step_tokens limit: ${estimatedTokens} > ${maxStepTokens}. ` +
          `Split into smaller steps or use force_large=true to override.`,
      );
    }
  }

  // Auto-increment step number
  const stepNumber = SessionManager.getNextStep(sessionId, branchId);

  // Handle trap priming if question provided
  const trapAnalysis = args.question
    ? await handleTrapPriming(args.question, sessionId, stepNumber, streamContent)
    : undefined;

  // Proactive stepping guidance: assess complexity on first step when question provided
  const steppingGuidance = await calculateSteppingGuidance(
    args.question,
    stepNumber,
    streamContent,
  );

  // Strip markdown and detect domain
  let strippedThought = stripMarkdown(thought);
  const domain = args.domain || detectDomain(strippedThought);

  // Pre-compute next step suggestion for math domain (before augmentation modifies text)
  let nextStepSuggestion: ScratchpadResponse["next_step_suggestion"];
  if (domain === "math") {
    const suggestion = suggestNextStepFromText(strippedThought);
    if (suggestion) {
      nextStepSuggestion = suggestion;
    }
  }

  // Try local compute FIRST if requested (before augmentation modifies the text)
  let computeResult = null;
  if (args.local_compute && isLikelyComputable(strippedThought)) {
    computeResult = tryLocalCompute(strippedThought);
    if (computeResult?.solved) {
      await streamContent({
        type: "text",
        text: `⚡ **Local Compute** (${computeResult.method})\n**Result:** ${computeResult.result}\n\n`,
      });
    }
  }

  // S2: Run augment_compute (default: true) - inject computed values into thought
  const shouldAugment = args.augment_compute !== false;
  const augmentation = await applyAugmentation(
    strippedThought,
    args.context,
    shouldAugment,
    streamContent,
  );
  strippedThought = augmentation.thought;
  const augmentationResult = augmentation.result;

  // Run verification (extracted to helper to reduce complexity)
  const verificationCheck = await runVerificationCheck(
    args,
    sessionId,
    branchId,
    stepNumber,
    strippedThought,
    domain,
    threshold,
    compressionResult,
    streamContent,
  );
  if (!verificationCheck.passed) {
    return verificationCheck.response;
  }
  const verificationResult = verificationCheck.result;

  // Stream the thought (only if verification passed or wasn't requested)
  await streamContent({
    type: "text",
    text: `**Step ${stepNumber}** [${args.purpose}]\n${strippedThought}\n`,
  });
  if (args.preconditions?.length) {
    await streamContent({
      type: "text",
      text: `📋 **Preconditions:** ${args.preconditions.join(", ")}\n`,
    });
  }
  if (args.outcome) {
    await streamContent({
      type: "text",
      text: `**Outcome:** ${args.outcome}\n`,
    });
  }

  // Build thought record
  const record: ThoughtRecord = {
    id: `${sessionId}:${branchId}:${stepNumber}`,
    step_number: stepNumber,
    thought: strippedThought,
    timestamp: Date.now(),
    branch_id: branchId,
    // Store preconditions if provided
    preconditions: args.preconditions,
    verification: verificationResult
      ? {
          passed: verificationResult.passed,
          confidence: args.confidence ?? verificationResult.confidence,
          domain,
        }
      : args.confidence !== undefined
        ? {
            passed: true, // Assume passed if confidence provided manually
            confidence: args.confidence,
            domain,
          }
        : undefined,
    // Track compression stats if compression was applied
    compression: compressionResult
      ? {
          input_bytes_saved:
            (compressionResult.original_tokens - compressionResult.compressed_tokens) * 4,
          output_bytes_saved: 0,
          context_bytes_saved: 0,
          original_tokens: compressionResult.original_tokens,
          compressed_tokens: compressionResult.compressed_tokens,
        }
      : undefined,
  };

  // Store thought
  const storeResult = SessionManager.addThought(sessionId, record);
  if (!storeResult.success) {
    throw new Error(storeResult.error || "Failed to store thought");
  }

  // Calculate confidence
  const confState = calculateConfidence(sessionId, branchId, args.confidence);
  const status = determineStatus(confState.chainConfidence, threshold, false);
  const suggestedAction = getSuggestedAction(status, confState.chainConfidence);

  // Build response
  const response: ScratchpadResponse = {
    session_id: sessionId,
    current_step: stepNumber,
    branch: branchId,
    operation: "step",
    step_confidence: confState.stepConfidence,
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action: suggestedAction,
  };

  // Add 5-second warning if threshold reached
  if (status === "threshold_reached") {
    response.auto_complete_warning =
      "⏱️ Confidence threshold reached. You have 5 seconds to continue or call complete. " +
      "After 5s, the chain will auto-complete if no further action is taken.";
    await streamContent({
      type: "text",
      text:
        `\n⚠️ **THRESHOLD REACHED** (${(confState.chainConfidence * 100).toFixed(0)}% ≥ ${threshold * 100}%)\n` +
        "Call `complete` operation or continue reasoning within 5 seconds.\n",
    });
  }

  // Enrich response with optional fields (extracted to reduce complexity)
  const updatedTokenUsage = SessionManager.getTokenUsage(sessionId);
  enrichStepResponse(response, {
    verificationResult,
    domain,
    computeResult,
    compressionResult,
    tokenUsage: updatedTokenUsage,
    tokenBudget,
    budgetExceeded,
    autoCompressed,
    augmentationResult,
    trapAnalysis,
    nextStepSuggestion,
    thoughtText: thought, // Pass thought text for token estimation
  });

  // Stream next step suggestion if available
  if (nextStepSuggestion?.hasSuggestion) {
    await streamContent({
      type: "text",
      text: `💡 **Next step:** ${nextStepSuggestion.description}\n`,
    });
  }

  // Add stepping guidance if available (from first step complexity assessment)
  if (steppingGuidance) {
    response.stepping_guidance = steppingGuidance;
  }

  // Stream compression suggestion if present
  if (response.compression_suggestion) {
    await streamContent({
      type: "text",
      text: `📦 ${response.compression_suggestion.nudge}\n`,
    });
  }

  // S3: Step-level Confidence Drift Detection (CDD)
  // Extracted to helper function to reduce cyclomatic complexity
  const cddResult = await runStepLevelCDD(sessionId, branchId, streamContent);
  if (cddResult) {
    response.confidence_drift = cddResult;
  }

  // Adaptive spot-check: Auto-trigger when CDD detects unresolved drift
  // This catches trap patterns early, before complete() is called
  const adaptiveSpotCheck = await runAdaptiveSpotCheck(
    sessionId,
    strippedThought,
    cddResult,
    streamContent,
  );
  if (adaptiveSpotCheck) {
    response.spot_check_result = adaptiveSpotCheck;
    // Upgrade status to "review" if spot-check found a trap
    if (!adaptiveSpotCheck.passed) {
      response.status = "review";
      response.suggested_action = `Potential ${adaptiveSpotCheck.trap_type} trap detected. ${adaptiveSpotCheck.hint || "Reconsider your approach."}`;
    }
  }

  // Consistency check: Run every 3 steps to catch contradictions early
  const consistencyWarning = await runConsistencyCheck(
    sessionId,
    branchId,
    stepNumber,
    strippedThought,
    streamContent,
  );
  if (consistencyWarning) {
    response.consistency_warning = consistencyWarning;
  }

  // Hypothesis resolution: Check if branch hypothesis has been resolved
  const { resolution, mergeSuggestion } = await runHypothesisResolution(
    sessionId,
    branchId,
    stepNumber,
    strippedThought,
    streamContent,
  );
  if (resolution) {
    response.hypothesis_resolution = resolution;
  }
  if (mergeSuggestion) {
    response.merge_suggestion = mergeSuggestion;
  }

  // Auto-challenge: Suggest adversarial review on overconfidence
  const hasVerification = !!verificationResult?.passed;
  const challengeSuggestion = await runAutoChallenge(
    confState.chainConfidence,
    stepNumber,
    hasVerification,
    streamContent,
  );
  if (challengeSuggestion) {
    response.challenge_suggestion = challengeSuggestion;
  }

  return response;
}

/** Handle navigate operation - view history/branches/steps/paths */
async function handleNavigate(
  args: ScratchpadArgs,
  _ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  // sessionId passed from server-side management

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = args.branch_id || "main";
  const confState = calculateConfidence(sessionId, branchId);
  const status = determineStatus(confState.chainConfidence, threshold, false);

  const response: ScratchpadResponse = {
    session_id: sessionId,
    current_step: SessionManager.getCurrentStep(sessionId, branchId),
    branch: branchId,
    operation: "navigate",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action: getSuggestedAction(status, confState.chainConfidence),
  };

  switch (args.view) {
    case "history": {
      const thoughts = SessionManager.getThoughts(sessionId, args.branch_id);
      const limited = thoughts.slice(-(args.limit || 10));
      response.history = limited.map((t) => ({
        step: t.step_number,
        branch: t.branch_id,
        purpose: "analysis", // Default since we don't store purpose currently
        thought_preview: t.thought.slice(0, 80) + (t.thought.length > 80 ? "..." : ""),
        confidence: t.verification?.confidence,
        revised_by: t.revised_by,
      }));
      break;
    }

    case "branches": {
      const branches = SessionManager.getBranches(sessionId);
      response.branches = branches.map((b) => ({
        id: b.id,
        name: b.name,
        from_step: b.from_step,
        depth: b.depth,
        hypothesis: b.hypothesis,
        success_criteria: b.success_criteria,
      }));
      break;
    }

    case "step": {
      if (!args.step_id) {
        throw new Error("step_id required for step view");
      }
      const step = SessionManager.getStep(sessionId, args.step_id);
      if (!step) {
        throw new Error(`Step not found: ${args.step_id}`);
      }
      response.step_detail = {
        step: step.step_number,
        branch: step.branch_id,
        purpose: "analysis",
        thought: step.thought,
        outcome: undefined, // Not stored currently
        confidence: step.verification?.confidence,
        revises_step: step.revises_step,
        revised_by: step.revised_by,
        preconditions: step.preconditions,
        hypothesis: step.hypothesis,
        success_criteria: step.success_criteria,
      };
      break;
    }

    case "path": {
      if (!args.step_id) {
        throw new Error("step_id required for path view");
      }
      const path = SessionManager.getPath(sessionId, args.step_id);
      response.path = path.map((t) => ({
        step: t.step_number,
        branch: t.branch_id,
        thought_preview: t.thought.slice(0, 60) + (t.thought.length > 60 ? "..." : ""),
      }));
      break;
    }
  }

  return response;
}

/** Handle branch operation - start alternative reasoning path */
async function handleBranch(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;

  if (!sessionId) {
    throw new Error("session_id required for branch operation");
  }
  if (!args.thought) {
    throw new Error("thought is required for branch operation");
  }
  // sessionId managed server-side
  const thought = args.thought;

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;

  // Clear any pending verification failure (branching abandons the failed step)
  const hadPending = SessionManager.clearPendingThought(sessionId);

  // Determine branch point
  const fromStep = args.from_step ?? SessionManager.getCurrentStep(sessionId, "main");
  const branchId = `branch-${crypto.randomUUID()}`;
  const branchName = args.branch_name || `Alternative from step ${fromStep}`;

  // Auto-increment step number for new branch
  const stepNumber = fromStep + 1;

  // Strip markdown and detect domain BEFORE augmentation
  let strippedThought = stripMarkdown(thought);
  const domain = detectDomain(strippedThought);

  // Pre-compute next step suggestion for math domain (before augmentation modifies text)
  let nextStepSuggestion: ScratchpadResponse["next_step_suggestion"];
  if (domain === "math") {
    const suggestion = suggestNextStepFromText(strippedThought);
    if (suggestion) {
      nextStepSuggestion = suggestion;
    }
  }

  // Auto-augment (default: true)
  let augmentationResult: {
    applied: boolean;
    computations: number;
    filtered: number;
    domain: string;
  } | null = null;

  const shouldAugment = args.augment_compute !== false;

  if (shouldAugment) {
    const augResult = contextAwareCompute({
      thought: strippedThought,
      systemPrompt: args.context,
    });

    if (augResult.hasComputations) {
      strippedThought = augResult.augmented;
      augmentationResult = {
        applied: true,
        computations: augResult.computations.length,
        filtered: augResult.filteredCount,
        domain: augResult.domain,
      };
      await streamContent({
        type: "text",
        text: `⚡ **Augmented** ${augResult.computations.length} computations (${augResult.domain})\n`,
      });
    }
  }

  // Stream branch creation
  const pendingNote = hadPending ? " (abandoning failed verification step)" : "";
  const hypothesisNote = args.hypothesis ? `\n   📊 Hypothesis: ${args.hypothesis}` : "";
  const criteriaNote = args.success_criteria
    ? `\n   ✅ Success criteria: ${args.success_criteria}`
    : "";
  await streamContent({
    type: "text",
    text:
      `🌿 **New Branch:** ${branchName}${pendingNote}\n` +
      `   From step ${fromStep} → Step ${stepNumber}${hypothesisNote}${criteriaNote}\n\n`,
  });

  // Stream the thought
  await streamContent({
    type: "text",
    text: `**Step ${stepNumber}** [${args.purpose}]\n${strippedThought}\n`,
  });

  // Build thought record with branch info
  const record: ThoughtRecord = {
    id: `${sessionId}:${branchId}:${stepNumber}`,
    step_number: stepNumber,
    thought: strippedThought,
    timestamp: Date.now(),
    branch_id: branchId,
    branch_from: fromStep,
    branch_name: branchName,
    // Hypothesis-driven branching
    hypothesis: args.hypothesis,
    success_criteria: args.success_criteria,
  };

  // Store thought
  const storeResult = SessionManager.addThought(sessionId, record);
  if (!storeResult.success) {
    throw new Error(storeResult.error || "Failed to store branch thought");
  }

  // Calculate confidence for new branch
  const confState = calculateConfidence(sessionId, branchId);
  const status = determineStatus(confState.chainConfidence, threshold, false);

  const response: ScratchpadResponse = {
    session_id: sessionId,
    current_step: stepNumber,
    branch: branchId,
    operation: "branch",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action: args.hypothesis
      ? `Branch "${branchName}" created to test: "${args.hypothesis}". Continue reasoning to prove/disprove.`
      : `Branch "${branchName}" created. Continue reasoning on this alternative path.`,
  };

  // Add augmentation info
  if (augmentationResult) {
    response.augmentation = augmentationResult;
  }

  // Add next step suggestion for math domain (computed before augmentation)
  if (nextStepSuggestion) {
    response.next_step_suggestion = nextStepSuggestion;
    if (nextStepSuggestion.hasSuggestion) {
      await streamContent({
        type: "text",
        text: `💡 **Next step:** ${nextStepSuggestion.description}\n`,
      });
    }
  }

  return response;
}

/** Handle revise operation - correct earlier step */
async function handleRevise(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;

  // Runtime validation: required fields for revise operation
  if (!sessionId) {
    throw new Error("session_id required for revise operation");
  }
  if (!args.thought) {
    throw new Error("thought is required for revise operation");
  }
  if (args.target_step === undefined) {
    throw new Error("target_step is required for revise operation");
  }
  // sessionId managed server-side
  const thought = args.thought;
  const targetStep = args.target_step;

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = "main"; // Revisions go on main branch

  // Check if revising a pending (failed verification) step
  const pending = SessionManager.getPendingThought(sessionId);
  const isRevisingPending = pending && targetStep === pending.thought.step_number;

  // If not revising pending, validate target step exists in stored thoughts
  if (!isRevisingPending) {
    const existingStep = SessionManager.getStep(sessionId, targetStep);
    if (!existingStep) {
      throw new Error(`Target step not found: ${targetStep}`);
    }
  }

  // Clear pending if we're revising it (the revision replaces it)
  if (isRevisingPending) {
    SessionManager.clearPendingThought(sessionId);
  }

  // Use the same step number if revising pending, otherwise auto-increment
  const stepNumber = isRevisingPending
    ? pending.thought.step_number
    : SessionManager.getNextStep(sessionId, branchId);

  // Strip markdown
  let strippedThought = stripMarkdown(thought);
  const domain = detectDomain(strippedThought);

  // Pre-compute next step suggestion for math domain (before augmentation modifies text)
  let nextStepSuggestion: ScratchpadResponse["next_step_suggestion"];
  if (domain === "math") {
    const suggestion = suggestNextStepFromText(strippedThought);
    if (suggestion) {
      nextStepSuggestion = suggestion;
    }
  }

  // Auto-augment (default: true)
  let augmentationResult: {
    applied: boolean;
    computations: number;
    filtered: number;
    domain: string;
  } | null = null;

  const shouldAugment = args.augment_compute !== false;

  if (shouldAugment) {
    const augResult = contextAwareCompute({
      thought: strippedThought,
      systemPrompt: args.context,
    });

    if (augResult.hasComputations) {
      strippedThought = augResult.augmented;
      augmentationResult = {
        applied: true,
        computations: augResult.computations.length,
        filtered: augResult.filteredCount,
        domain: augResult.domain,
      };
      await streamContent({
        type: "text",
        text: `⚡ **Augmented** ${augResult.computations.length} computations (${augResult.domain})\n`,
      });
    }
  }

  // Stream revision
  const revisingLabel = isRevisingPending ? " (replacing failed verification)" : "";
  await streamContent({
    type: "text",
    text:
      `📝 **Revising Step ${targetStep}**${revisingLabel}\n` +
      `   Reason: ${args.reason ?? "correction"}\n\n` +
      `**Step ${stepNumber}** [correction]\n${strippedThought}\n`,
  });

  // Build thought record with revision info
  const record: ThoughtRecord = {
    id: `${sessionId}:${branchId}:${stepNumber}`,
    step_number: stepNumber,
    thought: strippedThought,
    timestamp: Date.now(),
    branch_id: branchId,
    revises_step: isRevisingPending ? undefined : targetStep, // Don't mark as revision if replacing pending
    revision_reason: args.reason,
    verification:
      args.confidence !== undefined
        ? {
            passed: true,
            confidence: args.confidence,
            domain,
          }
        : undefined,
  };

  // Store thought
  const storeResult = SessionManager.addThought(sessionId, record);
  if (!storeResult.success) {
    throw new Error(storeResult.error || "Failed to store revision");
  }

  // Calculate confidence
  const confState = calculateConfidence(sessionId, branchId, args.confidence);
  const status = determineStatus(confState.chainConfidence, threshold, false);

  const response: ScratchpadResponse = {
    session_id: sessionId,
    current_step: stepNumber,
    branch: branchId,
    operation: "revise",
    step_confidence: confState.stepConfidence,
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action: `Revised step ${targetStep}. Continue reasoning with corrected understanding.`,
  };

  // Add augmentation info
  if (augmentationResult) {
    response.augmentation = augmentationResult;
  }

  // Add next step suggestion for math domain (computed before augmentation)
  if (nextStepSuggestion) {
    response.next_step_suggestion = nextStepSuggestion;
    if (nextStepSuggestion.hasSuggestion) {
      await streamContent({
        type: "text",
        text: `💡 **Next step:** ${nextStepSuggestion.description}\n`,
      });
    }
  }

  return response;
}

/** Handle complete operation - finalize reasoning chain */
async function handleComplete(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  // sessionId managed server-side
  if (!sessionId) {
    throw new Error("session_id required for complete operation");
  }

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = "main";

  // Get final stats - filter to main branch only for accurate analysis
  const allThoughts = SessionManager.getThoughts(sessionId);
  const thoughts = allThoughts.filter((t) => !t.branch_id || t.branch_id === branchId);
  const confState = calculateConfidence(sessionId, branchId);
  const compressionStats = SessionManager.getCompressionStats(sessionId);

  // Stream completion
  await streamContent({
    type: "text",
    text:
      `✅ **Reasoning Complete**\n` +
      `   Total steps: ${thoughts.length}\n` +
      `   Chain confidence: ${(confState.chainConfidence * 100).toFixed(0)}%\n`,
  });

  if (compressionStats && compressionStats.totalBytesSaved > 0) {
    await streamContent({
      type: "text",
      text: `   Compression: ${compressionStats.stepCount} steps, ${compressionStats.totalBytesSaved} bytes saved\n`,
    });
  }

  if (args.summary) {
    await streamContent({
      type: "text",
      text: `\n**Summary:** ${args.summary}\n`,
    });
  }
  if (args.final_answer) {
    await streamContent({
      type: "text",
      text: `**Answer:** ${args.final_answer}\n`,
    });
  }

  // Auto spot-check if question and final_answer provided
  // Use stored question from step operation if not provided directly
  const questionForSpotCheck = args.question || SessionManager.getQuestion(sessionId);
  let spotCheckResult:
    | {
        passed: boolean;
        trapType: string | null;
        warning: string | null;
        hint: string | null;
        confidence: number;
      }
    | undefined;
  let needsReconsideration = false;

  if (questionForSpotCheck && args.final_answer) {
    spotCheckResult = spotCheck(questionForSpotCheck, args.final_answer);
    if (!spotCheckResult.passed) {
      needsReconsideration = true;
      await streamContent({
        type: "text",
        text:
          `\n⚠️ **Spot-check warning:** ${spotCheckResult.trapType}\n` +
          (spotCheckResult.warning ? `   ${spotCheckResult.warning}\n` : "") +
          (spotCheckResult.hint ? `   💡 ${spotCheckResult.hint}\n` : "") +
          `\n🔄 **Reconsideration recommended:** Your answer may have fallen for a cognitive trap.\n` +
          `   Call \`revise\` with target_step=${thoughts.length} to reconsider your final reasoning.\n`,
      });
    }
  }

  // Confidence Drift Detection (CDD) - analyze trajectory for unresolved uncertainty
  const driftAnalysis = analyzeConfidenceDrift(thoughts);
  if (driftAnalysis.pattern !== "insufficient") {
    // Stream drift analysis if concerning
    if (driftAnalysis.unresolved) {
      needsReconsideration = true;
      await streamContent({
        type: "text",
        text:
          `\n⚠️ **Confidence Drift Warning:** ${driftAnalysis.explanation}\n` +
          (driftAnalysis.suggestion ? `   💡 ${driftAnalysis.suggestion}\n` : "") +
          `   Pattern: ${driftAnalysis.pattern}, Drift score: ${(driftAnalysis.drift_score * 100).toFixed(0)}%\n`,
      });
    } else if (driftAnalysis.pattern !== "stable") {
      // Informational for non-stable patterns
      await streamContent({
        type: "text",
        text: `   Confidence pattern: ${driftAnalysis.pattern}\n`,
      });
    }
  }

  // Determine final status - "review" if spot-check failed or unresolved drift, otherwise "complete"
  const finalStatus = needsReconsideration ? "review" : "complete";
  let suggestedAction: string;
  if (needsReconsideration) {
    if (driftAnalysis.unresolved) {
      suggestedAction = `Unresolved confidence drift detected (${driftAnalysis.pattern} pattern). ${driftAnalysis.suggestion || `Review step ${driftAnalysis.min_step} where confidence dropped.`}`;
    } else if (spotCheckResult?.trapType) {
      suggestedAction = `Potential ${spotCheckResult.trapType} trap detected. Call revise(target_step=${thoughts.length}, reason="${spotCheckResult.hint || "Reconsider approach"}") to fix.`;
    } else {
      suggestedAction = "Review recommended before finalizing.";
    }
  } else {
    suggestedAction = "Reasoning chain finalized.";
  }

  const response: ScratchpadResponse = {
    session_id: sessionId,
    current_step: SessionManager.getCurrentStep(sessionId, branchId),
    branch: branchId,
    operation: "complete",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status: finalStatus,
    suggested_action: suggestedAction,
    final_summary: args.summary,
    total_steps: thoughts.length,
  };

  // Add spot-check result if we ran it
  if (spotCheckResult) {
    response.spot_check_result = {
      passed: spotCheckResult.passed,
      trap_type: spotCheckResult.trapType,
      warning: spotCheckResult.warning,
      hint: spotCheckResult.hint,
      confidence: spotCheckResult.confidence,
    };

    // Add reconsideration prompt if trap detected
    if (needsReconsideration && spotCheckResult.trapType && spotCheckResult.hint) {
      response.reconsideration = {
        trap_type: spotCheckResult.trapType,
        hint: spotCheckResult.hint,
        suggested_revise: {
          target_step: thoughts.length,
          reason: `Potential ${spotCheckResult.trapType} trap: ${spotCheckResult.hint}`,
        },
      };
    }
  }

  // Add compression stats if any compression occurred
  if (compressionStats && compressionStats.totalBytesSaved > 0) {
    response.compression_stats = {
      total_bytes_saved: compressionStats.totalBytesSaved,
      steps_compressed: compressionStats.stepCount,
      tokens:
        compressionStats.tokens.original > 0
          ? {
              original: compressionStats.tokens.original,
              compressed: compressionStats.tokens.compressed,
              saved: compressionStats.tokens.saved,
            }
          : undefined,
    };
  }

  // Add confidence drift analysis (always include for complete operation)
  if (driftAnalysis.pattern !== "insufficient") {
    response.confidence_drift = {
      drift_score: driftAnalysis.drift_score,
      unresolved: driftAnalysis.unresolved,
      min_confidence: driftAnalysis.min_confidence,
      min_step: driftAnalysis.min_step,
      max_drop: driftAnalysis.max_drop,
      recovery: driftAnalysis.recovery,
      has_revision_after_drop: driftAnalysis.has_revision_after_drop,
      pattern: driftAnalysis.pattern,
      explanation: driftAnalysis.explanation,
      suggestion: driftAnalysis.suggestion,
    };
  }

  return response;
}

/** Handle augment operation - extract, compute, and inject math results */
async function handleAugment(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;

  // Runtime validation: text is required for augment operation
  if (!args.text) {
    throw new Error("text is required for augment operation");
  }
  const text = args.text;

  // sessionId managed server-side
  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = "main";

  // Run context-aware computation
  const computeResult = contextAwareCompute({
    thought: text,
    systemPrompt: args.system_context,
  });

  // Stream result
  if (computeResult.hasComputations) {
    await streamContent({
      type: "text",
      text:
        `⚡ **Augmented** (${computeResult.computations.length} computations, ` +
        `${computeResult.filteredCount} filtered by domain)\n` +
        `Domain: ${computeResult.domain}\n\n`,
    });
    await streamContent({
      type: "text",
      text: `**Result:**\n${computeResult.augmented}\n`,
    });
  } else {
    await streamContent({
      type: "text",
      text: "No computable expressions found.\n",
    });
  }

  // Optionally store as a step
  let stepNumber = 0;
  if (args.store_as_step) {
    stepNumber = SessionManager.getNextStep(sessionId, branchId);
    const record: ThoughtRecord = {
      id: `${sessionId}:${branchId}:${stepNumber}`,
      step_number: stepNumber,
      thought: computeResult.augmented,
      timestamp: Date.now(),
      branch_id: branchId,
    };
    SessionManager.addThought(sessionId, record);
  }

  // Calculate confidence for session
  const confState = calculateConfidence(sessionId, branchId);
  const status = determineStatus(confState.chainConfidence, threshold, false);

  return {
    session_id: sessionId,
    current_step: stepNumber,
    branch: branchId,
    operation: "augment",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action: computeResult.hasComputations
      ? `Augmented ${computeResult.computations.length} expressions. Use store_as_step=true to add to reasoning chain.`
      : "No computations found. Text returned unchanged.",
    augmented_text: computeResult.augmented,
    computations: computeResult.computations.map((c) => ({
      expression: c.original,
      result: c.result,
      method: c.method,
    })),
    filtered_count: computeResult.filteredCount,
    detected_domain: computeResult.domain,
  };
}

/** Handle override operation - commit a failed verification step anyway */
async function handleOverride(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  // sessionId managed server-side
  if (!sessionId) {
    throw new Error("session_id required for override operation");
  }

  const threshold = args.confidence_threshold ?? 0.8;

  // Check for pending thought
  const pending = SessionManager.getPendingThought(sessionId);
  if (!pending) {
    throw new Error(
      `No pending verification failure to override. ` +
        `Use override only after a step fails verification.`,
    );
  }

  // Validate the failed_step matches
  if (args.failed_step !== pending.thought.step_number) {
    throw new Error(
      `failed_step (${args.failed_step}) doesn't match pending step (${pending.thought.step_number})`,
    );
  }

  // Commit the pending thought
  const commitResult = SessionManager.commitPendingThought(sessionId);
  if (!commitResult.success) {
    throw new Error(commitResult.error || "Failed to commit overridden step");
  }

  const branchId = pending.thought.branch_id;

  // Stream override notice
  await streamContent({
    type: "text",
    text:
      `✓ **OVERRIDE ACCEPTED**\n` +
      `Step ${args.failed_step} committed despite verification failure.\n` +
      `Reason: ${args.reason}\n\n` +
      `**Note:** This step is marked as verification-failed in the chain.\n`,
  });

  // Calculate confidence
  const confState = calculateConfidence(sessionId, branchId);
  const status = determineStatus(confState.chainConfidence, threshold, false);

  return {
    session_id: sessionId,
    current_step: pending.thought.step_number,
    branch: branchId,
    operation: "override",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action: `Step ${args.failed_step} committed. Continue reasoning.`,
    verification: {
      passed: false,
      confidence: pending.verificationError.confidence,
      domain: pending.verificationError.domain,
    },
  };
}

/** Handle hint operation - progressive simplification hints with session state */
async function handleHint(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  // sessionId managed server-side
  const threshold = args.confidence_threshold ?? 0.8;
  const { cumulative = true, reset = false } = args;

  // Check for existing hint state
  const existingState = reset ? null : SessionManager.getHintState(sessionId);

  // Determine expression and reveal count
  let expression: string;
  let revealCount: number;

  if (args.expression) {
    // New expression provided - start fresh or continue if same expression
    expression = args.expression;
    if (existingState && existingState.expression === expression && !reset) {
      // Same expression - auto-increment if no reveal_count specified
      revealCount = args.reveal_count ?? existingState.revealCount + 1;
    } else {
      // Different expression or reset - start fresh
      revealCount = args.reveal_count ?? 1;
    }
  } else if (existingState) {
    // No expression but have state - continue from previous
    expression = existingState.expression;
    revealCount = args.reveal_count ?? existingState.revealCount + 1;
  } else {
    // No expression and no state - error
    await streamContent({
      type: "text",
      text: `❌ No expression provided and no previous hint state in session.\n`,
    });

    return {
      session_id: sessionId,
      current_step: 0,
      branch: "main",
      operation: "hint",
      chain_confidence: 0,
      confidence_threshold: threshold,
      steps_with_confidence: 0,
      status: "continue",
      suggested_action: "Provide an expression to get hints.",
      hint_result: {
        success: false,
        original: "",
        simplified: "",
        steps_shown: 0,
        total_steps: 0,
        steps: [],
        has_more: false,
      },
    };
  }

  // Get full simplification path
  const pathResult = suggestSimplificationPath(expression);

  if (!pathResult.success) {
    // Clear any existing state for this failed expression
    SessionManager.clearHintState(sessionId);

    await streamContent({
      type: "text",
      text: `❌ Could not parse expression: "${expression}"\n`,
    });

    return {
      session_id: sessionId,
      current_step: 0,
      branch: "main",
      operation: "hint",
      chain_confidence: 0,
      confidence_threshold: threshold,
      steps_with_confidence: 0,
      status: "continue",
      suggested_action: "Expression could not be parsed. Check syntax.",
      hint_result: {
        success: false,
        original: expression,
        simplified: expression,
        steps_shown: 0,
        total_steps: 0,
        steps: [],
        has_more: false,
      },
    };
  }

  const totalSteps = pathResult.steps.length;
  const stepsToShow = Math.min(revealCount, totalSteps);

  // Store hint state for future calls
  SessionManager.setHintState(sessionId, {
    expression,
    revealCount: stepsToShow,
    totalSteps,
    simplified: pathResult.simplified,
  });

  // Build steps array
  const visibleSteps: SimplificationStep[] = (
    cumulative
      ? pathResult.steps.slice(0, stepsToShow)
      : stepsToShow > 0
        ? [pathResult.steps[stepsToShow - 1]]
        : []
  ).filter((s: SimplificationStep | undefined): s is SimplificationStep => s !== undefined);

  // Get the result at the revealed step
  const lastStep =
    stepsToShow > 0 && stepsToShow <= totalSteps ? pathResult.steps[stepsToShow - 1] : undefined;
  const currentSimplified = lastStep?.after ?? expression;

  // Stream the hint
  const isContinuing = existingState?.expression === expression;
  if (totalSteps === 0) {
    await streamContent({
      type: "text",
      text: `✓ Expression "${expression}" is already simplified.\n`,
    });
  } else {
    const continueLabel = isContinuing ? " (continued)" : "";
    await streamContent({
      type: "text",
      text: `💡 **Simplification Hint${continueLabel}** (step ${stepsToShow}/${totalSteps})\n\n`,
    });

    for (const step of visibleSteps) {
      await streamContent({
        type: "text",
        text:
          `**Step ${step.step}:** ${step.transformation}\n` +
          `  ${step.before} → ${step.after}\n` +
          `  _${step.description}_\n\n`,
      });
    }

    if (stepsToShow < totalSteps) {
      await streamContent({
        type: "text",
        text: `_${totalSteps - stepsToShow} more step(s) available. Call hint again to reveal next step._\n`,
      });
    } else {
      await streamContent({
        type: "text",
        text: `✓ **Final simplified form:** ${pathResult.simplified}\n`,
      });
    }
  }

  return {
    session_id: sessionId,
    current_step: 0,
    branch: "main",
    operation: "hint",
    chain_confidence: 0,
    confidence_threshold: threshold,
    steps_with_confidence: 0,
    status: "continue",
    suggested_action:
      stepsToShow < totalSteps
        ? `${totalSteps - stepsToShow} more steps available. Call hint again to continue.`
        : "Expression fully simplified",
    hint_result: {
      success: true,
      original: expression,
      simplified: currentSimplified,
      steps_shown: stepsToShow,
      total_steps: totalSteps,
      steps: visibleSteps.map((s: SimplificationStep) => ({
        step_number: s.step,
        transformation: s.transformation,
        description: s.description,
        from: s.before,
        to: s.after,
      })),
      has_more: stepsToShow < totalSteps,
    },
  };
}

/** Handle mistakes operation - proactive error checking for math derivations */
async function handleMistakes(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;

  // Runtime validation: text is required for mistakes operation
  if (!args.text) {
    throw new Error("text is required for mistakes operation");
  }
  const text = args.text;

  // sessionId managed server-side
  const threshold = args.confidence_threshold ?? 0.8;

  // Run mistake detection
  const result = detectCommonMistakesFromText(text);
  const mistakes = result?.mistakes ?? [];
  const mistakesFound = mistakes.length;

  // Stream results
  if (mistakesFound === 0) {
    await streamContent({
      type: "text",
      text: `✓ **No common algebraic mistakes detected**\n\n_Note: This checks for sign errors, distribution errors, exponent mistakes, etc. It doesn't guarantee correctness._\n`,
    });
  } else {
    await streamContent({
      type: "text",
      text: `⚠️ **Found ${mistakesFound} potential algebraic mistake${mistakesFound > 1 ? "s" : ""}:**\n\n`,
    });

    for (const m of mistakes) {
      await streamContent({
        type: "text",
        text: `• **${m.type}**: ${m.explanation}\n`,
      });
      if (m.suggestedFix) {
        await streamContent({
          type: "text",
          text: `  **Corrected:** \`${m.suggestedFix}\`\n`,
        });
      } else if (m.suggestion) {
        await streamContent({
          type: "text",
          text: `  _Fix: ${m.suggestion}_\n`,
        });
      }
    }
  }

  return {
    session_id: sessionId,
    current_step: 0,
    branch: "main",
    operation: "mistakes",
    chain_confidence: 0,
    confidence_threshold: threshold,
    steps_with_confidence: 0,
    status: "continue",
    suggested_action:
      mistakesFound > 0
        ? `Found ${mistakesFound} potential mistake(s). Review and revise if needed.`
        : "No common mistakes detected.",
    mistakes_result: {
      text_checked: text.slice(0, 200) + (text.length > 200 ? "..." : ""),
      mistakes_found: mistakesFound,
      mistakes: mistakes.map((m: DetectedMistake) => ({
        type: m.type,
        description: m.explanation,
        fix: m.suggestion,
        corrected_step: m.suggestedFix,
      })),
    },
  };
}

/** Handle spot_check operation - detect trap patterns in answers */
async function handleSpotCheck(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;

  // Runtime validation: question and answer are required for spot_check operation
  if (!args.question) {
    throw new Error("question is required for spot_check operation");
  }
  if (!args.answer) {
    throw new Error("answer is required for spot_check operation");
  }
  const question = args.question;
  const answer = args.answer;

  // sessionId managed server-side
  const threshold = args.confidence_threshold ?? 0.8;

  // Run spot-check
  const result = spotCheck(question, answer);

  // Stream results
  if (result.passed) {
    await streamContent({
      type: "text",
      text: `✓ **No trap patterns detected**\n\n_Answer "${answer}" does not match known cognitive trap patterns for this question type._\n`,
    });
  } else {
    await streamContent({
      type: "text",
      text: `⚠️ **Potential trap detected: ${result.trapType}**\n\n`,
    });
    if (result.warning) {
      await streamContent({
        type: "text",
        text: `**Warning:** ${result.warning}\n`,
      });
    }
    if (result.hint) {
      await streamContent({
        type: "text",
        text: `**Hint:** ${result.hint}\n`,
      });
    }
    await streamContent({
      type: "text",
      text: `\n_Consider rechecking your reasoning before finalizing this answer._\n`,
    });
  }

  return {
    session_id: sessionId,
    current_step: 0,
    branch: "main",
    operation: "spot_check",
    chain_confidence: 0,
    confidence_threshold: threshold,
    steps_with_confidence: 0,
    status: result.passed ? "continue" : "review",
    suggested_action: result.passed
      ? "No trap patterns detected. Answer appears safe."
      : `Potential ${result.trapType} trap detected. Review reasoning before finalizing.`,
    spot_check_result: {
      passed: result.passed,
      trap_type: result.trapType,
      warning: result.warning,
      hint: result.hint,
      confidence: result.confidence,
    },
  };
}

/** Handle challenge operation - adversarial self-check for reasoning quality */
async function handleChallenge(
  args: ScratchpadArgs,
  ctx: MCPContext,
  sessionId: string,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  // sessionId managed server-side
  if (!sessionId) {
    throw new Error("session_id required for challenge operation");
  }

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = args.branch_id || "main";

  // Get thoughts from session
  const thoughts = SessionManager.getThoughts(sessionId, branchId);
  if (thoughts.length === 0) {
    await streamContent({
      type: "text",
      text: "⚠️ No reasoning steps to challenge. Add steps first.\n",
    });

    return {
      session_id: sessionId,
      current_step: 0,
      branch: branchId,
      operation: "challenge",
      chain_confidence: 0,
      confidence_threshold: threshold,
      steps_with_confidence: 0,
      status: "continue",
      suggested_action: "Add reasoning steps before running challenge.",
      challenge_result: {
        challenges_generated: 0,
        challenges: [],
        overall_robustness: 1.0,
        summary: "No steps to challenge.",
      },
    };
  }

  // Convert to format expected by challenge function
  const stepData = thoughts.map((t) => ({
    step: t.step_number,
    thought: t.thought,
  }));

  // Run challenge with optional target claim
  const result = challenge(stepData, args.target_claim);

  // Stream results
  if (result.challenges_generated === 0) {
    await streamContent({
      type: "text",
      text:
        `✓ **No significant challenges found**\n` +
        `Robustness: ${(result.overall_robustness * 100).toFixed(0)}%\n\n` +
        `_Reasoning appears robust against common counterarguments._\n`,
    });
  } else {
    const highCount = result.challenges.filter((c) => c.severity === "high").length;
    const medCount = result.challenges.filter((c) => c.severity === "medium").length;

    await streamContent({
      type: "text",
      text:
        `⚡ **Adversarial Challenge Results**\n` +
        `   Challenges: ${result.challenges_generated} (${highCount} high, ${medCount} medium)\n` +
        `   Robustness: ${(result.overall_robustness * 100).toFixed(0)}%\n\n`,
    });

    // Group by severity for better readability
    const severityOrder = ["high", "medium", "low"] as const;
    for (const severity of severityOrder) {
      const challengesOfSeverity = result.challenges.filter((c) => c.severity === severity);
      if (challengesOfSeverity.length === 0) continue;

      const emoji = severity === "high" ? "🔴" : severity === "medium" ? "🟡" : "🟢";
      await streamContent({
        type: "text",
        text: `**${emoji} ${severity.toUpperCase()} Severity:**\n`,
      });

      for (const c of challengesOfSeverity) {
        await streamContent({
          type: "text",
          text:
            `• **${c.type}**: ${c.challenge}\n` +
            `  _Claim: "${c.original_claim.slice(0, 60)}${c.original_claim.length > 60 ? "..." : ""}"_\n` +
            `  💡 ${c.suggested_response}\n\n`,
        });
      }
    }
  }

  // Calculate confidence for session
  const confState = calculateConfidence(sessionId, branchId);
  const status =
    result.challenges.filter((c) => c.severity === "high").length > 0 ? "review" : "continue";

  return {
    session_id: sessionId,
    current_step: SessionManager.getCurrentStep(sessionId, branchId),
    branch: branchId,
    operation: "challenge",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status,
    suggested_action:
      result.challenges_generated === 0
        ? "Reasoning appears robust. Proceed to complete."
        : result.challenges.filter((c) => c.severity === "high").length > 0
          ? `Found ${result.challenges.filter((c) => c.severity === "high").length} high-severity challenge(s). Address before finalizing.`
          : `Found ${result.challenges_generated} challenge(s). Consider addressing before completion.`,
    challenge_result: {
      challenges_generated: result.challenges_generated,
      challenges: result.challenges.map((c) => ({
        type: c.type,
        original_claim: c.original_claim,
        challenge: c.challenge,
        severity: c.severity,
        suggested_response: c.suggested_response,
      })),
      overall_robustness: result.overall_robustness,
      summary: result.summary,
    },
  };
}

// ============================================================================
// SCRATCHPAD TOOL
// ============================================================================

export const scratchpadTool = {
  name: "scratchpad",
  description: `Structured reasoning w/verification, trap detection, self-challenge. []=optional

OPS (required: operation=):
step thought= [question=1st] [confidence=] [verify=] [compress=true] [compression_query=]→add step. Auto-verify@4+. Disable compress to keep full text.
complete [final_answer=] [summary=]→finalize+spot-check
revise target_step= thought= [reason=]→fix step
branch thought= [from_step=] [hypothesis=] [success_criteria=]→fork path
navigate view=history|branches|step|path [step_id=] [limit=10]→inspect
augment text= [store_as_step=false]→compute+inject math
hint [expression=] [reveal_count=] [cumulative=true] [reset=false]→progressive hints (auto-continues)
mistakes text=→check algebraic errors
spot_check question= answer=→manual trap detect
challenge [target_claim=] [challenge_type=all]→adversarial check
override failed_step= [reason=]→force-commit

DEFAULTS: session_id=auto confidence_threshold=0.8 token_budget=3000 augment_compute=true local_compute=false compress=true

STATUS→ACTION:
continue→add steps | threshold_reached→complete or verify | review→use reconsideration.suggested_revise | verification_failed→revise|branch|override | budget_exhausted→complete or new session

FLOW:
1.step(question=,thought=)→primes trap detect
2.step(thought=)×N→auto-verify@4+, auto-compress if budget exceeded, CDD, consistency checks
3.[optional]challenge()→adversarial self-check
4.complete(final_answer=)→auto spot-check
5.if review→revise per reconsideration.suggested_revise
`,

  parameters: ScratchpadSchema,

  annotations: {
    streamingHint: true,
  },

  execute: async (args: ScratchpadArgs, ctx: MCPContext) => {
    // Server-side session tracking: get or create active session
    // LLM never sees or manages session_id
    let sessionId = SessionManager.getActiveSession();
    if (!sessionId) {
      sessionId = `s_${crypto.randomUUID()}`;
      SessionManager.setActiveSession(sessionId);
    }

    try {
      // Check hard budget limit BEFORE processing operation
      if (args.hard_limit_tokens && sessionId) {
        const existingTokens = SessionManager.getTokenUsage(sessionId);
        if (existingTokens && existingTokens.total >= args.hard_limit_tokens) {
          const budgetExhaustedResponse: ScratchpadResponse = {
            session_id: sessionId,
            current_step: 0,
            branch: "main",
            operation: args.operation,
            chain_confidence: 0,
            confidence_threshold: args.confidence_threshold,
            steps_with_confidence: 0,
            status: "budget_exhausted",
            suggested_action:
              "Token budget exhausted. Complete the reasoning chain with your current answer or start a new session.",
            session_tokens: existingTokens,
            budget_exhausted: {
              limit: args.hard_limit_tokens,
              current: existingTokens.total,
              exceeded_by: existingTokens.total - args.hard_limit_tokens,
              message: `Session has used ${existingTokens.total} tokens, exceeding hard limit of ${args.hard_limit_tokens}.`,
              recommendation:
                "Use complete operation to finalize your answer, or start a fresh session for new reasoning.",
            },
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `\n\`\`\`json\n${JSON.stringify(budgetExhaustedResponse, null, 2)}\n\`\`\``,
              },
            ],
          };
        }
      }

      let response: ScratchpadResponse;

      switch (args.operation) {
        case "step":
          response = await handleStep(args, ctx, sessionId);
          break;
        case "navigate":
          response = await handleNavigate(args, ctx, sessionId);
          break;
        case "branch":
          response = await handleBranch(args, ctx, sessionId);
          break;
        case "revise":
          response = await handleRevise(args, ctx, sessionId);
          break;
        case "complete":
          response = await handleComplete(args, ctx, sessionId);
          break;
        case "augment":
          response = await handleAugment(args, ctx, sessionId);
          break;
        case "override":
          response = await handleOverride(args, ctx, sessionId);
          break;
        case "hint":
          response = await handleHint(args, ctx, sessionId);
          break;
        case "mistakes":
          response = await handleMistakes(args, ctx, sessionId);
          break;
        case "spot_check":
          response = await handleSpotCheck(args, ctx, sessionId);
          break;
        case "challenge":
          response = await handleChallenge(args, ctx, sessionId);
          break;
        default:
          throw new Error(`Unknown operation: ${(args as { operation: string }).operation}`);
      }

      // Add token usage to response
      // If compression was applied, account for compressed input (not original)
      const argsForTokenCount = response.compression?.applied
        ? { ...args, thought: "[compressed]" } // Placeholder - actual compressed tokens tracked in response.compression
        : args;
      const tokens = calculateTokenUsage(argsForTokenCount, response);

      // If compression was applied, use the actual compressed token count
      if (response.compression?.applied) {
        tokens.input_tokens =
          response.compression.compressed_tokens +
          Math.ceil(JSON.stringify({ ...args, thought: undefined }).length / 4); // Args minus thought
        tokens.total_tokens = tokens.input_tokens + tokens.output_tokens;
      }
      response.tokens = tokens;

      // Track cumulative session tokens
      const session = SessionManager.get(response.session_id);
      if (session) {
        session.tokenUsage.input += tokens.input_tokens;
        session.tokenUsage.output += tokens.output_tokens;
        session.tokenUsage.operations += 1;
      }

      const sessionTokens = SessionManager.getTokenUsage(response.session_id) || {
        total_input: 0,
        total_output: 0,
        total: 0,
        operations: 0,
      };
      response.session_tokens = sessionTokens;

      // Check token budget warning threshold
      if (args.warn_at_tokens && sessionTokens.total > args.warn_at_tokens) {
        response.token_warning = {
          threshold: args.warn_at_tokens,
          current: sessionTokens.total,
          exceeded_by: sessionTokens.total - args.warn_at_tokens,
          message: `Session token usage (${sessionTokens.total}) exceeds threshold (${args.warn_at_tokens}). Consider completing or compressing.`,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const errorResponse: {
        error: string;
        tokens?: ReturnType<typeof calculateTokenUsage>;
        session_tokens?: {
          total_input: number;
          total_output: number;
          total: number;
          operations: number;
        };
      } = { error: message };
      const tokens = calculateTokenUsage(args, errorResponse);
      errorResponse.tokens = tokens;
      // Track session tokens even on error for accurate budget monitoring
      if (sessionId) {
        const session = SessionManager.get(sessionId);
        if (session) {
          session.tokenUsage.input += tokens.input_tokens;
          session.tokenUsage.output += tokens.output_tokens;
          session.tokenUsage.operations += 1;
        }
        errorResponse.session_tokens = SessionManager.getTokenUsage(sessionId) || {
          total_input: 0,
          total_output: 0,
          total: 0,
          operations: 0,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(errorResponse) }],
      };
    }
  },
};
