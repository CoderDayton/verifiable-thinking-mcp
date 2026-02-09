/**
 * Solvers index - re-exports all solver functions
 */

export { tryArithmetic } from "./arithmetic.ts";
export { simpsonIntegrate, tryCalculus } from "./calculus.ts";
export {
  type DerivationErrorExplanation,
  type DerivationLatexOptions,
  type DerivationResult,
  type DetectedMistake,
  derivationTextToLatex,
  derivationToLatex,
  detectCommonMistakes,
  detectCommonMistakesFromText,
  explainDerivationError,
  type MistakeDetectionResult,
  type MistakeType,
  type NextStepSuggestion,
  type SimplificationPath,
  type SimplificationStep,
  type SimplifiedStep,
  type SimplifyDerivationResult,
  simplifyDerivation,
  simplifyDerivationText,
  suggestNextStep,
  suggestNextStepFromText,
  suggestSimplificationPath,
  tryDerivation,
  verifyDerivationSteps,
} from "./derivation.ts";
export { tryMathFacts } from "./facts.ts";
export { canonicalizeExpression, tryFormula, trySimplifyToConstant } from "./formula.ts";
export { tryLogic } from "./logic.ts";
export { tryProbability } from "./probability.ts";
export { tryCRTProblem, tryMultiStepWordProblem, tryWordProblem } from "./word-problems.ts";
