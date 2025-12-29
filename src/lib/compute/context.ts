/**
 * Context-Aware Compute
 *
 * Combines system prompt awareness with local compute.
 * Filters computations by domain relevance before injection.
 *
 * Use case: A financial advisor system prompt shouldn't trigger
 * calculus injections even if the user mentions derivatives.
 */

import { detectMetaDomain, getRelevantSolvers, type MetaDomain } from "../domain.ts";
import { extractAndCompute } from "./extract.ts";
import { filterByDomainRelevance, isMethodRelevant } from "./filter.ts";
import type { AugmentedResult, ExtractedComputation } from "./types.ts";

// =============================================================================
// TYPES
// =============================================================================

export interface ContextAwareInput {
  /** System prompt (defines domain context) */
  systemPrompt?: string;
  /** User query (secondary context) */
  userQuery?: string;
  /** Thought text to compute */
  thought: string;
}

export interface ContextAwareResult extends AugmentedResult {
  /** Detected meta-domain from context */
  domain: MetaDomain;
  /** How many computations were filtered out by domain */
  filteredCount: number;
  /** Computations that were removed (for debugging) */
  filteredComputations: ExtractedComputation[];
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Extract and compute with domain-aware filtering.
 *
 * Algorithm:
 * 1. Detect domain from context (systemPrompt > userQuery > thought)
 * 2. Extract all computations from thought
 * 3. Filter by domain relevance
 * 4. Inject only relevant computations
 *
 * @param input - Thought text with optional system prompt context
 * @returns Augmented thought with only domain-relevant computations
 */
export function contextAwareCompute(input: ContextAwareInput): ContextAwareResult {
  const start = performance.now();

  // Determine context for domain detection
  // Priority: systemPrompt > userQuery > thought
  const contextText = input.systemPrompt || input.userQuery || input.thought;

  // Detect domain
  const domain = detectMetaDomain(contextText);

  // Extract all computations from thought
  const extraction = extractAndCompute(input.thought);

  // If no computations, fast path
  if (!extraction.hasComputations) {
    return {
      ...extraction,
      domain,
      filteredCount: 0,
      filteredComputations: [],
    };
  }

  // Filter by domain relevance
  const filterResult = filterByDomainRelevance(extraction.computations, contextText);

  // If nothing filtered, return original
  if (filterResult.stats.removed === 0) {
    return {
      ...extraction,
      domain,
      filteredCount: 0,
      filteredComputations: [],
    };
  }

  // Re-inject only relevant computations
  const augmented = injectComputations(input.thought, filterResult.relevant);

  return {
    augmented,
    computations: filterResult.relevant,
    hasComputations: filterResult.relevant.length > 0,
    time_ms: performance.now() - start,
    domain,
    filteredCount: filterResult.stats.removed,
    filteredComputations: filterResult.filtered,
  };
}

/**
 * Inject computations into text.
 * Used when we need to re-inject after filtering.
 */
function injectComputations(text: string, computations: ExtractedComputation[]): string {
  if (computations.length === 0) return text;

  // Sort by position descending to preserve indices
  const sorted = [...computations].sort((a, b) => b.start - a.start);

  let result = text;
  for (const comp of sorted) {
    const insertPos = comp.end;
    // Check for existing injection
    if (result.slice(insertPos, insertPos + 3) !== " [=") {
      const injection = ` [=${comp.result}]`;
      result = result.slice(0, insertPos) + injection + result.slice(insertPos);
    }
  }

  return result;
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Simple interface: compute with system prompt context.
 * Returns augmented text only.
 *
 * @param thought - Text to compute
 * @param systemPrompt - Optional system prompt for context
 * @returns Augmented text with domain-relevant computations
 */
export function computeWithContext(thought: string, systemPrompt?: string): string {
  return contextAwareCompute({ thought, systemPrompt }).augmented;
}

/**
 * Check if a computation would be filtered given a context.
 * Useful for testing/debugging.
 *
 * @param method - Computation method string
 * @param contextText - Context text for domain detection
 * @returns True if the computation would be kept
 */
export function wouldKeepComputation(method: string, contextText: string): boolean {
  const relevantMask = getRelevantSolvers(contextText);
  return isMethodRelevant(method, relevantMask);
}
