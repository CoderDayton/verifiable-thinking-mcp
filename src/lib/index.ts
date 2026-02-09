/**
 * Main barrel export for src/lib/
 * Re-exports commonly used utilities for convenient imports
 */

// Cache utilities
export { verificationCache } from "./cache";
// Compression utilities
export {
  calculateEntropy,
  cleanFillers,
  compress,
  computeNCD,
  computeNCDAsync,
  isMetaSentence,
  jaccardSimilarity,
  needsCompression,
  quickCompress,
  splitSentences,
  tokenizeForTfIdf,
} from "./compression";
// Local compute
export {
  computeConfidence,
  extractAndCompute,
  isLikelyComputable,
  tryLocalCompute,
} from "./compute/index";
// Concept tracking
export {
  ConceptTracker,
  clearTracker,
  getTracker,
} from "./concepts";
// Unified domain detection
export {
  type DomainResult,
  detectDomainFull,
  detectGranularDomain,
  detectMetaDomain,
  detectVerificationDomain,
  type GranularDomain,
  getDomainWeight,
  getRelevantSolvers,
  isSolverRelevant,
  type MetaDomain,
} from "./domain";
// Answer extraction & matching
export {
  type AnswerExtractionResult,
  answersMatch,
  extractAnswer,
  extractAnswerWithConfidence,
  normalizeAnswer,
  parseFraction,
  shouldStreamStrip,
  stripLLMOutput,
  stripLLMOutputAsync,
  stripLLMOutputStreaming,
  stripMarkdown,
  stripThinkingTagsFast,
} from "./extraction";
// LLM-as-Judge for response comparison
export {
  type DimensionScores,
  type JudgeInput,
  type JudgeResult,
  type JudgeSummary,
  judgeBatch,
  judgeResponses,
  type LLMJudgeFunc,
  summarizeJudgments,
} from "./judge";
// Math module (operators, tokenizer, AST) - also re-exported via verification
export * as math from "./math";
// Session management
export {
  SessionManager,
  SessionManagerImpl,
  type ThoughtRecord,
} from "./session";
// Think module (comprehensive)
export * from "./think";
// Token estimation (from think/verification)
export {
  estimateCodeTokens,
  estimateTokens,
  estimateTokensBatch,
} from "./think/verification";
// Fast token estimation (dependency-free)
export { clearEstimateCache, estimateTokensFast } from "./tokens-fast";
// Verification (domain-specific)
export {
  type ASTNode,
  type ASTResult,
  type BinaryNode,
  buildAST,
  canBeUnary,
  clearVerificationCache,
  compareExpressions,
  compareOperatorPrecedence,
  type EvalResult,
  type ExpressionValidation,
  evaluateExpression,
  type FormatASTOptions,
  type FormatOptions,
  formatAST,
  formatExpression,
  getOperatorArity,
  getOperatorArityInContext,
  getOperatorPrecedence,
  getVerificationCacheStats,
  isMathOperator,
  isRightAssociative,
  MATH_OPERATOR_PATTERN,
  MATH_OPERATORS,
  type MathToken,
  type MathTokenType,
  type NumberNode,
  simplifyAST,
  type TokenizeResult,
  tokenizeMathExpression,
  type UnaryNode,
  type VariableNode,
  validateExpression,
  verify,
} from "./verification";
