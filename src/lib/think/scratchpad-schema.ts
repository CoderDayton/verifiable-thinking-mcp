/**
 * Scratchpad Schema - Unified CRASH-style reasoning tool
 *
 * Single tool with operation-based dispatch:
 * - step: Add a thought (auto-increments step number)
 * - navigate: View history, branches, specific step, or path
 * - branch: Start alternative reasoning path
 * - revise: Correct earlier step
 * - complete: Finalize reasoning chain
 *
 * Note: Uses a flat object schema for MCP SDK compatibility.
 * The MCP spec requires inputSchema.type = "object", but Zod's
 * discriminatedUnion produces "oneOf" which fails validation.
 */

import { z } from "zod";

// ============================================================================
// FLAT SCHEMA (MCP-compatible: type="object" at top level)
// ============================================================================

export const ScratchpadSchema = z.object({
  // Required: operation discriminator
  operation: z
    .enum([
      "step",
      "navigate",
      "branch",
      "revise",
      "complete",
      "augment",
      "override",
      "hint",
      "mistakes",
      "spot_check",
      "challenge",
    ])
    .describe("Operation to perform"),

  // Common fields (all operations)
  session_id: z.string().optional().describe("Session ID (auto-generated if omitted)"),
  confidence_threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.8)
    .describe("Chain confidence threshold to suggest completion"),
  token_budget: z
    .number()
    .int()
    .min(100)
    .default(3000)
    .describe("Max tokens before auto-compressing new steps"),
  warn_at_tokens: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe(
      "Warn when cumulative session tokens exceed this threshold (soft limit, cost control)",
    ),
  hard_limit_tokens: z
    .number()
    .int()
    .min(100)
    .optional()
    .describe(
      "Hard stop when cumulative session tokens exceed this threshold. Returns budget_exhausted status and blocks further operations.",
    ),

  // Step operation fields
  thought: z.string().optional().describe("Current reasoning/analysis (step/branch/revise)"),
  purpose: z
    .enum([
      "analysis",
      "action",
      "reflection",
      "decision",
      "summary",
      "validation",
      "exploration",
      "hypothesis",
      "correction",
      "planning",
    ])
    .optional()
    .describe("Step category"),
  outcome: z.string().optional().describe("Result or conclusion from this step"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Confidence in this step (0-1). Contributes to chain average."),
  context: z.string().optional().describe("Prior context or findings"),
  verify: z
    .boolean()
    .optional()
    .describe(
      "Run domain verification. Auto-enabled for chains >3 steps. Set to false to disable.",
    ),
  domain: z.enum(["math", "logic", "code", "general"]).optional(),
  local_compute: z.boolean().default(false).describe("Try local compute for math"),
  augment_compute: z
    .boolean()
    .default(true)
    .describe("Auto-inject computed values into thought (default: true)"),
  compress: z.boolean().default(true).describe("Compress thought before storing"),
  compression_query: z.string().optional().describe("Query for context-aware compression"),
  max_step_tokens: z
    .number()
    .int()
    .min(10)
    .optional()
    .describe("Max tokens for this step. Rejects if exceeded (default: no limit)"),
  force_large: z.boolean().default(false).describe("Allow step even if it exceeds max_step_tokens"),
  preconditions: z
    .array(z.string())
    .optional()
    .describe("Assumptions that MUST be true for this step (e.g., 'x > 0', 'file exists')"),

  // Navigate operation fields
  view: z
    .enum(["history", "branches", "step", "path"])
    .optional()
    .describe(
      "What to view: history (all steps), branches (list), step (specific), path (lineage)",
    ),
  step_id: z.number().int().min(1).optional().describe("Step number to view"),
  branch_id: z.string().optional().describe("Filter history by branch"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max steps to return"),

  // Branch operation fields
  from_step: z.number().int().min(1).optional().describe("Step to branch from (default: current)"),
  branch_name: z.string().optional().describe("Human-readable branch name"),
  hypothesis: z
    .string()
    .optional()
    .describe("Falsifiable hypothesis this branch will test (e.g., 'Assume X is prime')"),
  success_criteria: z
    .string()
    .optional()
    .describe("What observation proves/disproves this hypothesis"),

  // Revise operation fields
  target_step: z.number().int().min(1).optional().describe("Step number to revise"),
  reason: z.string().optional().describe("Why revising this step / Why overriding verification"),

  // Complete operation fields
  summary: z.string().optional().describe("Final summary/conclusion"),
  final_answer: z.string().optional().describe("The answer/result"),
  question: z
    .string()
    .optional()
    .describe(
      "Original question. On step: enables trap priming and stores for auto spot-check. On complete: enables spot-check.",
    ),

  // Augment operation fields
  text: z
    .string()
    .optional()
    .describe("Text containing math expressions to compute and inject (augment/mistakes)"),
  system_context: z.string().optional().describe("System prompt context for domain filtering"),
  store_as_step: z.boolean().default(false).describe("Store augmented result as a reasoning step"),

  // Override operation fields
  acknowledge: z
    .boolean()
    .optional()
    .describe("Confirm you understand verification failed but want to proceed"),
  failed_step: z.number().int().min(1).optional().describe("Step number that failed verification"),

  // Hint operation fields
  expression: z
    .string()
    .optional()
    .describe("Math expression to simplify. Omit to continue from previous hint in session."),
  reveal_count: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Number of steps to reveal. Omit to auto-increment when continuing."),
  cumulative: z
    .boolean()
    .default(true)
    .describe("Show all steps up to reveal_count (true) or just the nth step (false)"),
  reset: z.boolean().default(false).describe("Reset hint state and start from beginning"),

  // Spot check operation fields
  answer: z.string().optional().describe("The proposed answer to check for trap patterns"),

  // Challenge operation fields
  challenge_type: z
    .enum(["assumption_inversion", "edge_case", "premise_check", "steelman_counter", "all"])
    .optional()
    .describe("Type of challenge to generate (default: all)"),
  target_claim: z
    .string()
    .optional()
    .describe("Specific claim to challenge (optional - if omitted, extracts claims from steps)"),
});

export type ScratchpadArgs = z.infer<typeof ScratchpadSchema>;

// Operation-specific type aliases (all use the same flat structure, just for clarity)
export type StepOperation = ScratchpadArgs & { operation: "step" };
export type NavigateOperation = ScratchpadArgs & { operation: "navigate" };
export type BranchOperation = ScratchpadArgs & { operation: "branch" };
export type ReviseOperation = ScratchpadArgs & { operation: "revise" };
export type CompleteOperation = ScratchpadArgs & { operation: "complete" };
export type AugmentOperation = ScratchpadArgs & { operation: "augment" };
export type OverrideOperation = ScratchpadArgs & { operation: "override" };
export type HintOperation = ScratchpadArgs & { operation: "hint" };
export type MistakesOperation = ScratchpadArgs & { operation: "mistakes" };
export type SpotCheckOperation = ScratchpadArgs & { operation: "spot_check" };
export type ChallengeOperation = ScratchpadArgs & { operation: "challenge" };

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/** Recovery options provided when verification fails */
export interface RecoveryOptions {
  /** Revise the failed step in-place */
  revise: {
    target_step: number;
    suggested_reason: string;
  };
  /** Branch to try an alternative approach */
  branch: {
    from_step: number;
    suggested_name: string;
  };
  /** Override and continue anyway (use when heuristic is wrong) */
  override: {
    flag: "force_continue";
    warning: string;
  };
}

/** A detected algebraic mistake */
export interface DetectedMistakeInfo {
  /** Type of mistake (sign_error, distribution_error, etc.) */
  type: string;
  /** Human-readable description */
  description: string;
  /** Specific fix suggestion */
  fix?: string;
  /** The complete corrected step (e.g., "2x + 3x = 5x") */
  corrected_step?: string;
}

/** Details about a verification failure */
export interface VerificationFailure {
  /** What check failed */
  issue: string;
  /** Specific evidence of the problem */
  evidence: string;
  /** Suggestions for fixing */
  suggestions: string[];
  /** Confidence in the failure detection (higher = more certain it's wrong) */
  confidence: number;
  /** Domain that was checked */
  domain: string;
  /** Detected algebraic mistakes (math domain only) */
  detected_mistakes?: DetectedMistakeInfo[];
  /** Available recovery actions */
  recovery_options: RecoveryOptions;
}

export interface ScratchpadResponse {
  // State
  session_id: string;
  current_step: number;
  branch: string;
  operation: string;

  // Confidence tracking
  step_confidence?: number;
  chain_confidence: number;
  confidence_threshold: number;
  steps_with_confidence: number;

  // Status & guidance
  status:
    | "continue"
    | "review"
    | "threshold_reached"
    | "complete"
    | "verification_failed"
    | "budget_exhausted";
  suggested_action: string;

  // Timer warning (when threshold reached)
  auto_complete_warning?: string;

  // Verification failure (when status === "verification_failed")
  // The step is NOT stored until recovery action is taken
  verification_failure?: VerificationFailure;

  // For navigate operation
  history?: Array<{
    step: number;
    branch: string;
    purpose: string;
    thought_preview: string;
    confidence?: number;
    revised_by?: number;
  }>;
  branches?: Array<{
    id: string;
    name: string;
    from_step: number;
    depth: number;
    /** Hypothesis this branch is testing (if provided) */
    hypothesis?: string;
    /** Criteria for proving/disproving the hypothesis */
    success_criteria?: string;
  }>;
  path?: Array<{
    step: number;
    branch: string;
    thought_preview: string;
  }>;
  step_detail?: {
    step: number;
    branch: string;
    purpose: string;
    thought: string;
    outcome?: string;
    confidence?: number;
    revises_step?: number;
    revised_by?: number;
    /** Preconditions/assumptions for this step */
    preconditions?: string[];
    /** Hypothesis being tested (for branch steps) */
    hypothesis?: string;
    /** Success criteria for the hypothesis */
    success_criteria?: string;
  };

  // For complete operation
  final_summary?: string;
  total_steps?: number;

  // Metadata
  verification?: {
    passed: boolean;
    confidence: number;
    domain: string;
  };
  local_compute?: {
    solved: boolean;
    result: unknown;
    method: string;
  };
  compression?: {
    applied: boolean;
    original_tokens: number;
    compressed_tokens: number;
    ratio: number;
  };

  // Token budget tracking
  token_usage?: {
    total: number;
    budget: number;
    exceeded: boolean;
    auto_compressed: boolean;
    /** Percentage of budget consumed */
    budget_percent: number;
  };

  // Proactive compression suggestion (when approaching budget)
  compression_suggestion?: {
    /** Whether compression is recommended now */
    should_compress: boolean;
    /** Current session token total */
    current_tokens: number;
    /** Budget threshold */
    budget: number;
    /** Percentage consumed */
    percent_used: number;
    /** Human-readable nudge */
    nudge: string;
  };

  // Augmentation results (when augment_compute=true)
  augmentation?: {
    applied: boolean;
    computations: number;
    filtered: number;
    domain: string;
  };
  // Session-level compression stats (for complete operation)
  compression_stats?: {
    total_bytes_saved: number;
    steps_compressed: number;
    tokens?: {
      original: number;
      compressed: number;
      saved: number;
    };
  };

  // For augment operation
  augmented_text?: string;
  computations?: Array<{
    expression: string;
    result: unknown;
    method: string;
  }>;
  filtered_count?: number;
  detected_domain?: string;

  // Next step suggestion for math derivations (auto-populated for math domain)
  next_step_suggestion?: {
    hasSuggestion: boolean;
    transformation?: string;
    description?: string;
    currentExpression?: string;
    allApplicable?: Array<{ name: string; description: string }>;
  };

  // For hint operation - progressive simplification hints
  hint_result?: {
    success: boolean;
    original: string;
    simplified: string;
    steps_shown: number;
    total_steps: number;
    steps: Array<{
      step_number: number;
      transformation: string;
      description: string;
      from: string;
      to: string;
    }>;
    has_more: boolean;
  };

  // For mistakes operation - proactive error checking
  mistakes_result?: {
    text_checked: string;
    mistakes_found: number;
    mistakes: DetectedMistakeInfo[];
  };

  // For spot_check operation - trap pattern detection
  spot_check_result?: {
    passed: boolean;
    trap_type: string | null;
    warning: string | null;
    hint: string | null;
    confidence: number;
  };

  // Reconsideration prompt (when spot-check fails during complete)
  reconsideration?: {
    trap_type: string;
    hint: string;
    suggested_revise: {
      target_step: number;
      reason: string;
    };
  };

  // Trap analysis (when question provided on step, informational only)
  trap_analysis?: {
    detected: boolean;
    types: string[]; // All detected trap types
    primed_count: number; // How many traps were actually primed (≤ types.length)
    note: string | null;
    confidence: number;
  };

  // Token usage metadata (always added by execute wrapper)
  tokens?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };

  // Cumulative session token usage (always added by execute wrapper)
  session_tokens?: {
    total_input: number;
    total_output: number;
    total: number;
    operations: number;
  };

  // Token budget warning (when warn_at_tokens threshold exceeded)
  token_warning?: {
    threshold: number;
    current: number;
    exceeded_by: number;
    message: string;
  };

  // Hard budget limit (when hard_limit_tokens exceeded - operation blocked)
  budget_exhausted?: {
    limit: number;
    current: number;
    exceeded_by: number;
    message: string;
    recommendation: string;
  };

  // Confidence Drift Detection (CDD) - novel meta-signal for reasoning quality
  // Analyzes confidence trajectory shape to detect unresolved uncertainty
  confidence_drift?: {
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
    pattern:
      | "stable"
      | "stable_overconfident"
      | "declining"
      | "improving"
      | "v_shaped"
      | "oscillating"
      | "cliff"
      | "insufficient";
    /** Human-readable explanation */
    explanation: string;
    /** Suggested action if unresolved */
    suggestion: string | null;
  };

  // Proactive stepping guidance based on question complexity
  // Provided on first step when question is supplied
  stepping_guidance?: {
    /** Complexity tier of the question */
    complexity_tier: "Low" | "Moderate" | "High" | "Very Hard" | "Almost Impossible";
    /** Recommended minimum steps for this complexity */
    recommended_steps: number;
    /** Current step count */
    current_steps: number;
    /** Whether more steps are recommended before completing */
    needs_more_steps: boolean;
    /** Human-readable nudge */
    nudge: string | null;
  };

  // Consistency check - detects contradictions across reasoning steps
  // Checked every N steps (configurable) to catch logical inconsistencies
  consistency_warning?: {
    /** Whether contradictions were found */
    has_contradictions: boolean;
    /** Number of contradictions detected */
    count: number;
    /** The contradictions found */
    contradictions: Array<{
      /** Type of contradiction */
      type: "value_reassignment" | "logical_conflict" | "sign_flip" | "direction_reversal";
      /** Human-readable description */
      description: string;
      /** The variable/concept involved */
      subject: string;
      /** Step where original claim was made */
      original_step: number;
      /** Conflicting step number */
      conflicting_step: number;
      /** Confidence in detection (0-1) */
      confidence: number;
    }>;
    /** Human-readable nudge */
    nudge: string;
  };

  // Hypothesis resolution - detects when a branch's hypothesis is confirmed/refuted
  // Only present for steps on branches with hypotheses
  hypothesis_resolution?: {
    /** Whether the hypothesis has been resolved */
    resolved: boolean;
    /** Resolution outcome if resolved */
    outcome: "confirmed" | "refuted" | "inconclusive" | null;
    /** Confidence in the resolution (0-1) */
    confidence: number;
    /** Step number where resolution was detected */
    resolved_at_step: number | null;
    /** Evidence text that triggered resolution */
    evidence: string | null;
    /** The original hypothesis being tested */
    hypothesis: string;
    /** The success criteria (if provided) */
    success_criteria: string | null;
    /** Suggested action based on resolution */
    suggestion: string;
  };

  // Challenge result - adversarial self-check for reasoning quality
  // Only present for challenge operation
  challenge_result?: {
    /** Number of challenges generated */
    challenges_generated: number;
    /** The challenges */
    challenges: Array<{
      /** Type of challenge */
      type: "assumption_inversion" | "edge_case" | "premise_check" | "steelman_counter";
      /** The original claim being challenged */
      original_claim: string;
      /** The challenge/counterargument */
      challenge: string;
      /** How serious is this challenge */
      severity: "low" | "medium" | "high";
      /** Suggested way to address this challenge */
      suggested_response: string;
    }>;
    /** Overall robustness score (0-1) */
    overall_robustness: number;
    /** Summary of findings */
    summary: string;
  };

  // Auto-challenge suggestion - triggered when overconfidence detected
  // Present when shouldChallenge() returns true (high confidence with few steps)
  challenge_suggestion?: {
    /** Whether a challenge is recommended */
    should_challenge: boolean;
    /** Why challenge is suggested */
    reason: string;
    /** Specific type of challenge recommended */
    suggested_type:
      | "assumption_inversion"
      | "edge_case"
      | "premise_check"
      | "steelman_counter"
      | "all";
    /** Human-readable nudge */
    nudge: string;
  };

  // Merge suggestion - triggered when branch hypothesis is confirmed
  // Suggests merging branch findings back to main reasoning path
  merge_suggestion?: {
    /** Whether merge is recommended */
    should_merge: boolean;
    /** Branch ID to merge from */
    from_branch: string;
    /** The confirmed hypothesis */
    confirmed_hypothesis: string;
    /** Key findings to incorporate */
    key_findings: string;
    /** Human-readable suggestion */
    nudge: string;
  };
}
