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

// Helpers (extracted for cognitive complexity reduction)
export {
  type AugmentResult,
  assessComplexity,
  buildBaselineResponse,
  buildRecord,
  buildResponse,
  type ComplexityInfo,
  type CompressionLevel,
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
  type StreamFn,
  storeThought,
  tryAugment,
  tryCompute,
  validateBranch,
  validateRevision,
} from "./helpers.ts";

// Prompts (verbosity-aware templates)
export {
  // Domain-aware prompts
  DOMAIN_PROMPTS,
  // User prompts
  formatBaselinePrompt,
  formatBaselinePromptTerse,
  formatCriticalCheckPrompt,
  formatCriticalCheckPromptTerse,
  formatDomainExplanatoryPrompt,
  formatExplanatoryPrompt,
  formatReasoningPrompt,
  formatReasoningPromptTerse,
  formatVerificationPrompt,
  formatVerificationPromptTerse,
  getDomainSystemPrompt,
  // Unified getters
  getSystemPrompt,
  getUserPrompt,
  getVerbosity,
  SYSTEM_ANSWER_ONLY,
  SYSTEM_ANSWER_ONLY_TERSE,
  // System prompts
  SYSTEM_BASELINE,
  SYSTEM_BASELINE_TERSE,
  SYSTEM_EXPLANATORY,
  SYSTEM_REASONING,
  SYSTEM_REASONING_TERSE,
  SYSTEM_VERIFICATION,
  SYSTEM_VERIFICATION_TERSE,
  type Verbosity,
} from "./prompts.ts";

// Routing (complexity-based path selection)
export {
  buildSpotCheckPrompt,
  getComplexityInfo,
  isExplanatoryQuestion,
  parseSpotCheckResponse,
  type RoutePrompts,
  type RouteResult,
  type RoutingPath,
  routeQuestion,
  type SpotCheckInput,
} from "./route.ts";

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
