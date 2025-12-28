import { z } from "zod";
import type { Context } from "fastmcp";
import { SessionManager, type ThoughtRecord } from "../lib/session.ts";
import { verify, type VerificationDomain } from "../lib/verification.ts";
import { compress } from "../lib/compression.ts";

type MCPContext = Context<Record<string, unknown> | undefined>;

/**
 * REASONING PATTERNS - Learned failure modes and recovery strategies
 * Based on empirical analysis of reasoning failures
 * 
 * IMPORTANT: Patterns should be SPECIFIC to avoid false positives.
 * Only flag things that genuinely indicate risk.
 */
const FAILURE_PATTERNS: Record<string, {
  trigger: RegExp;
  risk: string;
  guidance: string;
  checkpoint: boolean;
  minLength?: number; // Only apply to thoughts longer than this
}> = {
  premature_conclusion: {
    // Only flag when concluding without showing work
    trigger: /^(therefore|thus|hence|so)\s+(the\s+)?answer\s+is/im,
    risk: "Concluding without showing intermediate steps",
    guidance: "Show your work before concluding",
    checkpoint: true,
    minLength: 0, // Always check
  },
  arithmetic_chain: {
    // Only flag complex multi-operation chains (3+ operations)
    trigger: /\d+\s*[\+\-\*\/]\s*\d+\s*[\+\-\*\/]\s*\d+\s*[\+\-\*\/]\s*\d+/,
    risk: "Long arithmetic chain prone to carry-forward errors",
    guidance: "Verify each arithmetic step independently",
    checkpoint: true,
    minLength: 50,
  },
  contradiction: {
    // Explicit contradiction indicators
    trigger: /but\s+(also|then|wait)|however.*but|on\s+the\s+other\s+hand.*yet/i,
    risk: "Potential contradiction in reasoning",
    guidance: "Resolve conflicting statements before proceeding",
    checkpoint: true,
    minLength: 100,
  },
  overconfident_complex: {
    // Only flag overconfidence on complex problems (by length proxy)
    trigger: /obviously|clearly|trivially|of\s+course/i,
    risk: "Overconfidence may mask errors",
    guidance: "Verify 'obvious' steps explicitly",
    checkpoint: false,
    minLength: 200, // Only for longer, presumably complex reasoning
  },
  unchecked_assumption: {
    // Flag when assuming without verification in multi-step
    trigger: /let's\s+assume|assuming\s+that|suppose\s+that/i,
    risk: "Assumption may not hold",
    guidance: "Verify assumption is warranted by the problem",
    checkpoint: false,
    minLength: 100,
  },
};

/**
 * GUIDANCE ENGINE - Proactive reasoning assistance
 */
function analyzeThought(
  thought: string,
  step: number,
  priorThoughts: ThoughtRecord[],
  domain: VerificationDomain
): {
  patterns_detected: string[];
  guidance: string[];
  checkpoint_recommended: boolean;
  suggested_next: string | null;
  risk_level: "low" | "medium" | "high";
} {
  const patterns_detected: string[] = [];
  const guidance: string[] = [];
  let checkpoint_recommended = false;
  let risk_score = 0;
  const thoughtLength = thought.length;

  // Check against known failure patterns (with length gating)
  for (const [name, pattern] of Object.entries(FAILURE_PATTERNS)) {
    const minLen = pattern.minLength ?? 0;
    if (thoughtLength >= minLen && pattern.trigger.test(thought)) {
      patterns_detected.push(name);
      guidance.push(pattern.guidance);
      if (pattern.checkpoint) checkpoint_recommended = true;
      risk_score++;
    }
  }

  // Domain-specific guidance (only for multi-step reasoning)
  if (step > 1) {
    if (domain === "math" && /=/.test(thought) && priorThoughts.length > 0) {
      // Only add if not already flagged
      if (guidance.length === 0) {
        guidance.push("Verify equation transformation preserves equality");
      }
    } else if (domain === "code" && /loop|iterate|recursive/i.test(thought)) {
      guidance.push("Verify termination condition exists");
      checkpoint_recommended = true;
      risk_score++;
    }
  }

  // Confidence trajectory analysis
  const confidences = priorThoughts
    .map(t => t.verification?.confidence)
    .filter((c): c is number => c !== undefined);
  
  if (confidences.length >= 2) {
    const recent = confidences.slice(-2);
    const prev = recent[0] ?? 0;
    const curr = recent[1] ?? 0;
    if (curr < prev - 0.2) {
      guidance.push("Confidence dropping - consider revisiting assumptions");
      risk_score++;
    }
  }

  // Suggest next action based on context
  let suggested_next: string | null = null;
  if (checkpoint_recommended) {
    suggested_next = "Pause and verify current step before proceeding";
  } else if (patterns_detected.includes("premature_conclusion")) {
    suggested_next = "Review all constraints before finalizing";
  } else if (step >= 3 && !priorThoughts.some(t => t.verification?.passed)) {
    suggested_next = "Consider verifying intermediate steps";
  }

  const risk_level = risk_score >= 3 ? "high" : risk_score >= 1 ? "medium" : "low";

  return {
    patterns_detected,
    guidance: guidance.slice(0, 3), // Cap at 3 most relevant
    checkpoint_recommended,
    suggested_next,
    risk_level,
  };
}

/**
 * Think Tool v3 - Reasoning Co-Pilot
 * 
 * Innovation: Proactive guidance, not just passive recording
 * 
 * Key differentiators:
 * 1. PATTERN DETECTION - Identifies known failure modes in real-time
 * 2. CHECKPOINT TRIGGERS - Recommends verification at critical junctures
 * 3. SUGGESTED NEXT ACTION - Guides the reasoning process
 * 4. RISK ASSESSMENT - Flags high-risk reasoning patterns
 * 5. STREAMING + LEAN - Best of both: stream reasoning, lean metadata
 */
export const thinkTool = {
  name: "think",
  description: `Record a structured reasoning step with proactive guidance.

A reasoning co-pilot that:
- Detects failure patterns (premature conclusions, arithmetic chains, edge case blindness)
- Recommends checkpoints at critical reasoning junctures  
- Suggests next actions based on reasoning trajectory
- Provides risk assessment for current step

Use for problems requiring careful multi-step reasoning.`,

  parameters: z.object({
    // Core
    thought: z.string().describe("Current reasoning step"),
    step: z.number().int().min(1).describe("Step number (starts at 1)"),
    total: z.number().int().min(1).optional().describe("Estimated total steps"),

    // Flow
    is_final: z.boolean().default(false).describe("Mark as final step"),

    // Guidance control
    guidance: z.boolean().default(true).describe("Enable proactive guidance"),
    verify: z.boolean().default(false).describe("Run verification on this step"),
    domain: z.enum(["math", "logic", "code", "general"]).optional()
      .describe("Domain (auto-detected if omitted)"),

    // Branching
    branch: z.string().default("main").describe("Branch identifier"),
    fork_from: z.number().int().min(1).optional().describe("Fork from step"),

    // Session
    session_id: z.string().optional().describe("Session ID"),

    // Self-reported confidence
    confidence: z.number().min(0).max(1).optional().describe("Your confidence (0-1)"),
  }),

  annotations: {
    streamingHint: true,
  },

  execute: async (
    args: {
      thought: string;
      step: number;
      total?: number;
      is_final?: boolean;
      guidance?: boolean;
      verify?: boolean;
      domain?: VerificationDomain;
      branch?: string;
      fork_from?: number;
      session_id?: string;
      confidence?: number;
    },
    ctx: MCPContext
  ) => {
    const { streamContent } = ctx;
    const sessionId = args.session_id || `s_${Date.now().toString(36)}`;
    const branch = args.branch || "main";
    const step = args.step;
    const stepId = `${sessionId}:${branch}:${step}`;

    // Get context
    const priorThoughts = SessionManager.getThoughts(sessionId, branch);
    const total = args.total || Math.max(step + 2, priorThoughts.length + 3);
    const domain = args.domain || detectDomain(args.thought);

    // Stream the thought (preserves real-time feel)
    await streamContent({ type: "text", text: `**Step ${step}/${total}**\n${args.thought}\n` });

    // Run guidance analysis (fast - pure pattern matching)
    const guidanceEnabled = args.guidance !== false;
    let analysis = null;
    
    if (guidanceEnabled) {
      analysis = analyzeThought(args.thought, step, priorThoughts, domain);
      
      if (analysis.guidance.length > 0 || analysis.checkpoint_recommended) {
        await streamContent({ type: "text", text: "\n---\n" });
        
        if (analysis.risk_level !== "low") {
          await streamContent({ 
            type: "text", 
            text: `**Risk: ${analysis.risk_level.toUpperCase()}**\n` 
          });
        }
        
        if (analysis.checkpoint_recommended) {
          await streamContent({ 
            type: "text", 
            text: `**CHECKPOINT RECOMMENDED**\n` 
          });
        }
        
        for (const g of analysis.guidance) {
          await streamContent({ type: "text", text: `> ${g}\n` });
        }
        
        if (analysis.suggested_next) {
          await streamContent({ 
            type: "text", 
            text: `\n**Suggested:** ${analysis.suggested_next}\n` 
          });
        }
      }
    }

    // Verification (only if explicitly requested)
    let verificationResult = null;
    if (args.verify) {
      const context = priorThoughts.map(t => t.thought);
      verificationResult = verify(args.thought, domain, context, true, true);
      
      const icon = verificationResult.passed ? "PASS" : "FAIL";
      await streamContent({ 
        type: "text", 
        text: `\n**Verification: ${icon}** (${Math.round(verificationResult.confidence * 100)}%)\n` 
      });
      
      if (verificationResult.blindspot_marker) {
        await streamContent({ 
          type: "text", 
          text: `**Wait** - Self-correction blind spot detected. Pause and reconsider.\n` 
        });
      }
    }

    // Auto-compress long chains
    let compressedContext: string | undefined;
    if (priorThoughts.length >= 5) {
      const fullContext = priorThoughts.map(t => t.thought).join(" ");
      const result = compress(fullContext, args.thought, { target_ratio: 0.4 });
      compressedContext = result.compressed;
    }

    // Store thought
    const record: ThoughtRecord = {
      id: stepId,
      step_number: step,
      thought: args.thought,
      timestamp: Date.now(),
      branch_id: branch,
      verification: verificationResult ? {
        passed: verificationResult.passed,
        confidence: verificationResult.confidence,
        domain,
      } : undefined,
      compressed_context: compressedContext,
    };
    SessionManager.addThought(sessionId, record);

    // Build response metadata (lean)
    const status = args.is_final ? "complete" : "continue";
    
    const meta: Record<string, unknown> = {
      step_id: stepId,
      session_id: sessionId,
      status,
      step: `${step}/${total}`,
    };

    if (status === "continue") {
      meta.next_step = step + 1;
    }

    if (analysis) {
      meta.risk_level = analysis.risk_level;
      if (analysis.patterns_detected.length > 0) {
        meta.patterns = analysis.patterns_detected;
      }
      if (analysis.checkpoint_recommended) {
        meta.checkpoint = true;
      }
    }

    if (verificationResult) {
      meta.verified = verificationResult.passed;
    }

    if (args.fork_from) {
      meta.forked_from = args.fork_from;
    }

    return {
      content: [{
        type: "text" as const,
        text: `\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\``,
      }],
    };
  },
};

/**
 * Auto-detect domain from thought content
 */
function detectDomain(thought: string): VerificationDomain {
  // Math: equations, arithmetic, calculus terms
  if (/\d+\s*[\+\-\*\/\^=]\s*\d+|equation|solve|derivative|integral|sum\s+of/i.test(thought)) {
    return "math";
  }
  
  // Code: programming keywords
  if (/function|class|return|const|let|var|def\s|import\s|async|await|=>|->|fn\s|impl\s/i.test(thought)) {
    return "code";
  }
  
  // Logic: logical connectives
  if (/if\s+.+\s+then|therefore|implies|hence|thus|conclude|premise|valid|invalid/i.test(thought)) {
    return "logic";
  }
  
  return "general";
}
