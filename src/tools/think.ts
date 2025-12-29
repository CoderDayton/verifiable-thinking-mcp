import type { Context } from "fastmcp";
import { stripMarkdown } from "../lib/extraction.ts";
import { SessionManager } from "../lib/session.ts";
import {
  type AugmentResult,
  assessComplexity,
  buildBaselineResponse,
  buildRecord,
  buildResponse,
  type CompressionStats,
  compressChainContext,
  compressInput,
  compressOutput,
  type ExecuteContext,
  errorResponse,
  findMissingDeps,
  initContext,
  jsonResponse,
  runGuidance,
  runVerify,
  type ThinkArgs,
  ThinkSchema,
  tryAugment,
  tryCompute,
  VALID_PURPOSES,
  validateBranch,
  validateRevision,
} from "../lib/think/index.ts";

type MCPContext = Context<Record<string, unknown> | undefined>;

// ============================================================================
// THINK TOOL - CRASH-style scratchpad with optional features
// ============================================================================

export const thinkTool = {
  name: "think",
  description: `Record a structured reasoning step with optional guidance and verification.

CRASH-style scratchpad: Record your reasoning steps sequentially.
- Track confidence, revisions, branching, and dependencies
- Optional guidance on failure patterns (can be disabled)
- Optional domain-specific verification
- Optional local compute for single math/logic questions
- Optional compute augmentation: inject computed values into thought (math, logic, probability, facts)

WORKFLOW:
1. Start with step_number=1, estimate total steps
2. Each step: purpose, context, thought, outcome, next_action, rationale
3. Use confidence (0-1) when uncertain
4. Use revises_step to correct errors
5. Use branch_from to explore alternatives
6. Set is_final_step=true when done

COMPUTE AUGMENTATION (augment_compute=true):
- Extracts all computable expressions from thought
- Injects results inline: "sqrt(16)" → "sqrt(16) [=4]"
- Domain-aware: pass system_prompt to filter irrelevant computations
- Reduces token usage and improves accuracy on math-heavy reasoning

PURPOSE VALUES: analysis, action, reflection, decision, summary, validation, exploration, hypothesis, correction, planning`,

  parameters: ThinkSchema,

  annotations: {
    streamingHint: true,
  },

  execute: async (args: ThinkArgs, ctx: MCPContext) => {
    const { streamContent } = ctx;
    const step = args.step_number;

    // Initialize context (sessionId, branch, domain, compression level, prior thoughts)
    const strippedThought = stripMarkdown(args.thought);

    // BASELINE MODE: Pure pass-through, no features
    if (args.baseline) {
      await streamContent({
        type: "text",
        text: `**Step ${step}/${args.estimated_total}** [${args.purpose}]\n${args.thought}\n`,
      });
      await streamContent({ type: "text", text: `**Outcome:** ${args.outcome}\n` });

      const sessionId = args.session_id || `s_${Date.now().toString(36)}`;
      const branch = args.branch_id || "main";
      const stepId = `${sessionId}:${branch}:${step}`;
      return jsonResponse(buildBaselineResponse(args, stepId, sessionId));
    }

    // Initialize full context
    const execCtx: ExecuteContext = initContext(args, strippedThought);

    // Compress input if needed
    const inputResult = compressInput(strippedThought, args.context, execCtx.compressionLevel);
    let thought = inputResult.thought;

    // Try compute augmentation (extract all computable expressions, inject results)
    // This runs before everything else so downstream processing sees computed values
    const augmentResult: AugmentResult | null = tryAugment(args, thought);
    if (augmentResult) {
      thought = augmentResult.augmented;
    }

    // Assess complexity on step 1 (metadata only)
    const complexityInfo = assessComplexity(thought, step);

    // Try local compute for math/logic (opt-in only)
    const localComputeResult = await tryCompute(args, thought, streamContent);

    // Warn on custom purpose
    if (!VALID_PURPOSES.has(args.purpose.toLowerCase())) {
      await streamContent({ type: "text", text: `⚠️ Custom purpose: ${args.purpose}\n` });
    }

    // Validate revision
    const revisionError = validateRevision(args.revises_step, step);
    if (revisionError) return errorResponse(revisionError);

    if (args.revises_step) {
      await streamContent({
        type: "text",
        text: `📝 Revising step ${args.revises_step}: ${args.revision_reason || "No reason"}\n`,
      });
    }

    // Validate branching
    const branchError = validateBranch(args.branch_from, step);
    if (branchError) return errorResponse(branchError);

    if (args.branch_from) {
      const branchName = args.branch_name || `Alternative ${execCtx.branch}`;
      await streamContent({
        type: "text",
        text: `🌿 Branching from step ${args.branch_from}: ${branchName}\n`,
      });
    }

    // Validate dependencies
    const missingDeps = findMissingDeps(args.dependencies, execCtx.priorThoughts);
    if (missingDeps.length > 0) {
      await streamContent({
        type: "text",
        text: `⚠️ Missing dependencies: steps ${missingDeps.join(", ")}\n`,
      });
    }

    // Stream the thought and outcome
    await streamContent({
      type: "text",
      text: `**Step ${step}/${args.estimated_total}** [${args.purpose}]\n${thought}\n`,
    });
    await streamContent({ type: "text", text: `**Outcome:** ${args.outcome}\n` });

    // Run optional guidance analysis
    const analysis = await runGuidance(args, thought, execCtx, streamContent);

    // Run optional verification
    const verificationResult = await runVerify(args, thought, execCtx, streamContent);

    // Compress long chains and output
    const chainResult = compressChainContext(
      execCtx.priorThoughts,
      thought,
      execCtx.compressionLevel,
    );
    const outputResult = compressOutput(thought, args.context, execCtx.compressionLevel);

    // Build compression stats
    const stats: CompressionStats = {
      inputCompressed: inputResult.compressed,
      outputCompressed: outputResult.compressed,
      contextCompressed: chainResult.compressed !== undefined,
      inputBytesSaved: inputResult.bytesSaved,
      outputBytesSaved: outputResult.bytesSaved,
      contextBytesSaved: chainResult.bytesSaved,
    };

    // Build and store thought record
    const record = buildRecord(
      args,
      execCtx,
      outputResult.stored,
      verificationResult,
      chainResult.compressed,
      stats,
    );
    const storeResult = SessionManager.addThought(execCtx.sessionId, record);
    if (!storeResult.success) {
      return errorResponse(storeResult.error || "Failed to store thought");
    }

    // Build and return response
    const response = buildResponse(
      args,
      execCtx,
      analysis,
      verificationResult,
      localComputeResult,
      complexityInfo,
      stats,
      augmentResult,
    );
    return jsonResponse(response);
  },
};
