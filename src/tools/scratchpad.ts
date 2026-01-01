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
import { detectDomain } from "../lib/think/guidance.ts";
import {
  type ScratchpadArgs,
  type ScratchpadResponse,
  ScratchpadSchema,
} from "../lib/think/scratchpad-schema.ts";
import { spotCheck } from "../lib/think/spot-check.ts";
import { verify } from "../lib/verification.ts";

type MCPContext = Context<Record<string, unknown> | undefined>;

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
  verificationResult: { confidence: number; suggestions: string[]; evidence: string },
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
  compressionResult: { original_tokens: number; compressed_tokens: number } | null;
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
  result: { applied: boolean; computations: number; filtered: number; domain: string } | null;
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
  const compressOutput = compress(thought, query, { target_ratio: targetRatio });
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
// OPERATION HANDLERS
// ============================================================================

/** Handle step operation - add a new thought */
async function handleStep(
  args: Extract<ScratchpadArgs, { operation: "step" }> & {
    session_id?: string;
    confidence_threshold?: number;
    token_budget?: number;
    max_step_tokens?: number;
    force_large?: boolean;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id || `s_${Date.now().toString(36)}`;
  const branchId = "main"; // Default branch for step operation
  const threshold = args.confidence_threshold ?? 0.8;
  const tokenBudget = args.token_budget ?? 3000;

  // S3: Check max_step_tokens limit before any processing
  const maxStepTokens = args.max_step_tokens;
  if (maxStepTokens !== undefined && !args.force_large) {
    // Estimate tokens: ~4 chars per token
    const estimatedTokens = Math.ceil(args.thought.length / 4);
    if (estimatedTokens > maxStepTokens) {
      throw new Error(
        `Step exceeds max_step_tokens limit: ${estimatedTokens} > ${maxStepTokens}. ` +
          `Split into smaller steps or use force_large=true to override.`,
      );
    }
  }

  // Auto-increment step number
  const stepNumber = SessionManager.getNextStep(sessionId, branchId);

  // Strip markdown and detect domain
  let strippedThought = stripMarkdown(args.thought);
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

  // S1: Token budget guard - check if session exceeds budget
  const tokenUsage = SessionManager.getTokenUsage(sessionId);
  const budgetExceeded = tokenUsage.total >= tokenBudget;

  // Compression - check if requested, auto-detect, OR budget exceeded
  const compression = await applyCompression(strippedThought, args, budgetExceeded, streamContent);
  strippedThought = compression.thought;
  const compressionResult = compression.result;
  const autoCompressed = compression.autoCompressed;

  // Run verification if requested OR auto-enabled for longer chains
  // Auto-verify when: chain has >3 steps AND verify wasn't explicitly set to false
  const priorThoughts = SessionManager.getThoughts(sessionId, branchId);
  const shouldAutoVerify = priorThoughts.length >= 3 && args.verify !== false;
  const shouldVerify = args.verify === true || shouldAutoVerify;

  let verificationResult = null;
  let autoVerifyEnabled = false;

  if (shouldVerify) {
    autoVerifyEnabled = shouldAutoVerify && args.verify !== true;
    const contextStrings = priorThoughts.map((t) => t.thought);
    verificationResult = verify(strippedThought, domain, contextStrings, true);

    // Note auto-verification in stream if it was triggered
    if (autoVerifyEnabled) {
      await streamContent({
        type: "text",
        text: `🔍 **Auto-verification enabled** (chain length: ${priorThoughts.length + 1} steps)\n`,
      });
    }

    // HALT ON VERIFICATION FAILURE
    if (!verificationResult.passed) {
      const mistakeResult =
        domain === "math" ? detectCommonMistakesFromText(strippedThought) : null;
      const detectedMistakes = mistakeResult?.mistakes ?? [];

      // Build and store pending record
      const pendingRecord = buildPendingRecord({
        sessionId,
        branchId,
        stepNumber,
        thought: strippedThought,
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
      return buildVerificationFailureResponse({
        sessionId,
        branchId,
        stepNumber,
        threshold,
        verificationResult,
        detectedMistakes,
        domain,
      });
    }
  }

  // Stream the thought (only if verification passed or wasn't requested)
  await streamContent({
    type: "text",
    text: `**Step ${stepNumber}** [${args.purpose}]\n${strippedThought}\n`,
  });
  if (args.outcome) {
    await streamContent({ type: "text", text: `**Outcome:** ${args.outcome}\n` });
  }

  // Build thought record
  const record: ThoughtRecord = {
    id: `${sessionId}:${branchId}:${stepNumber}`,
    step_number: stepNumber,
    thought: strippedThought,
    timestamp: Date.now(),
    branch_id: branchId,
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

  // Add verification info
  if (verificationResult) {
    response.verification = {
      passed: verificationResult.passed,
      confidence: verificationResult.confidence,
      domain,
    };
  }

  // Add local compute info
  if (computeResult?.solved) {
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

  // Add token usage info
  const updatedTokenUsage = SessionManager.getTokenUsage(sessionId);
  response.token_usage = {
    total: updatedTokenUsage.total,
    budget: tokenBudget,
    exceeded: budgetExceeded,
    auto_compressed: autoCompressed,
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

/** Handle navigate operation - view history/branches/steps/paths */
async function handleNavigate(
  args: Extract<ScratchpadArgs, { operation: "navigate" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  _ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const sessionId = args.session_id;
  if (!sessionId) {
    throw new Error("session_id required for navigate operation");
  }

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
  args: Extract<ScratchpadArgs, { operation: "branch" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id;
  if (!sessionId) {
    throw new Error("session_id required for branch operation");
  }

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;

  // Clear any pending verification failure (branching abandons the failed step)
  const hadPending = SessionManager.clearPendingThought(sessionId);

  // Determine branch point
  const fromStep = args.from_step ?? SessionManager.getCurrentStep(sessionId, "main");
  const branchId = `branch-${Date.now().toString(36)}`;
  const branchName = args.branch_name || `Alternative from step ${fromStep}`;

  // Auto-increment step number for new branch
  const stepNumber = fromStep + 1;

  // Strip markdown and detect domain BEFORE augmentation
  let strippedThought = stripMarkdown(args.thought);
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
  await streamContent({
    type: "text",
    text:
      `🌿 **New Branch:** ${branchName}${pendingNote}\n` +
      `   From step ${fromStep} → Step ${stepNumber}\n\n`,
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
    suggested_action: `Branch "${branchName}" created. Continue reasoning on this alternative path.`,
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
  args: Extract<ScratchpadArgs, { operation: "revise" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id;
  if (!sessionId) {
    throw new Error("session_id required for revise operation");
  }

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = "main"; // Revisions go on main branch

  // Check if revising a pending (failed verification) step
  const pending = SessionManager.getPendingThought(sessionId);
  const isRevisingPending = pending && args.target_step === pending.thought.step_number;

  // If not revising pending, validate target step exists in stored thoughts
  if (!isRevisingPending) {
    const targetStep = SessionManager.getStep(sessionId, args.target_step);
    if (!targetStep) {
      throw new Error(`Target step not found: ${args.target_step}`);
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
  let strippedThought = stripMarkdown(args.thought);
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
      `📝 **Revising Step ${args.target_step}**${revisingLabel}\n` +
      `   Reason: ${args.reason}\n\n` +
      `**Step ${stepNumber}** [correction]\n${strippedThought}\n`,
  });

  // Build thought record with revision info
  const record: ThoughtRecord = {
    id: `${sessionId}:${branchId}:${stepNumber}`,
    step_number: stepNumber,
    thought: strippedThought,
    timestamp: Date.now(),
    branch_id: branchId,
    revises_step: isRevisingPending ? undefined : args.target_step, // Don't mark as revision if replacing pending
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
    suggested_action: `Revised step ${args.target_step}. Continue reasoning with corrected understanding.`,
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
  args: Extract<ScratchpadArgs, { operation: "complete" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id;
  if (!sessionId) {
    throw new Error("session_id required for complete operation");
  }

  const session = SessionManager.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = "main";

  // Get final stats
  const thoughts = SessionManager.getThoughts(sessionId);
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
    await streamContent({ type: "text", text: `\n**Summary:** ${args.summary}\n` });
  }
  if (args.final_answer) {
    await streamContent({ type: "text", text: `**Answer:** ${args.final_answer}\n` });
  }

  const response: ScratchpadResponse = {
    session_id: sessionId,
    current_step: SessionManager.getCurrentStep(sessionId, branchId),
    branch: branchId,
    operation: "complete",
    chain_confidence: confState.chainConfidence,
    confidence_threshold: threshold,
    steps_with_confidence: confState.stepsWithConfidence,
    status: "complete",
    suggested_action: "Reasoning chain finalized.",
    final_summary: args.summary,
    total_steps: thoughts.length,
  };

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

  return response;
}

/** Handle augment operation - extract, compute, and inject math results */
async function handleAugment(
  args: Extract<ScratchpadArgs, { operation: "augment" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id || `s_${Date.now().toString(36)}`;
  const threshold = args.confidence_threshold ?? 0.8;
  const branchId = "main";

  // Run context-aware computation
  const computeResult = contextAwareCompute({
    thought: args.text,
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
  args: Extract<ScratchpadArgs, { operation: "override" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id;
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
  args: Extract<ScratchpadArgs, { operation: "hint" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id || `hint-${Date.now()}`;
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
  args: Extract<ScratchpadArgs, { operation: "mistakes" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id || `mistakes-${Date.now()}`;
  const threshold = args.confidence_threshold ?? 0.8;

  // Run mistake detection
  const result = detectCommonMistakesFromText(args.text);
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
      text_checked: args.text.slice(0, 200) + (args.text.length > 200 ? "..." : ""),
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
  args: Extract<ScratchpadArgs, { operation: "spot_check" }> & {
    session_id?: string;
    confidence_threshold?: number;
  },
  ctx: MCPContext,
): Promise<ScratchpadResponse> {
  const { streamContent } = ctx;
  const sessionId = args.session_id || `spot-check-${Date.now()}`;
  const threshold = args.confidence_threshold ?? 0.8;

  // Run spot-check
  const result = spotCheck(args.question, args.answer);

  // Stream results
  if (result.passed) {
    await streamContent({
      type: "text",
      text: `✓ **No trap patterns detected**\n\n_Answer "${args.answer}" does not match known cognitive trap patterns for this question type._\n`,
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

// ============================================================================
// SCRATCHPAD TOOL
// ============================================================================

export const scratchpadTool = {
  name: "scratchpad",
  description: `Unified reasoning scratchpad with auto-step tracking, confidence monitoring, and verification-gated flow.

OPERATIONS:
- step: Add a thought (auto-increments step number). Verification auto-enables after 3 steps.
- navigate: View history, branches, specific step, or path
- branch: Start alternative reasoning path (useful after verification failures)
- revise: Correct an earlier step (useful to fix verification failures)
- complete: Finalize reasoning chain
- augment: Extract math expressions, compute locally, inject results
- override: Force-commit a step that failed verification (use sparingly)
- hint: Get progressive simplification hints for math expressions (session-stateful)
- mistakes: Proactively check text for common algebraic errors (without needing verification to fail)
- spot_check: Check if your answer may have fallen for a cognitive trap (bat-ball, lily pad, etc.)

SPOT-CHECK (use before finalizing tricky answers):
- Detects structural trap patterns: additive systems, exponential growth, rate problems, etc.
- Call with operation="spot_check", question="<original question>", answer="<your answer>"
- If warning returned, reconsider your reasoning

AUTO-VERIFICATION:
- Verification is AUTO-ENABLED for chains with >3 steps (errors compound)
- Set verify=false to disable for a specific step
- Set verify=true to enable early (steps 1-3)

VERIFICATION FLOW:
When verification FAILS:
1. Step is NOT stored (held as pending)
2. status becomes "verification_failed"
3. You MUST choose a recovery action:
   - revise: Fix the issue and resubmit
   - branch: Try a different approach from an earlier step
   - override: Force-commit if the heuristic is wrong (rare)

CONFIDENCE TRACKING:
- Confidence accumulates as average across chain
- When chain_confidence ≥ threshold (default 0.8), status becomes "threshold_reached"
- 5-second timer warning given to complete or continue

WORKFLOW:
1. Call with operation="step", verify=true for important steps
2. If verification fails, use revise/branch/override to recover
3. When threshold reached, call operation="complete"
4. Use navigate to view history, branches, paths at any time`,

  parameters: ScratchpadSchema,

  annotations: {
    streamingHint: true,
  },

  execute: async (args: ScratchpadArgs, ctx: MCPContext) => {
    try {
      let response: ScratchpadResponse;

      switch (args.operation) {
        case "step":
          response = await handleStep(args, ctx);
          break;
        case "navigate":
          response = await handleNavigate(args, ctx);
          break;
        case "branch":
          response = await handleBranch(args, ctx);
          break;
        case "revise":
          response = await handleRevise(args, ctx);
          break;
        case "complete":
          response = await handleComplete(args, ctx);
          break;
        case "augment":
          response = await handleAugment(args, ctx);
          break;
        case "override":
          response = await handleOverride(args, ctx);
          break;
        case "hint":
          response = await handleHint(args, ctx);
          break;
        case "mistakes":
          response = await handleMistakes(args, ctx);
          break;
        case "spot_check":
          response = await handleSpotCheck(args, ctx);
          break;
        default:
          throw new Error(`Unknown operation: ${(args as { operation: string }).operation}`);
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
      };
    }
  },
};
