import type { Context } from "fastmcp";
import { compress, needsCompression } from "../lib/compression.ts";
import { isLikelyComputable, tryLocalCompute } from "../lib/compute/index.ts";
import { stripMarkdown } from "../lib/extraction.ts";
import { SessionManager, type ThoughtRecord } from "../lib/session.ts";
// Import from shared think library
import {
  analyzeThought,
  // Local complexity assessment (for metadata only, no phase routing)
  assessPromptComplexity,
  detectDomain,
  isTrivialQuestion,
  type ThinkArgs,
  ThinkSchema,
  VALID_PURPOSES,
} from "../lib/think/index.ts";
import { verify } from "../lib/verification.ts";

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
- Optional local compute for math/logic

WORKFLOW:
1. Start with step_number=1, estimate total steps
2. Each step: purpose, context, thought, outcome, next_action, rationale
3. Use confidence (0-1) when uncertain
4. Use revises_step to correct errors
5. Use branch_from to explore alternatives
6. Set is_final_step=true when done

PURPOSE VALUES: analysis, action, reflection, decision, summary, validation, exploration, hypothesis, correction, planning`,

  parameters: ThinkSchema,

  annotations: {
    streamingHint: true,
  },

  execute: async (args: ThinkArgs, ctx: MCPContext) => {
    const { streamContent } = ctx;
    const sessionId = args.session_id || `s_${Date.now().toString(36)}`;
    const branch = args.branch_id || "main";
    const step = args.step_number;
    const stepId = `${sessionId}:${branch}:${step}`;

    // BASELINE MODE: Pure pass-through, no features
    if (args.baseline) {
      await streamContent({
        type: "text",
        text: `**Step ${step}/${args.estimated_total}** [${args.purpose}]\n${args.thought}\n`,
      });
      await streamContent({
        type: "text",
        text: `**Outcome:** ${args.outcome}\n`,
      });

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

      return {
        content: [
          {
            type: "text" as const,
            text: `\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``,
          },
        ],
      };
    }

    // Strip markdown from thought for clean storage/processing
    const strippedThought = stripMarkdown(args.thought);

    // Compression level: none | auto | aggressive
    const compressionLevel = args.compression_level || "auto";

    // Check if input thought needs compression (after markdown stripping)
    let thought = strippedThought;
    let inputCompressed = false;
    let inputBytesSaved = 0;

    if (compressionLevel !== "none") {
      const shouldCompressInput =
        compressionLevel === "aggressive"
          ? strippedThought.length > 200
          : needsCompression(strippedThought, args.context).shouldCompress;

      if (shouldCompressInput) {
        const targetRatio = compressionLevel === "aggressive" ? 0.5 : 0.6;
        const compressed = compress(strippedThought, args.context, {
          target_ratio: targetRatio,
        });
        if (compressed.ratio < 0.8) {
          const originalLen = strippedThought.length;
          thought = compressed.compressed;
          inputCompressed = true;
          inputBytesSaved = originalLen - thought.length;
        }
      }
    }

    // Get context
    const priorThoughts = SessionManager.getThoughts(sessionId, branch);
    const domain = args.domain || detectDomain(thought);

    // On step 1, assess complexity for metadata (no phase routing)
    let complexityInfo = null;
    if (step === 1) {
      const complexity = assessPromptComplexity(thought);
      const trivial = isTrivialQuestion(thought);
      complexityInfo = {
        tier: complexity.tier,
        score: complexity.score,
        trivial,
        signals: complexity.signals,
      };
    }

    // Try local compute for math, logic, and probability problems (opt-in only)
    let localComputeResult = null;
    if (args.local_compute && step === 1 && isLikelyComputable(thought)) {
      const computed = tryLocalCompute(thought);
      if (computed.solved) {
        localComputeResult = computed;
        await streamContent({
          type: "text",
          text:
            `⚡ **Local Compute** (${computed.method}, ${computed.time_ms?.toFixed(2)}ms)\n` +
            `**Result:** ${computed.result}\n\n`,
        });
      }
    }

    // Validate purpose (warn but don't fail in flexible mode)
    if (!VALID_PURPOSES.has(args.purpose.toLowerCase())) {
      await streamContent({
        type: "text",
        text: `⚠️ Custom purpose: ${args.purpose}\n`,
      });
    }

    // Handle revision
    if (args.revises_step) {
      if (args.revises_step >= step) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Cannot revise step ${args.revises_step} from step ${step}`,
              }),
            },
          ],
        };
      }
      await streamContent({
        type: "text",
        text: `📝 Revising step ${args.revises_step}: ${args.revision_reason || "No reason"}\n`,
      });
    }

    // Handle branching
    if (args.branch_from) {
      if (args.branch_from >= step) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Cannot branch from future step ${args.branch_from}`,
              }),
            },
          ],
        };
      }
      const branchName = args.branch_name || `Alternative ${branch}`;
      await streamContent({
        type: "text",
        text: `🌿 Branching from step ${args.branch_from}: ${branchName}\n`,
      });
    }

    // Validate dependencies
    if (args.dependencies?.length) {
      const existingSteps = new Set(priorThoughts.map((t) => t.step_number));
      const missing = args.dependencies.filter((d) => !existingSteps.has(d));
      if (missing.length > 0) {
        await streamContent({
          type: "text",
          text: `⚠️ Missing dependencies: steps ${missing.join(", ")}\n`,
        });
      }
    }

    // Stream the thought
    await streamContent({
      type: "text",
      text: `**Step ${step}/${args.estimated_total}** [${args.purpose}]\n${thought}\n`,
    });

    // Stream outcome
    await streamContent({
      type: "text",
      text: `**Outcome:** ${args.outcome}\n`,
    });

    // Run guidance analysis (OPTIONAL - can be disabled for pure scratchpad mode)
    let analysis = null;
    if (args.guidance !== false) {
      analysis = analyzeThought(thought, step, priorThoughts, domain);

      if (analysis.guidance.length > 0 || analysis.checkpoint_recommended) {
        await streamContent({ type: "text", text: "\n---\n" });

        if (analysis.risk_level !== "low") {
          await streamContent({
            type: "text",
            text: `**Risk: ${analysis.risk_level.toUpperCase()}**\n`,
          });
        }

        if (analysis.checkpoint_recommended) {
          await streamContent({
            type: "text",
            text: "**⚠️ CHECKPOINT RECOMMENDED**\n",
          });
        }

        for (const g of analysis.guidance) {
          await streamContent({ type: "text", text: `> ${g}\n` });
        }

        if (analysis.suggested_next) {
          await streamContent({
            type: "text",
            text: `\n**Suggested:** ${analysis.suggested_next}\n`,
          });
        }
      }
    }

    // Run verification (OPTIONAL)
    let verificationResult = null;
    if (args.verify) {
      const contextStrings = priorThoughts.map((t) => t.thought);
      verificationResult = verify(thought, domain, contextStrings, true, true);

      const icon = verificationResult.passed ? "✓ PASS" : "✗ FAIL";
      await streamContent({
        type: "text",
        text: `\n**Verification: ${icon}** (${Math.round(verificationResult.confidence * 100)}%)\n`,
      });

      if (verificationResult.blindspot_marker) {
        await streamContent({
          type: "text",
          text: "**Wait** - Self-correction blind spot detected. Pause and reconsider.\n",
        });
      }
    }

    // Auto-compress long chains
    let compressedContext: string | undefined;
    let contextCompressed = false;
    let contextBytesSaved = 0;

    if (compressionLevel !== "none" && priorThoughts.length >= 5) {
      const fullContext = priorThoughts.map((t) => t.thought).join(" ");
      const shouldCompressContext =
        compressionLevel === "aggressive"
          ? fullContext.length > 500
          : needsCompression(fullContext, thought).shouldCompress;

      if (shouldCompressContext) {
        const targetRatio = compressionLevel === "aggressive" ? 0.3 : 0.4;
        const result = compress(fullContext, thought, {
          target_ratio: targetRatio,
        });
        compressedContext = result.compressed;
        contextCompressed = true;
        contextBytesSaved = fullContext.length - result.compressed.length;
      }
    }

    // Check if thought to be stored needs compression
    let storedThought = thought;
    let outputCompressed = false;
    let outputBytesSaved = 0;

    if (compressionLevel !== "none" && thought.length > 500) {
      const shouldCompressOutput =
        compressionLevel === "aggressive" || needsCompression(thought, args.context).shouldCompress;

      if (shouldCompressOutput) {
        const targetRatio = compressionLevel === "aggressive" ? 0.6 : 0.7;
        const compressed = compress(thought, args.context, {
          target_ratio: targetRatio,
        });
        if (compressed.ratio < 0.85) {
          const originalLen = thought.length;
          storedThought = compressed.compressed;
          outputCompressed = true;
          outputBytesSaved = originalLen - storedThought.length;
        }
      }
    }

    // Store thought with full metadata
    const record: ThoughtRecord = {
      id: stepId,
      step_number: step,
      thought: storedThought,
      timestamp: Date.now(),
      branch_id: branch,
      verification: verificationResult
        ? {
            passed: verificationResult.passed,
            confidence: verificationResult.confidence,
            domain,
          }
        : undefined,
      compressed_context: compressedContext,
      compression:
        inputCompressed || outputCompressed || contextCompressed
          ? {
              input_bytes_saved: inputBytesSaved,
              output_bytes_saved: outputBytesSaved,
              context_bytes_saved: contextBytesSaved,
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

    const addResult = SessionManager.addThought(sessionId, record);
    if (!addResult.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: addResult.error, status: "failed" }),
          },
        ],
      };
    }

    // Build response
    const status = args.is_final_step ? "complete" : "continue";

    const response: Record<string, unknown> = {
      step_id: stepId,
      session_id: sessionId,
      status,
      step: `${step}/${args.estimated_total}`,
      purpose: args.purpose,
      next_action: args.next_action,
    };

    if (status === "continue") {
      response.next_step = step + 1;
    }

    if (args.confidence !== undefined) {
      response.confidence = args.confidence;
    }

    if (analysis) {
      response.risk_level = analysis.risk_level;
      if (analysis.patterns_detected.length > 0) {
        response.patterns = analysis.patterns_detected;
      }
      if (analysis.checkpoint_recommended) {
        response.checkpoint = true;
      }
    }

    if (verificationResult) {
      response.verified = verificationResult.passed;
      response.verification_confidence = verificationResult.confidence;
    }

    if (localComputeResult) {
      response.local_compute = {
        solved: true,
        result: localComputeResult.result,
        method: localComputeResult.method,
        time_ms: localComputeResult.time_ms,
      };
    }

    // Include complexity assessment on step 1 (metadata only)
    if (complexityInfo) {
      response.complexity = complexityInfo;
    }

    if (args.revises_step) {
      response.revised_step = args.revises_step;
    }

    if (args.branch_from) {
      response.branch = {
        id: branch,
        name: args.branch_name,
        from: args.branch_from,
      };
    }

    if (args.tools_used?.length) {
      response.tools_used = args.tools_used;
    }

    // Add compression stats if any compression occurred
    const totalBytesSaved = inputBytesSaved + outputBytesSaved + contextBytesSaved;
    if (inputCompressed || outputCompressed || contextCompressed) {
      response.compression = {
        level: compressionLevel,
        input: inputCompressed,
        output: outputCompressed,
        context: contextCompressed,
        bytes_saved: totalBytesSaved,
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
  },
};
