/**
 * Think Library - Barrel export for think-related modules
 */

// Local complexity assessment
export {
  assessPromptComplexity,
  type ComplexityResult,
  getTrivialPrompt,
  isTrivialQuestion,
} from "./complexity.ts";
// Guidance engine (failure pattern detection for free-form reasoning)
export {
  analyzeThought,
  detectDomain,
  FAILURE_PATTERNS,
  type FailurePattern,
  type ThoughtAnalysis,
  VALID_PURPOSES,
} from "./guidance.ts";

// Prompts (verbosity-aware templates)
export {
  // User prompts
  formatBaselinePrompt,
  formatBaselinePromptTerse,
  formatCriticalCheckPrompt,
  formatCriticalCheckPromptTerse,
  formatReasoningPrompt,
  formatReasoningPromptTerse,
  formatVerificationPrompt,
  formatVerificationPromptTerse,
  // Unified getters
  getSystemPrompt,
  getUserPrompt,
  getVerbosity,
  SYSTEM_ANSWER_ONLY,
  SYSTEM_ANSWER_ONLY_TERSE,
  // System prompts
  SYSTEM_BASELINE,
  SYSTEM_BASELINE_TERSE,
  SYSTEM_REASONING,
  SYSTEM_REASONING_TERSE,
  SYSTEM_VERIFICATION,
  SYSTEM_VERIFICATION_TERSE,
  type Verbosity,
} from "./prompts.ts";
// Schema
export { NextActionSchema, type ThinkArgs, ThinkSchema } from "./schema.ts";

// Types
export type {
  BaselineResult,
  BenchmarkResults,
  BenchmarkSummary,
  Question,
  QuestionSet,
  RunResult,
  ToolResult,
} from "./types.ts";

// Verification
export { estimateTokens, verifyAnswer } from "./verification.ts";
