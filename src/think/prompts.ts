/**
 * Prompt Templates for LLM Interactions
 * Centralized prompts used by the think tool and benchmarks
 *
 * TERSE MODE: ~50% fewer tokens using Chain-of-Draft style
 * - Short fragments instead of full sentences
 * - Minimalist system prompts
 * - Direct answer extraction
 */

// =============================================================================
// VERBOSITY CONFIGURATION
// =============================================================================

export type Verbosity = "terse" | "normal" | "verbose";

/**
 * Determine verbosity based on question characteristics
 * Short questions without "explain/why/how" get terse mode
 */
export function getVerbosity(question: string): Verbosity {
  const wordCount = question.split(/\s+/).length;
  const needsExplanation = /explain|why|how\s+does|describe|compare/i.test(question);
  const isSimple = /^\s*(?:what|calculate|compute|is)\s+/i.test(question);

  if (needsExplanation) return "verbose";
  if (wordCount < 15 && isSimple) return "terse";
  return "normal";
}

// =============================================================================
// SYSTEM PROMPTS - NORMAL (default)
// =============================================================================

export const SYSTEM_BASELINE = "Answer directly and concisely. Plain text only.";
export const SYSTEM_REASONING =
  "Show reasoning step-by-step, then give final answer. Plain text math only.";
export const SYSTEM_VERIFICATION = "Double-check reasoning. Fix errors. Plain text only.";
export const SYSTEM_ANSWER_ONLY = "Answer only.";

// System prompt for explanatory questions - emphasizes conciseness
export const SYSTEM_EXPLANATORY = "Explain clearly and concisely. Plain text only.";

// =============================================================================
// DOMAIN-SPECIFIC PROMPTS (token-light steering)
// =============================================================================

/**
 * Domain-specific system prompts - concise but effective steering.
 * ~15-25 tokens each, optimized for explanation quality.
 */
export const DOMAIN_PROMPTS: Record<string, { system: string; style: string }> = {
  // Technical domains
  coding: {
    system: "Explain clearly. Use code examples when they clarify.",
    style: "technical",
  },
  scientific: {
    system: "Explain precisely. Use correct terminology and show derivations.",
    style: "precise",
  },
  // Educational - clarity focus
  educational: {
    system: "Explain clearly. Start with intuition, then details.",
    style: "pedagogical",
  },
  // Financial - accuracy focus
  financial: {
    system: "Explain clearly. State assumptions and show calculations.",
    style: "careful",
  },
  // General - balanced
  general: {
    system: "Explain clearly and directly.",
    style: "balanced",
  },
};

// =============================================================================
// SYSTEM PROMPTS - TERSE (~50% fewer tokens)
// =============================================================================

export const SYSTEM_BASELINE_TERSE = "Answer directly.";
export const SYSTEM_REASONING_TERSE = "Solve step-by-step. End: Answer: [X]";
export const SYSTEM_VERIFICATION_TERSE = "Verify. Fix errors. Answer: [X]";
export const SYSTEM_ANSWER_ONLY_TERSE = "Answer only.";

// =============================================================================
// USER PROMPT TEMPLATES - NORMAL
// =============================================================================

export function formatBaselinePrompt(question: string): string {
  return `${question}

Answer clearly. Number for numeric, choice letter for multiple choice.`;
}

export function formatReasoningPrompt(question: string): string {
  return `${question}

End with "Answer: " followed by just the answer.`;
}

export function formatVerificationPrompt(
  question: string,
  initialReasoning: string,
  patterns: string[],
): string {
  return `Verify: ${question}

Prior reasoning:
${initialReasoning}

Risk flags: ${patterns.join(", ")}

Check for errors, correct if needed.

Answer:`;
}

export function formatCriticalCheckPrompt(question: string): string {
  return `${question}

Double-check. Answer only:`;
}

/**
 * Format an explanatory prompt - concise explanations without padding
 */
export function formatExplanatoryPrompt(question: string): string {
  return `${question}

Be direct. Focus on key concepts.`;
}

/**
 * Format a domain-aware explanatory prompt (token-light)
 * Just the question - system prompt provides domain steering
 */
export function formatDomainExplanatoryPrompt(question: string, _metaDomain: string): string {
  return question;
}

/**
 * Get domain-aware system prompt for explanatory questions
 */
export function getDomainSystemPrompt(metaDomain: string): string {
  return DOMAIN_PROMPTS[metaDomain]?.system ?? "Direct answer.";
}

// =============================================================================
// USER PROMPT TEMPLATES - TERSE (Chain-of-Draft style)
// ~50% fewer tokens, uses fragments and minimal structure
// =============================================================================

export function formatBaselinePromptTerse(question: string): string {
  return `Q: ${question}
A:`;
}

export function formatReasoningPromptTerse(question: string): string {
  return `Q: ${question}
Steps (max 5 words each):
Answer:`;
}

export function formatVerificationPromptTerse(
  question: string,
  initialReasoning: string,
  patterns: string[],
): string {
  // Extract just the answer from initial reasoning if possible
  const answerMatch = initialReasoning.match(/(?:answer|result)[:\s]+([^\n.]+)/i);
  const prevAnswer = answerMatch?.[1]?.trim() || "?";

  return `Q: ${question}
Prev: ${prevAnswer}
Flags: ${patterns.slice(0, 2).join(", ")}
Check. Correct if needed.
Answer:`;
}

export function formatCriticalCheckPromptTerse(question: string): string {
  return `${question}
Answer:`;
}

// =============================================================================
// UNIFIED PROMPT GETTERS (respects verbosity setting)
// =============================================================================

export function getSystemPrompt(
  type: "baseline" | "reasoning" | "verification" | "answer_only" | "explanatory",
  verbosity: Verbosity = "normal",
): string {
  if (verbosity === "terse") {
    switch (type) {
      case "baseline":
        return SYSTEM_BASELINE_TERSE;
      case "reasoning":
        return SYSTEM_REASONING_TERSE;
      case "verification":
        return SYSTEM_VERIFICATION_TERSE;
      case "answer_only":
        return SYSTEM_ANSWER_ONLY_TERSE;
      case "explanatory":
        return SYSTEM_EXPLANATORY; // No terse version, use standard
    }
  }
  // Normal or verbose use standard prompts
  switch (type) {
    case "baseline":
      return SYSTEM_BASELINE;
    case "reasoning":
      return SYSTEM_REASONING;
    case "verification":
      return SYSTEM_VERIFICATION;
    case "answer_only":
      return SYSTEM_ANSWER_ONLY;
    case "explanatory":
      return SYSTEM_EXPLANATORY;
  }
}

export function getUserPrompt(
  type: "baseline" | "reasoning" | "verification" | "critical" | "explanatory",
  question: string,
  verbosity: Verbosity = "normal",
  opts?: { initialReasoning?: string; patterns?: string[] },
): string {
  if (verbosity === "terse") {
    switch (type) {
      case "baseline":
        return formatBaselinePromptTerse(question);
      case "reasoning":
        return formatReasoningPromptTerse(question);
      case "verification":
        return formatVerificationPromptTerse(
          question,
          opts?.initialReasoning || "",
          opts?.patterns || [],
        );
      case "critical":
        return formatCriticalCheckPromptTerse(question);
      case "explanatory":
        return formatExplanatoryPrompt(question); // No terse version
    }
  }
  // Normal or verbose use standard prompts
  switch (type) {
    case "baseline":
      return formatBaselinePrompt(question);
    case "reasoning":
      return formatReasoningPrompt(question);
    case "verification":
      return formatVerificationPrompt(question, opts?.initialReasoning || "", opts?.patterns || []);
    case "critical":
      return formatCriticalCheckPrompt(question);
    case "explanatory":
      return formatExplanatoryPrompt(question);
  }
}
