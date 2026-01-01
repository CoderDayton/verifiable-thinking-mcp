/**
 * Scratchpad Schema - Unified CRASH-style reasoning tool
 *
 * Single tool with operation-based dispatch:
 * - step: Add a thought (auto-increments step number)
 * - navigate: View history, branches, specific step, or path
 * - branch: Start alternative reasoning path
 * - revise: Correct earlier step
 * - complete: Finalize reasoning chain
 */

import { z } from "zod";

// ============================================================================
// OPERATION SCHEMAS
// ============================================================================

const StepOperationSchema = z.object({
  operation: z.literal("step"),

  // Core thought content
  thought: z.string().describe("Current reasoning/analysis"),
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
    .default("analysis")
    .describe("Step category"),
  outcome: z.string().optional().describe("Result or conclusion from this step"),

  // Confidence (contributes to chain average)
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Confidence in this step (0-1). Contributes to chain average."),

  // Context for augmentation
  context: z.string().optional().describe("Prior context or findings"),

  // Optional features
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

  // Compression
  compress: z.boolean().default(false).describe("Compress thought before storing"),
  compression_query: z.string().optional().describe("Query for context-aware compression"),

  // Per-step token limit (rejects if exceeded, unless force_large=true)
  max_step_tokens: z
    .number()
    .int()
    .min(10)
    .optional()
    .describe("Max tokens for this step. Rejects if exceeded (default: no limit)"),
  force_large: z.boolean().default(false).describe("Allow step even if it exceeds max_step_tokens"),
});

const NavigateOperationSchema = z.object({
  operation: z.literal("navigate"),

  view: z
    .enum(["history", "branches", "step", "path"])
    .describe(
      "What to view: history (all steps), branches (list), step (specific), path (lineage)",
    ),

  // For step/path views
  step_id: z.number().int().min(1).optional().describe("Step number to view"),

  // For history view
  branch_id: z.string().optional().describe("Filter history by branch"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max steps to return"),
});

const BranchOperationSchema = z.object({
  operation: z.literal("branch"),

  // Branch point (default: current step)
  from_step: z.number().int().min(1).optional().describe("Step to branch from (default: current)"),
  branch_name: z.string().optional().describe("Human-readable branch name"),

  // Initial thought on new branch
  thought: z.string().describe("First thought on new branch"),
  purpose: z.enum(["analysis", "exploration", "hypothesis", "correction"]).default("exploration"),

  // Auto-augment (default: true)
  augment_compute: z
    .boolean()
    .default(true)
    .describe("Auto-inject computed values into thought (default: true)"),
  context: z.string().optional().describe("Prior context for augmentation"),
});

const ReviseOperationSchema = z.object({
  operation: z.literal("revise"),

  target_step: z.number().int().min(1).describe("Step number to revise"),
  reason: z.string().describe("Why revising this step"),
  thought: z.string().describe("Corrected reasoning"),
  confidence: z.number().min(0).max(1).optional(),

  // Auto-augment (default: true)
  augment_compute: z
    .boolean()
    .default(true)
    .describe("Auto-inject computed values into thought (default: true)"),
  context: z.string().optional().describe("Prior context for augmentation"),
});

const CompleteOperationSchema = z.object({
  operation: z.literal("complete"),

  summary: z.string().optional().describe("Final summary/conclusion"),
  final_answer: z.string().optional().describe("The answer/result"),
  question: z
    .string()
    .optional()
    .describe("Original question (enables auto spot-check for trap detection)"),
});

const AugmentOperationSchema = z.object({
  operation: z.literal("augment"),

  // Text to augment with computed values
  text: z.string().describe("Text containing math expressions to compute and inject"),

  // Optional context for domain-aware filtering
  system_context: z.string().optional().describe("System prompt context for domain filtering"),

  // Whether to store as a step (default: false, just returns augmented text)
  store_as_step: z.boolean().default(false).describe("Store augmented result as a reasoning step"),
});

const OverrideOperationSchema = z.object({
  operation: z.literal("override"),

  // Must acknowledge the verification failure
  acknowledge: z
    .literal(true)
    .describe("Confirm you understand verification failed but want to proceed"),

  // Reason for overriding (helps with debugging/learning)
  reason: z.string().describe("Why the verification heuristic is wrong in this case"),

  // The step that failed verification (will now be stored)
  failed_step: z.number().int().min(1).describe("Step number that failed verification"),
});

const HintOperationSchema = z.object({
  operation: z.literal("hint"),

  // The expression to get hints for (optional if continuing from previous hint)
  expression: z
    .string()
    .optional()
    .describe("Math expression to simplify. Omit to continue from previous hint in session."),

  // How many steps to reveal (progressive hint)
  // If omitted when continuing, auto-increments from previous reveal_count
  reveal_count: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Number of steps to reveal. Omit to auto-increment when continuing."),

  // Whether to show just the next step or cumulative steps
  cumulative: z
    .boolean()
    .default(true)
    .describe("Show all steps up to reveal_count (true) or just the nth step (false)"),

  // Reset hint state and start fresh (even if expression is same)
  reset: z.boolean().default(false).describe("Reset hint state and start from beginning"),
});

const MistakesOperationSchema = z.object({
  operation: z.literal("mistakes"),

  // Text containing math steps to check for errors
  text: z
    .string()
    .describe("Text containing math derivation steps to check for common algebraic mistakes"),
});

const SpotCheckOperationSchema = z.object({
  operation: z.literal("spot_check"),

  // The original question being answered
  question: z.string().describe("The original question/problem being answered"),

  // The proposed answer to check
  answer: z.string().describe("The proposed answer to check for trap patterns"),
});

// ============================================================================
// UNIFIED SCHEMA
// ============================================================================

export const ScratchpadSchema = z
  .discriminatedUnion("operation", [
    StepOperationSchema,
    NavigateOperationSchema,
    BranchOperationSchema,
    ReviseOperationSchema,
    CompleteOperationSchema,
    AugmentOperationSchema,
    OverrideOperationSchema,
    HintOperationSchema,
    MistakesOperationSchema,
    SpotCheckOperationSchema,
  ])
  .and(
    z.object({
      // Session management (auto-generated if not provided)
      session_id: z.string().optional().describe("Session ID (auto-generated if omitted)"),

      // Confidence threshold for completion suggestion
      confidence_threshold: z
        .number()
        .min(0)
        .max(1)
        .default(0.8)
        .describe("Chain confidence threshold to suggest completion"),

      // Token budget for auto-compression (default: 3000)
      token_budget: z
        .number()
        .int()
        .min(100)
        .default(3000)
        .describe("Max tokens before auto-compressing new steps"),
    }),
  );

export type ScratchpadArgs = z.infer<typeof ScratchpadSchema>;
export type StepOperation = z.infer<typeof StepOperationSchema>;
export type NavigateOperation = z.infer<typeof NavigateOperationSchema>;
export type BranchOperation = z.infer<typeof BranchOperationSchema>;
export type ReviseOperation = z.infer<typeof ReviseOperationSchema>;
export type CompleteOperation = z.infer<typeof CompleteOperationSchema>;
export type AugmentOperation = z.infer<typeof AugmentOperationSchema>;
export type OverrideOperation = z.infer<typeof OverrideOperationSchema>;
export type HintOperation = z.infer<typeof HintOperationSchema>;
export type MistakesOperation = z.infer<typeof MistakesOperationSchema>;
export type SpotCheckOperation = z.infer<typeof SpotCheckOperationSchema>;

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
  status: "continue" | "review" | "threshold_reached" | "complete" | "verification_failed";
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
}
