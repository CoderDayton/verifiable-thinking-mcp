/**
 * Solver Registry - Auto-discovery and registration of compute solvers
 *
 * Enables drop-in new solvers without editing this file.
 * Each solver declares its type mask and priority.
 *
 * To add a new solver:
 * 1. Create a file in ./solvers/
 * 2. Export `solver` (single) or `solvers` (array) with Solver interface
 * 3. Done - it auto-registers on import
 */

import { dirname, join } from "node:path";
import { Glob } from "bun";
import { type SolverMask, SolverType, shouldTrySolver } from "./classifier.ts";
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
// AUTO-DISCOVERY
// Glob all .ts files in ./solvers/ and import them
// Each file exports `solver` or `solvers` array
// =============================================================================

const solversDir = join(dirname(import.meta.path), "solvers");
const glob = new Glob("*.ts");

for await (const file of glob.scan(solversDir)) {
  // Skip index.ts barrel file
  if (file === "index.ts") continue;

  const modulePath = join(solversDir, file);
  const mod = await import(modulePath);

  // Register single solver
  if (mod.solver) {
    registerSolver(mod.solver);
  }

  // Register multiple solvers
  if (mod.solvers && Array.isArray(mod.solvers)) {
    for (const s of mod.solvers) {
      registerSolver(s);
    }
  }
}
