/**
 * Solver Registry - Registration of compute solvers
 *
 * Each solver declares its type mask and priority.
 *
 * To add a new solver:
 * 1. Create a file in ./solvers/
 * 2. Export `solver` (single) or `solvers` (array) with Solver interface
 * 3. Import and register it below
 */

import { type SolverMask, SolverType, shouldTrySolver } from "./classifier.ts";
// Import all solver modules
import * as arithmeticModule from "./solvers/arithmetic.ts";
import * as calculusModule from "./solvers/calculus.ts";
import * as derivationModule from "./solvers/derivation.ts";
import * as factsModule from "./solvers/facts.ts";
import * as formulaModule from "./solvers/formula.ts";
import * as logicModule from "./solvers/logic.ts";
import * as probabilityModule from "./solvers/probability.ts";
import * as statisticsModule from "./solvers/statistics.ts";
import * as wordProblemsModule from "./solvers/word-problems.ts";
import type { ComputeResult, Solver } from "./types.ts";

// Re-export Solver type for convenience
export type { Solver } from "./types.ts";

// =============================================================================
// REGISTRY
// =============================================================================

const solvers: Solver[] = [];
let sortedCache: Solver[] | null = null;

/**
 * Register a solver. Call this at module load time.
 */
export function registerSolver(solver: Solver): void {
  solvers.push(solver);
  sortedCache = null; // Invalidate cache
}

/**
 * Get all registered solvers, sorted by priority
 */
export function getSolvers(): Solver[] {
  if (!sortedCache) {
    sortedCache = [...solvers].sort((a, b) => a.priority - b.priority);
  }
  return sortedCache;
}

/**
 * Get solvers that match a given mask, sorted by priority
 */
export function getSolversForMask(mask: SolverMask): Solver[] {
  return getSolvers().filter((s) => shouldTrySolver(mask, s.types));
}

/**
 * Run solvers matching the mask until one succeeds
 */
export function runSolvers(text: string, lower: string, mask: SolverMask): ComputeResult {
  const matchingSolvers = getSolversForMask(mask);

  for (const solver of matchingSolvers) {
    const result = solver.solve(text, lower);
    if (result.solved) {
      return result;
    }
  }

  return { solved: false, confidence: 0 };
}

/**
 * Get registry stats for debugging
 */
export function getRegistryStats(): { count: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};

  for (const solver of solvers) {
    if (solver.types & SolverType.ARITHMETIC) byType.arithmetic = (byType.arithmetic || 0) + 1;
    if (solver.types & SolverType.FORMULA_TIER1)
      byType.formula_tier1 = (byType.formula_tier1 || 0) + 1;
    if (solver.types & SolverType.FORMULA_TIER2)
      byType.formula_tier2 = (byType.formula_tier2 || 0) + 1;
    if (solver.types & SolverType.FORMULA_TIER3)
      byType.formula_tier3 = (byType.formula_tier3 || 0) + 1;
    if (solver.types & SolverType.FORMULA_TIER4)
      byType.formula_tier4 = (byType.formula_tier4 || 0) + 1;
    if (solver.types & SolverType.WORD_PROBLEM)
      byType.word_problem = (byType.word_problem || 0) + 1;
    if (solver.types & SolverType.MULTI_STEP) byType.multi_step = (byType.multi_step || 0) + 1;
    if (solver.types & SolverType.CALCULUS) byType.calculus = (byType.calculus || 0) + 1;
    if (solver.types & SolverType.FACTS) byType.facts = (byType.facts || 0) + 1;
    if (solver.types & SolverType.LOGIC) byType.logic = (byType.logic || 0) + 1;
    if (solver.types & SolverType.PROBABILITY) byType.probability = (byType.probability || 0) + 1;
    if (solver.types & SolverType.DERIVATION) byType.derivation = (byType.derivation || 0) + 1;
  }

  return { count: solvers.length, byType };
}

/**
 * List all registered solvers with their descriptions (for debugging/docs)
 */
export function listSolvers(): Array<{ name: string; description: string; priority: number }> {
  return getSolvers().map((s) => ({
    name: s.name,
    description: s.description ?? "(no description)",
    priority: s.priority,
  }));
}

// =============================================================================
// EXPLICIT SOLVER REGISTRATION
// Register all solvers from modules (no Bun.Glob needed - works with Node.js too)
// =============================================================================

// Helper to register solvers from a module
function registerFromModule(mod: Record<string, unknown>): void {
  // Register single solver
  if (mod.solver && typeof mod.solver === "object") {
    registerSolver(mod.solver as Solver);
  }

  // Register multiple solvers
  if (mod.solvers && Array.isArray(mod.solvers)) {
    for (const s of mod.solvers) {
      registerSolver(s as Solver);
    }
  }
}

// Register all solver modules
registerFromModule(arithmeticModule);
registerFromModule(calculusModule);
registerFromModule(derivationModule);
registerFromModule(factsModule);
registerFromModule(formulaModule);
registerFromModule(logicModule);
registerFromModule(probabilityModule);
registerFromModule(statisticsModule);
registerFromModule(wordProblemsModule);
