/**
 * Think Tool Schema - Rich structured reasoning schema
 * Zod schemas and types for the think tool
 */

import { z } from "zod";

// ============================================================================
// SCHEMA - Rich structured reasoning schema
// ============================================================================

export const NextActionSchema = z.union([
  z.string().describe("Simple description of next action"),
  z
    .object({
      tool: z.string().optional().describe("Tool to use"),
      action: z.string().describe("Specific action to perform"),
      parameters: z.record(z.string(), z.unknown()).optional().describe("Tool parameters"),
      expectedOutput: z.string().optional().describe("Expected result"),
    })
    .describe("Structured action with tool details"),
]);

export const ThinkSchema = z.object({
  // Core required fields
  step_number: z.number().int().min(1).describe("Sequential step number starting from 1"),
  estimated_total: z.number().int().min(1).describe("Estimated total steps needed"),
  purpose: z
    .string()
    .describe(
      "Step category: analysis, action, reflection, decision, summary, validation, exploration, hypothesis, correction, planning",
    ),
  context: z.string().describe("What is already known. Include prior findings."),
  thought: z.string().describe("Current reasoning process"),
  outcome: z.string().describe("Expected or actual result from this step"),
  next_action: NextActionSchema.describe("What to do next"),
  rationale: z.string().describe("Why this next action was chosen"),

  // Completion
  is_final_step: z.boolean().default(false).describe("Mark as final step"),

  // Confidence tracking
  confidence: z.number().min(0).max(1).optional().describe("Confidence in this step (0-1)"),
  uncertainty_notes: z.string().optional().describe("Specific uncertainties or assumptions"),

  // Revision support
  revises_step: z.number().int().min(1).optional().describe("Step number being revised"),
  revision_reason: z.string().optional().describe("Why revising earlier step"),

  // Branching support
  branch_from: z.number().int().min(1).optional().describe("Step to branch from"),
  branch_id: z.string().optional().describe("Branch identifier"),
  branch_name: z.string().optional().describe("Human-readable branch name"),

  // Dependencies
  dependencies: z.array(z.number().int().min(1)).optional().describe("Steps this depends on"),

  // Tool tracking
  tools_used: z.array(z.string()).optional().describe("Tools used in this step"),
  external_context: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("External data/tool outputs"),

  // Session
  session_id: z.string().optional().describe("Session ID for multi-turn"),

  // Guidance/verification extensions
  guidance: z.boolean().default(true).describe("Enable proactive guidance"),
  verify: z.boolean().default(false).describe("Run domain verification"),
  domain: z.enum(["math", "logic", "code", "general"]).optional().describe("Domain hint"),
  local_compute: z.boolean().default(false).describe("Try local compute for math"),

  // Local compute augmentation - inject computed values into thought
  augment_compute: z
    .boolean()
    .default(false)
    .describe(
      "Extract and inject locally computed values into thought (math, logic, probability, facts)",
    ),
  system_prompt: z
    .string()
    .optional()
    .describe("System prompt context for domain-aware filtering of compute augmentation"),

  // Compression control
  compression_level: z
    .enum(["none", "auto", "aggressive"])
    .default("auto")
    .describe(
      "Compression level: none (disabled), auto (entropy-based), aggressive (always compress long text)",
    ),

  // Baseline mode - pure pass-through, no features
  baseline: z.boolean().default(false).describe("Baseline mode: bypass all features"),
});

export type ThinkArgs = z.infer<typeof ThinkSchema>;
