/**
 * Type definitions for the compute module
 */

export interface ComputeResult {
  solved: boolean;
  result?: string | number;
  method?: string;
  confidence: number;
  time_ms?: number;
}

export interface ExtractedComputation {
  original: string;
  result: number | string;
  method: string;
  start: number;
  end: number;
}

export interface AugmentedResult {
  /** Original text with computations injected */
  augmented: string;
  /** List of all computations found and solved */
  computations: ExtractedComputation[];
  /** Whether any computations were found */
  hasComputations: boolean;
  /** Time taken in ms */
  time_ms: number;
}

export interface CacheEntry {
  result: ComputeResult;
  timestamp: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export interface WordProblemMatch {
  pattern: RegExp;
  compute: (match: RegExpMatchArray) => number | null;
  method: string;
}

export interface Entity {
  name: string;
  value: number | null;
  dependsOn: string | null;
  operation: ((x: number) => number) | null;
}

export interface PolyTerm {
  coeff: number;
  exp: number;
}

export interface ComputeConfidence {
  /** Overall confidence score (0-1) */
  score: number;
  /** Breakdown of what matched */
  signals: {
    positive: string[];
    negative: string[];
  };
  /** Recommended action */
  recommendation: "skip" | "try_local" | "try_local_first" | "local_only";
}

/** Weighted signal for confidence calculation */
export interface WeightedSignal {
  pattern: RegExp;
  weight: number;
  name: string;
}

/** Negative signal for confidence calculation */
export interface NegativeSignal {
  pattern: RegExp;
  penalty: number;
  name: string;
}

// =============================================================================
// SOLVER REGISTRY TYPES
// =============================================================================

/** Bitmask for solver types (imported from classifier in practice) */
export type SolverMask = number;

/** Solver registration interface - solvers export this */
export interface Solver {
  /** Unique name for this solver */
  name: string;
  /** Human-readable description of what this solver handles */
  description?: string;
  /** Bitmask of solver types this handles */
  types: SolverMask;
  /** Priority within type (lower = run first) */
  priority: number;
  /** The solve function */
  solve: (text: string, lower: string) => ComputeResult;
}
