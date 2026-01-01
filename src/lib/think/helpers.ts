/**
 * Think Tool Helpers - Extracted functions to reduce cognitive complexity
 * These helpers handle specific phases of the think tool's execute function.
 */

import { compress, needsCompression } from "../compression.ts";
import {
  type ContextAwareResult,
  contextAwareCompute,
  isLikelyComputable,
  tryLocalCompute,
} from "../compute/index.ts";
import type { ComputeResult } from "../compute/types.ts";
import { SessionManager, type ThoughtRecord } from "../session.ts";
import { type VerificationDomain, type VerificationResult, verify } from "../verification.ts";
import type { ThoughtAnalysis } from "./guidance.ts";
import {
  analyzeThought,
  assessPromptComplexity,
  detectDomain,
  isTrivialQuestion,
} from "./index.ts";
import type { ThinkArgs } from "./schema.ts";

// ============================================================================
// TYPES
// ============================================================================

export type CompressionLevel = "none" | "auto" | "aggressive";
export type StreamFn = (content: { type: "text"; text: string }) => Promise<void>;

export interface CompressionStats {
  inputCompressed: boolean;
  outputCompressed: boolean;
  contextCompressed: boolean;
  inputBytesSaved: number;
  outputBytesSaved: number;
  contextBytesSaved: number;
}

export interface ExecuteContext {
  sessionId: string;
  branch: string;
  step: number;
  stepId: string;
  domain: VerificationDomain;
  compressionLevel: CompressionLevel;
  priorThoughts: ThoughtRecord[];
}

export interface ComplexityInfo {
  tier: string;
  score: number;
  trivial: boolean;
  domain: string | null;
  intensity_signals: string[];
}

// ============================================================================
// BASELINE MODE
// ============================================================================

/** Build response for baseline mode (pure pass-through) */
export function buildBaselineResponse(
  args: ThinkArgs,
  stepId: string,
  sessionId: string,
): Record<string, unknown> {
  const step = args.step_number;
  const status = args.is_final_step ? "complete" : "continue";
  const response: Record<string, unknown> = {
    step_id: stepId,
    session_id: sessionId,
    status,
    step: `${step}/${args.estimated_total}`,
    purpose: args.purpose,
    next_action: args.next_action,
    baseline: true,
  };
  if (status === "continue") {
    response.next_step = step + 1;
  }
  return response;
}

// ============================================================================
// COMPRESSION HELPERS
// ============================================================================

/** Compress input thought if needed */
export function compressInput(
  text: string,
  context: string | undefined,
  level: CompressionLevel,
): { thought: string; compressed: boolean; bytesSaved: number } {
  if (level === "none") {
    return { thought: text, compressed: false, bytesSaved: 0 };
  }

  const shouldCompress =
    level === "aggressive"
      ? text.length > 200
      : needsCompression(text, context ?? "").shouldCompress;

  if (!shouldCompress) {
    return { thought: text, compressed: false, bytesSaved: 0 };
  }

  const targetRatio = level === "aggressive" ? 0.5 : 0.6;
  const result = compress(text, context ?? "", { target_ratio: targetRatio });

  if (result.ratio < 0.8) {
    return {
      thought: result.compressed,
      compressed: true,
      bytesSaved: text.length - result.compressed.length,
    };
  }

  return { thought: text, compressed: false, bytesSaved: 0 };
}

/** Compress context from long reasoning chains */
export function compressChainContext(
  priorThoughts: ThoughtRecord[],
  currentThought: string,
  level: CompressionLevel,
): { compressed: string | undefined; bytesSaved: number } {
  if (level === "none" || priorThoughts.length < 5) {
    return { compressed: undefined, bytesSaved: 0 };
  }

  const fullContext = priorThoughts.map((t) => t.thought).join(" ");
  const shouldCompress =
    level === "aggressive"
      ? fullContext.length > 500
      : needsCompression(fullContext, currentThought).shouldCompress;

  if (!shouldCompress) {
    return { compressed: undefined, bytesSaved: 0 };
  }

  const targetRatio = level === "aggressive" ? 0.3 : 0.4;
  const result = compress(fullContext, currentThought, { target_ratio: targetRatio });

  return {
    compressed: result.compressed,
    bytesSaved: fullContext.length - result.compressed.length,
  };
}

/** Compress output thought for storage */
export function compressOutput(
  thought: string,
  context: string | undefined,
  level: CompressionLevel,
): { stored: string; compressed: boolean; bytesSaved: number } {
  if (level === "none" || thought.length <= 500) {
    return { stored: thought, compressed: false, bytesSaved: 0 };
  }

  const shouldCompress =
    level === "aggressive" || needsCompression(thought, context ?? "").shouldCompress;
  if (!shouldCompress) {
    return { stored: thought, compressed: false, bytesSaved: 0 };
  }

  const targetRatio = level === "aggressive" ? 0.6 : 0.7;
  const result = compress(thought, context ?? "", { target_ratio: targetRatio });

  if (result.ratio < 0.85) {
    return {
      stored: result.compressed,
      compressed: true,
      bytesSaved: thought.length - result.compressed.length,
    };
  }

  return { stored: thought, compressed: false, bytesSaved: 0 };
}

// ============================================================================
// COMPLEXITY & LOCAL COMPUTE
// ============================================================================

/** Assess complexity on step 1 for metadata */
export function assessComplexity(thought: string, step: number): ComplexityInfo | null {
  if (step !== 1) return null;

  const complexity = assessPromptComplexity(thought);
  const trivial = isTrivialQuestion(thought);
  return {
    tier: complexity.tier,
    score: complexity.score,
    trivial,
    domain: complexity.explanation.domain_detected,
    intensity_signals: complexity.explanation.intensity_signals,
  };
}

/** Try local compute for math/logic problems */
export async function tryCompute(
  args: ThinkArgs,
  thought: string,
  streamFn: StreamFn,
): Promise<ComputeResult | null> {
  if (!args.local_compute || args.step_number !== 1 || !isLikelyComputable(thought)) {
    return null;
  }

  const computed = tryLocalCompute(thought);
  if (!computed.solved) return null;

  await streamFn({
    type: "text",
    text:
      `⚡ **Local Compute** (${computed.method}, ${computed.time_ms?.toFixed(2)}ms)\n` +
      `**Result:** ${computed.result}\n\n`,
  });

  return computed;
}

/** Augmentation result with metadata */
export interface AugmentResult {
  /** Augmented thought with injected values */
  augmented: string;
  /** Number of computations injected */
  count: number;
  /** Number filtered out by domain */
  filtered: number;
  /** Detected domain */
  domain: string;
  /** Time taken in ms */
  time_ms: number;
}

/**
 * Augment thought with locally computed values.
 * Extracts all computable expressions and injects results.
 * Domain-aware: filters irrelevant computations based on system_prompt.
 *
 * @returns Augmented thought and metadata, or null if disabled/no computations
 */
export function tryAugment(args: ThinkArgs, thought: string): AugmentResult | null {
  if (!args.augment_compute) {
    return null;
  }

  const result: ContextAwareResult = contextAwareCompute({
    thought,
    systemPrompt: args.system_prompt,
  });

  // No computations found
  if (!result.hasComputations && result.filteredCount === 0) {
    return null;
  }

  return {
    augmented: result.augmented,
    count: result.computations.length,
    filtered: result.filteredCount,
    domain: result.domain,
    time_ms: result.time_ms,
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/** Validate revision step - returns error message or null */
export function validateRevision(
  revisesStep: number | undefined,
  currentStep: number,
): string | null {
  if (revisesStep === undefined) return null;
  if (revisesStep >= currentStep) {
    return `Cannot revise step ${revisesStep} from step ${currentStep}`;
  }
  return null;
}

/** Validate branch_from step - returns error message or null */
export function validateBranch(branchFrom: number | undefined, currentStep: number): string | null {
  if (branchFrom === undefined) return null;
  if (branchFrom >= currentStep) {
    return `Cannot branch from future step ${branchFrom}`;
  }
  return null;
}

/** Find missing dependencies - returns array of missing step numbers */
export function findMissingDeps(
  dependencies: number[] | undefined,
  priorThoughts: ThoughtRecord[],
): number[] {
  if (!dependencies?.length) return [];
  const existingSteps = new Set(priorThoughts.map((t) => t.step_number));
  return dependencies.filter((d) => !existingSteps.has(d));
}

// ============================================================================
// GUIDANCE & VERIFICATION
// ============================================================================

/** Run guidance analysis and stream results if needed */
export async function runGuidance(
  args: ThinkArgs,
  thought: string,
  ctx: ExecuteContext,
  streamFn: StreamFn,
): Promise<ThoughtAnalysis | null> {
  if (args.guidance === false) return null;

  const analysis = analyzeThought(thought, ctx.step, ctx.priorThoughts, ctx.domain);

  // Only stream if there's something to show
  if (analysis.guidance.length === 0 && !analysis.checkpoint_recommended) {
    return analysis;
  }

  await streamFn({ type: "text", text: "\n---\n" });

  if (analysis.risk_level !== "low") {
    await streamFn({ type: "text", text: `**Risk: ${analysis.risk_level.toUpperCase()}**\n` });
  }

  if (analysis.checkpoint_recommended) {
    await streamFn({ type: "text", text: "**⚠️ CHECKPOINT RECOMMENDED**\n" });
  }

  for (const g of analysis.guidance) {
    await streamFn({ type: "text", text: `> ${g}\n` });
  }

  if (analysis.suggested_next) {
    await streamFn({ type: "text", text: `\n**Suggested:** ${analysis.suggested_next}\n` });
  }

  return analysis;
}

/** Run verification and stream results */
export async function runVerify(
  args: ThinkArgs,
  thought: string,
  ctx: ExecuteContext,
  streamFn: StreamFn,
): Promise<VerificationResult | null> {
  if (!args.verify) return null;

  const contextStrings = ctx.priorThoughts.map((t) => t.thought);
  const result = verify(thought, ctx.domain, contextStrings, true);

  const icon = result.passed ? "✓ PASS" : "✗ FAIL";
  await streamFn({
    type: "text",
    text: `\n**Verification: ${icon}** (${Math.round(result.confidence * 100)}%)\n`,
  });

  return result;
}

// ============================================================================
// RECORD & RESPONSE BUILDERS
// ============================================================================

/** Build the thought record for session storage */
export function buildRecord(
  args: ThinkArgs,
  ctx: ExecuteContext,
  storedThought: string,
  verificationResult: VerificationResult | null,
  compressedContext: string | undefined,
  stats: CompressionStats,
): ThoughtRecord {
  const hasCompression = stats.inputCompressed || stats.outputCompressed || stats.contextCompressed;

  return {
    id: ctx.stepId,
    step_number: ctx.step,
    thought: storedThought,
    timestamp: Date.now(),
    branch_id: ctx.branch,
    verification: verificationResult
      ? {
          passed: verificationResult.passed,
          confidence: verificationResult.confidence,
          domain: ctx.domain,
        }
      : undefined,
    compressed_context: compressedContext,
    compression: hasCompression
      ? {
          input_bytes_saved: stats.inputBytesSaved,
          output_bytes_saved: stats.outputBytesSaved,
          context_bytes_saved: stats.contextBytesSaved,
        }
      : undefined,
    revises_step: args.revises_step,
    revision_reason: args.revision_reason,
    branch_from: args.branch_from,
    branch_name: args.branch_name,
    dependencies: args.dependencies,
    tools_used: args.tools_used,
    external_context: args.external_context,
  };
}

/** Build the final JSON response */
export function buildResponse(
  args: ThinkArgs,
  ctx: ExecuteContext,
  analysis: ThoughtAnalysis | null,
  verificationResult: VerificationResult | null,
  localComputeResult: ComputeResult | null,
  complexityInfo: ComplexityInfo | null,
  stats: CompressionStats,
  augmentResult: AugmentResult | null = null,
): Record<string, unknown> {
  const status = args.is_final_step ? "complete" : "continue";

  const response: Record<string, unknown> = {
    step_id: ctx.stepId,
    session_id: ctx.sessionId,
    status,
    step: `${ctx.step}/${args.estimated_total}`,
    purpose: args.purpose,
    next_action: args.next_action,
  };

  if (status === "continue") {
    response.next_step = ctx.step + 1;
  }

  if (args.confidence !== undefined) {
    response.confidence = args.confidence;
  }

  // Analysis metadata
  if (analysis) {
    response.risk_level = analysis.risk_level;
    if (analysis.patterns_detected.length > 0) {
      response.patterns = analysis.patterns_detected;
    }
    if (analysis.checkpoint_recommended) {
      response.checkpoint = true;
    }
  }

  // Verification metadata
  if (verificationResult) {
    response.verified = verificationResult.passed;
    response.verification_confidence = verificationResult.confidence;
  }

  // Local compute metadata
  if (localComputeResult) {
    response.local_compute = {
      solved: true,
      result: localComputeResult.result,
      method: localComputeResult.method,
      time_ms: localComputeResult.time_ms,
    };
  }

  // Complexity metadata (step 1 only)
  if (complexityInfo) {
    response.complexity = complexityInfo;
  }

  // Revision metadata
  if (args.revises_step) {
    response.revised_step = args.revises_step;
  }

  // Branch metadata
  if (args.branch_from) {
    response.branch = {
      id: ctx.branch,
      name: args.branch_name,
      from: args.branch_from,
    };
  }

  // Tools used
  if (args.tools_used?.length) {
    response.tools_used = args.tools_used;
  }

  // Compression stats
  const hasCompression = stats.inputCompressed || stats.outputCompressed || stats.contextCompressed;
  if (hasCompression) {
    response.compression = {
      level: ctx.compressionLevel,
      input: stats.inputCompressed,
      output: stats.outputCompressed,
      context: stats.contextCompressed,
      bytes_saved: stats.inputBytesSaved + stats.outputBytesSaved + stats.contextBytesSaved,
    };
  }

  // Augmentation metadata
  if (augmentResult) {
    response.augmented = {
      count: augmentResult.count,
      filtered: augmentResult.filtered,
      domain: augmentResult.domain,
      time_ms: augmentResult.time_ms,
    };
  }

  return response;
}

// ============================================================================
// UTILITY
// ============================================================================

/** Create error response object */
export function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}

/** Create success response with JSON content */
export function jsonResponse(data: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: `\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` },
    ],
  };
}

/** Initialize execute context from args */
export function initContext(args: ThinkArgs, thought: string): ExecuteContext {
  const sessionId = args.session_id || `s_${crypto.randomUUID()}`;
  const branch = args.branch_id || "main";
  const step = args.step_number;
  const compressionLevel = (args.compression_level || "auto") as CompressionLevel;
  const priorThoughts = SessionManager.getThoughts(sessionId, branch);
  const domain = (args.domain || detectDomain(thought)) as VerificationDomain;

  return {
    sessionId,
    branch,
    step,
    stepId: `${sessionId}:${branch}:${step}`,
    domain,
    compressionLevel,
    priorThoughts,
  };
}

/** Store thought record and return success/error */
export function storeThought(
  sessionId: string,
  record: ThoughtRecord,
): { success: true } | { success: false; error: string } {
  const result = SessionManager.addThought(sessionId, record);
  if (!result.success) {
    return { success: false, error: result.error || "Failed to store thought" };
  }
  return { success: true };
}
