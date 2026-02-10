/**
 * Think Tool Schema - Rich structured reasoning schema
 * Zod schemas and types for the think tool
 */

import { z } from "zod";

// ============================================================================
// SCHEMA - Rich structured reasoning schema
// ============================================================================

export const NextActionSchema = z.union([
  z.string().describe("Next action description"),
  z
    .object({
      tool: z.string().optional().describe("Tool to use"),
      action: z.string().describe("Action to perform"),
      parameters: z.record(z.string(), z.unknown()).optional().describe("Parameters"),
      expectedOutput: z.string().optional().describe("Expected result"),
    })
    .describe("Structured action with tool details"),
]);

export const ThinkSchema = z.object({
  // Core required fields
  step_number: z.number().int().min(1).describe("Step number (starts 1)"),
  estimated_total: z.number().int().min(1).describe("Estimated total steps"),
  purpose: z
    .string()
    .describe(
      "Step category: analysis, action, reflection, decision, summary, validation, exploration, hypothesis, correction, planning",
    ),
  context: z.string().describe("Known context/findings"),
  thought: z.string().describe("Current reasoning process"),
  outcome: z.string().describe("Result from this step"),
  next_action: NextActionSchema.describe("What to do next"),
  rationale: z.string().describe("Why this action"),

  // Completion
  is_final_step: z.boolean().default(false).describe("Mark as final step"),

  // Confidence tracking
  confidence: z.number().min(0).max(1).optional().describe("Confidence in this step (0-1)"),
  uncertainty_notes: z.string().optional().describe("Uncertainties/assumptions"),

  // Revision support
  revises_step: z.number().int().min(1).optional().describe("Step # being revised"),
  revision_reason: z.string().optional().describe("Why revising"),

  // Branching support
  branch_from: z.number().int().min(1).optional().describe("Step to branch from"),
  branch_id: z.string().optional().describe("Branch identifier"),
  branch_name: z.string().optional().describe("Branch name"),

  // Dependencies
  dependencies: z.array(z.number().int().min(1)).optional().describe("Steps this depends on"),

  // Tool tracking
  tools_used: z.array(z.string()).optional().describe("Tools used in this step"),
  external_context: z.record(z.string(), z.unknown()).optional().describe("External data"),

  // Session
  session_id: z.string().optional().describe("Session ID"),

  // Guidance/verification extensions
  guidance: z.boolean().default(true).describe("Enable proactive guidance"),
  verify: z.boolean().default(false).describe("Run domain verification"),
  domain: z.enum(["math", "logic", "code", "general"]).optional().describe("Domain hint"),
  local_compute: z.boolean().default(false).describe("Try local compute"),

  // Local compute augmentation - inject computed values into thought
  augment_compute: z
    .boolean()
    .default(false)
    .describe("Inject computed values (math, logic, probability, facts)"),
  system_prompt: z.string().optional().describe("System prompt for augmentation filtering"),

  // Compression control
  compression_level: z
    .enum(["none", "auto", "aggressive"])
    .default("auto")
    .describe("none (off), auto (entropy-based), aggressive (always)"),

  // Baseline mode - pure pass-through, no features
  baseline: z.boolean().default(false).describe("Bypass all features"),
});

export type ThinkArgs = z.infer<typeof ThinkSchema>;
