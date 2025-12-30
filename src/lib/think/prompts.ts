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

export const SYSTEM_BASELINE =
  "You are a helpful assistant. Answer questions directly and concisely. Use plain text, not LaTeX.";
export const SYSTEM_REASONING =
  "You are a careful reasoning assistant. Show your reasoning, then give the final answer clearly. Use plain text math (e.g., x + 1 = 2), not LaTeX.";
export const SYSTEM_VERIFICATION =
  "You are a verification assistant. Double-check reasoning carefully. Use plain text, not LaTeX.";
export const SYSTEM_ANSWER_ONLY = "Give only the answer, nothing else.";

// System prompt for explanatory questions - emphasizes conciseness
export const SYSTEM_EXPLANATORY =
  "You are a clear, concise explainer. Explain concepts directly without unnecessary preamble or repetition. Use plain text.";

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

Provide your answer clearly. If it's a number, state just the number. If it's a choice, state just the choice.`;
}

export function formatReasoningPrompt(question: string): string {
  return `${question}

Solve this step by step. At the very end, write "Answer: " followed by just the answer (number, letter, or short phrase).`;
}

export function formatVerificationPrompt(
  question: string,
  initialReasoning: string,
  patterns: string[],
): string {
  return `I need to verify my answer to: ${question}

My initial reasoning:
${initialReasoning}

Risk patterns detected: ${patterns.join(", ")}

Please:
1. Check for errors in the reasoning above
2. Verify the calculation/logic step by step
3. Provide the corrected answer if needed

Final Answer: [answer]`;
}

export function formatCriticalCheckPrompt(question: string): string {
  return `CRITICAL CHECK for: ${question}

Previous attempts flagged as high risk. 

Provide ONLY the numerical/factual answer, nothing else. Double-check before responding.

Answer:`;
}

/**
 * Format an explanatory prompt - concise explanations without padding
 */
export function formatExplanatoryPrompt(question: string): string {
  return `${question}

Be direct and concise. Focus on the key concepts without unnecessary repetition or filler phrases.`;
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
