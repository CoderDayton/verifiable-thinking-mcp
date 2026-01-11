/**
 * Token estimation utilities
 *
 * Model-aware heuristics for token estimation without external dependencies.
 * Falls back to ~4 chars/token for unknown models (GPT-family baseline).
 */

/**
 * Model family detection and chars-per-token ratios.
 * Based on empirical measurements from tokenizer research.
 *
 * Sources:
 * - GPT-4/3.5: ~4 chars/token (BPE, cl100k_base)
 * - Claude: ~3.5 chars/token (slightly more efficient)
 * - Llama/Mistral: ~4.2 chars/token (sentencepiece)
 * - Gemini: ~4 chars/token (similar to GPT)
 */
const MODEL_CHAR_RATIOS: Record<string, number> = {
  // OpenAI
  "gpt-4": 4.0,
  "gpt-3.5": 4.0,
  o1: 4.0,
  o3: 4.0,

  // Anthropic
  claude: 3.5,

  // Meta
  llama: 4.2,

  // Mistral
  mistral: 4.2,
  mixtral: 4.2,

  // Google
  gemini: 4.0,

  // DeepSeek
  deepseek: 4.0,

  // Qwen
  qwen: 4.0,

  // Default fallback
  default: 4.0,
};

/**
 * Get chars-per-token ratio for a model.
 * Checks LLM_MODEL env var if no model specified.
 */
function getCharRatio(model?: string): number {
  const modelName = (model || process.env.LLM_MODEL || "").toLowerCase();

  for (const [prefix, ratio] of Object.entries(MODEL_CHAR_RATIOS)) {
    if (prefix !== "default" && modelName.includes(prefix)) {
      return ratio;
    }
  }

  return MODEL_CHAR_RATIOS.default as number;
}

/**
 * Estimate token count for a string.
 * Uses model-aware char/token ratios when LLM_MODEL is set.
 */
export function estimateTokens(text: string, model?: string): number {
  if (!text) return 0;
  const ratio = getCharRatio(model);
  return Math.ceil(text.length / ratio);
}

/**
 * Estimate tokens for a JSON-serializable object
 */
export function estimateObjectTokens(obj: unknown, model?: string): number {
  if (obj === null || obj === undefined) return 0;
  const json = JSON.stringify(obj);
  return estimateTokens(json, model);
}

/**
 * Token usage metadata for tool responses
 */
export interface TokenUsageMetadata {
  /** Estimated tokens in the tool input */
  input_tokens: number;
  /** Estimated tokens in the tool output */
  output_tokens: number;
  /** Total estimated tokens */
  total_tokens: number;
}

/**
 * Calculate token usage for a tool call
 */
export function calculateTokenUsage(input: unknown, output: unknown): TokenUsageMetadata {
  const inputTokens = estimateObjectTokens(input);
  const outputTokens = estimateObjectTokens(output);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  };
}

// ============================================================================
// SESSION TOKEN TRACKING
// ============================================================================

/**
 * Cumulative token usage for a session
 */
export interface SessionTokenUsage {
  /** Total input tokens across all operations */
  total_input: number;
  /** Total output tokens across all operations */
  total_output: number;
  /** Combined total */
  total: number;
  /** Number of operations tracked */
  operations: number;
}

/** Session token accumulators */
const sessionTokens = new Map<string, SessionTokenUsage>();

/**
 * Track token usage for a session.
 * Call this after each tool operation to accumulate usage.
 */
export function trackSessionTokens(
  sessionId: string,
  usage: TokenUsageMetadata,
): SessionTokenUsage {
  const existing = sessionTokens.get(sessionId) || {
    total_input: 0,
    total_output: 0,
    total: 0,
    operations: 0,
  };

  const updated: SessionTokenUsage = {
    total_input: existing.total_input + usage.input_tokens,
    total_output: existing.total_output + usage.output_tokens,
    total: existing.total + usage.total_tokens,
    operations: existing.operations + 1,
  };

  sessionTokens.set(sessionId, updated);
  return updated;
}

/**
 * Get cumulative token usage for a session
 */
export function getSessionTokens(sessionId: string): SessionTokenUsage | null {
  return sessionTokens.get(sessionId) || null;
}

/**
 * Clear token tracking for a session
 */
export function clearSessionTokens(sessionId: string): boolean {
  return sessionTokens.delete(sessionId);
}

/**
 * Clear all session token tracking
 */
export function clearAllSessionTokens(): number {
  const count = sessionTokens.size;
  sessionTokens.clear();
  return count;
}
