/**
 * Derivation solver - verifies multi-step algebraic derivations
 *
 * Uses compareExpressions to check that each step in a derivation is
 * algebraically equivalent to the previous step. Catches "magic" steps
 * in proofs where the transformation isn't valid.
 *
 * This is a barrel file re-exporting from focused modules:
 * - derivation-core.ts: Core verification logic
 * - derivation-transform.ts: Algebraic transformation patterns
 * - derivation-simplify.ts: Simplification and next-step suggestions
 * - derivation-mistakes.ts: Common mistake detection
 * - derivation-latex.ts: LaTeX conversion
 *
 * @module derivation
 */

// Core verification
export {
  cleanExpressionPart,
  type DerivationErrorExplanation,
  type DerivationResult,
  explainDerivationError,
  extractDerivationSteps,
  type StepVerification,
  tryDerivation,
  verifyDerivationSteps,
} from "./derivation-core.ts";
// LaTeX conversion
export {
  type DerivationLatexOptions,
  derivationTextToLatex,
  derivationToLatex,
} from "./derivation-latex.ts";
// Mistake detection
export {
  type DetectedMistake,
  detectCommonMistakes,
  detectCommonMistakesFromText,
  type MistakeDetectionResult,
  type MistakeType,
} from "./derivation-mistakes.ts";
// Simplification
export {
  type NextStepSuggestion,
  parseToAST,
  type SimplificationPath,
  type SimplificationStep,
  type SimplifiedStep,
  type SimplifyDerivationResult,
  simplifyDerivation,
  simplifyDerivationText,
  suggestNextStep,
  suggestNextStepFromText,
  suggestSimplificationPath,
} from "./derivation-simplify.ts";
// Transform utilities and patterns
export {
  applyTransformation,
  containsPattern,
  gcd,
  isBinaryOp,
  nodesEqual,
  normalizeOperator,
  TRANSFORM_PATTERNS,
  type TransformPattern,
} from "./derivation-transform.ts";
