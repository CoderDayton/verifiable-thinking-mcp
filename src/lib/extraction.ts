/**
 * Answer Extraction Utilities
 * Priority-based extraction for structured and unstructured LLM responses
 * Based on HuggingFace Math-Verify patterns
 */

/**
 * Strip thinking/reasoning tags from model responses.
 * Handles various model-specific formats:
 * - DeepSeek/Qwen: <think>...</think>
 * - Generic: <thinking>...</thinking>, <reasoning>...</reasoning>
 * - Claude: <antithink>...</antithink>
 * - Gemini: <thought>...</thought>, <thoughts>...</thoughts>
 * - Llama: <reflection>...</reflection>
 * - Mistral: <internal_monologue>...</internal_monologue>
 * - GLM: <|begin_of_box|>...<|end_of_box|> (kept - this is answer boxing)
 * - Tool tags: <tool_call>...</tool_call>, <tool_result>...</tool_result>
 */
export function stripThinkingTags(text: string): string {
  return (
    text
      // Standard thinking tags
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      // Claude
      .replace(/<antithink>[\s\S]*?<\/antithink>/gi, "")
      // Gemini
      .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
      .replace(/<thoughts>[\s\S]*?<\/thoughts>/gi, "")
      // Llama
      .replace(/<reflection>[\s\S]*?<\/reflection>/gi, "")
      // Mistral
      .replace(/<internal_monologue>[\s\S]*?<\/internal_monologue>/gi, "")
      // Tool invocation artifacts (not user-facing)
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, "")
      // Artifact containers
      .replace(/<ARTIFACTS>[\s\S]*?<\/ARTIFACTS>/gi, "")
      .replace(/<document_content>[\s\S]*?<\/document_content>/gi, "")
      // Context tags (usually system/retrieval context, not answer)
      .replace(/<context>[\s\S]*?<\/context>/gi, "")
      .trim()
  );
}

/** Strip markdown formatting from text */
export function stripMarkdown(text: string): string {
  return (
    text
      // Code blocks (must come before inline code)
      .replace(/```[\s\S]*?```/g, "")
      // Bold **text** or __text__
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      // Italic *text* or _text_
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      // Inline code `text`
      .replace(/`([^`]+)`/g, "$1")
      // LaTeX boxed: $\boxed{...}$ or \boxed{...}
      .replace(/\$\\boxed\{([^}]+)\}\$/g, "$1")
      .replace(/\\boxed\{([^}]+)\}/g, "$1")
      // Other common LaTeX: $...$ inline math
      .replace(/\$([^$]+)\$/g, "$1")
      // Headings: # ## ### etc
      .replace(/^#{1,6}\s*/gm, "")
      // Strikethrough ~~text~~
      .replace(/~~([^~]+)~~/g, "$1")
      // Images ![alt](url) -> remove (MUST come before links)
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      // Links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Blockquotes > text -> text
      .replace(/^>\s*/gm, "")
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // List markers - * + or numbered
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      .trim()
  );
}

/** Clean number: remove commas, trim whitespace */
function cleanNumber(s: string): string {
  return s.replace(/,/g, "").trim();
}

/** Stopwords to filter out when extracting word answers */
const STOPWORDS = new Set([
  "is",
  "the",
  "a",
  "an",
  "to",
  "be",
  "it",
  "that",
  "this",
  "answer",
  "result",
  "final",
  "therefore",
  "thus",
  "so",
  "and",
  "or",
  "but",
  "of",
  "in",
  "for",
  "on",
  "with",
  "as",
  "at",
  "by",
  "from",
]);

/** Extract answer from a phrase like "45 degrees" or "YES because..." */
function extractFromPhrase(phrase: string): string | null {
  const trimmed = phrase.trim();

  // Priority 1: Leading number (with optional comma separators, decimals, fractions)
  const numMatch = trimmed.match(/^(-?[\d,]+(?:\.\d+)?(?:\/\d+)?)/);
  if (numMatch?.[1]) return cleanNumber(numMatch[1]);

  // Priority 2: Capitalized short answer (YES, NO, A, B, TRUE, FALSE, etc.)
  const capsMatch = trimmed.match(/^([A-Z][A-Z0-9]*)\b/);
  if (capsMatch?.[1] && capsMatch[1].length <= 10) return capsMatch[1];

  // Priority 3: First word if it's short and meaningful
  const firstWord = trimmed.split(/\s+/)[0];
  if (firstWord) {
    const cleaned = firstWord.replace(/[^a-zA-Z0-9.-]/g, "");
    if (cleaned.length >= 1 && cleaned.length <= 15 && !STOPWORDS.has(cleaned.toLowerCase())) {
      return cleaned;
    }
  }

  return null;
}

/** Extract last meaningful word from text (for YES/NO type answers) */
function extractLastMeaningfulWord(text: string): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);

  // Search backwards for a meaningful word
  for (let i = words.length - 1; i >= 0; i--) {
    const rawWord = words[i];
    if (rawWord) {
      const word = rawWord.replace(/[^a-zA-Z0-9.-]/g, "");
      if (word.length >= 1 && !STOPWORDS.has(word.toLowerCase())) {
        return word.slice(0, 20);
      }
    }
  }

  // Absolute fallback: return last word cleaned
  const lastWord = words[words.length - 1] ?? "";
  return lastWord.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 20) || "unknown";
}

/**
 * Extract answer from LLM response using priority-based pattern matching
 *
 * Priority order:
 * 0. If expectedAnswers provided, look for exact match in response (fastest path)
 * 1. LaTeX \boxed{X} (explicit answer marking)
 * 2. "Final Answer: X" (with colon)
 * 3. "Answer: X" (with colon)
 * 4. "The answer is X" / "answer is X"
 * 4b. "should be X" / "must be X"
 * 4c. Card flip patterns (Wason task)
 * 5. "Result: X"
 * 6. Last equation result "= X"
 * 7. Standalone numbers in last lines
 * 8. Last number in response
 * 9. Last meaningful word (for YES/NO/TRUE/FALSE)
 */
export function extractAnswer(response: string, expectedAnswers?: string[]): string {
  // Strip thinking tags first (e.g., <think>...</think>)
  const withoutThinking = stripThinkingTags(response);
  const cleaned = stripMarkdown(withoutThinking);

  // Priority 0: If we know expected answers, look for them directly in the response
  // This is the most reliable method when we have ground truth
  if (expectedAnswers && expectedAnswers.length > 0) {
    for (const expected of expectedAnswers) {
      // Look for the expected answer as a standalone value (not part of another word)
      const escapedExpected = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`\\b${escapedExpected}\\b`, "i");
      if (pattern.test(cleaned)) {
        return expected;
      }
    }
    // Also try normalized versions (e.g., "A, 7" vs "A,7")
    const normalizedResponse = cleaned.replace(/\s+/g, "").toLowerCase();
    for (const expected of expectedAnswers) {
      const normalizedExpected = expected.replace(/\s+/g, "").toLowerCase();
      if (normalizedResponse.includes(normalizedExpected)) {
        return expected;
      }
    }
  }

  // Priority 1: LaTeX boxed (highest confidence - LLM explicitly marked answer)
  const boxedMatch = cleaned.match(/\\boxed\{([^}]+)\}/);
  if (boxedMatch?.[1]) return cleanNumber(boxedMatch[1]);

  // Priority 2: "Final Answer: X" (with colon, very explicit)
  // Capture until newline or sentence end (period followed by space or end)
  const finalColonMatch = cleaned.match(/final\s+answer:\s*([^\n]+?)(?:\.\s|$)/i);
  if (finalColonMatch?.[1]) {
    const extracted = extractFromPhrase(finalColonMatch[1]);
    if (extracted) return extracted;
  }

  // Priority 3: "Answer: X" (with colon)
  const colonMatch = cleaned.match(/(?<!final\s)answer:\s*([^\n]+?)(?:\.\s|$)/i);
  if (colonMatch?.[1]) {
    const extracted = extractFromPhrase(colonMatch[1]);
    if (extracted) return extracted;
  }

  // Priority 4: "The answer is X" or "answer is X"
  const isMatch = cleaned.match(/(?:the\s+)?(?:final\s+)?answer\s+is\s+([^\n]+?)(?:\.\s|$)/i);
  if (isMatch?.[1]) {
    const extracted = extractFromPhrase(isMatch[1]);
    if (extracted) return extracted;
  }

  // Priority 4b: "should be X" or "must be X" (common in verification responses)
  const shouldBeMatch = cleaned.match(/(?:answer\s+)?(?:should|must)\s+be\s+([^\n.]+)/i);
  if (shouldBeMatch?.[1]) {
    const extracted = extractFromPhrase(shouldBeMatch[1].trim());
    if (extracted) return extracted;
  }

  // Priority 4c: "cards to flip are X" or "need to flip X" (Wason task specific)
  const flipMatch = cleaned.match(
    /(?:cards?\s+to\s+flip|need\s+to\s+flip|must\s+flip)\s+(?:are\s+)?([A-Z0-9,\s]+)/i,
  );
  if (flipMatch?.[1]) {
    // Clean up the card list
    const cards = flipMatch[1]
      .trim()
      .replace(/\s+and\s+/gi, ",")
      .replace(/\s+/g, "");
    if (cards) return cards;
  }

  // Priority 5: "Result: X"
  const resultMatch = cleaned.match(/result:\s*([^\n]+?)(?:\.\s|$)/i);
  if (resultMatch?.[1]) {
    const extracted = extractFromPhrase(resultMatch[1]);
    if (extracted) return extracted;
  }

  // Priority 6: Last equation result "= X" in the text
  const eqMatches = [...cleaned.matchAll(/=\s*(-?[\d,]+(?:\.\d+)?)/g)];
  if (eqMatches.length > 0) {
    const lastMatch = eqMatches[eqMatches.length - 1];
    if (lastMatch?.[1]) return cleanNumber(lastMatch[1]);
  }

  // Priority 7: Look for standalone numbers in the last few lines
  const lines = cleaned.trim().split("\n").slice(-5);
  for (const line of lines.reverse()) {
    // "is NUMBER" pattern
    const isNumMatch = line.match(/is\s+(-?[\d,]+(?:\.\d+)?)\b/i);
    if (isNumMatch?.[1]) return cleanNumber(isNumMatch[1]);

    // Standalone number on a line
    const standaloneNum = line.match(/^\s*(-?[\d,]+(?:\.\d+)?)\s*$/);
    if (standaloneNum?.[1]) return cleanNumber(standaloneNum[1]);
  }

  // Priority 8: Last number in the entire response
  const allNumbers = cleaned.match(/-?[\d,]+(?:\.\d+)?/g);
  if (allNumbers && allNumbers.length > 0) {
    const lastNum = allNumbers[allNumbers.length - 1];
    if (lastNum) return cleanNumber(lastNum);
  }

  // Priority 9: Last meaningful word (for YES/NO/TRUE/FALSE type answers)
  const lastLines = cleaned.trim().split("\n").slice(-3).join(" ");
  return extractLastMeaningfulWord(lastLines);
}

/**
 * Normalize answer for comparison
 * Handles case, whitespace, and common variations
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/^\[|\]$/g, "") // Remove surrounding brackets [X] -> X
    .replace(/,/g, "") // Remove commas from numbers
    .replace(/\s+/g, "") // Remove whitespace
    .replace(/^0+(\d)/, "$1") // Remove leading zeros (but keep "0")
    .replace(/\.0+$/, "") // Remove trailing .0
    .replace(/%$/, "") // Remove trailing % for percentage comparison
    .trim();
}

/**
 * Compare two answers for equivalence
 */
export function answersMatch(extracted: string, expected: string): boolean {
  const normExtracted = normalizeAnswer(extracted);
  const normExpected = normalizeAnswer(expected);

  // Exact match
  if (normExtracted === normExpected) return true;

  // Try numeric comparison
  const numExtracted = Number.parseFloat(normExtracted);
  const numExpected = Number.parseFloat(normExpected);
  if (!Number.isNaN(numExtracted) && !Number.isNaN(numExpected)) {
    // Allow small floating point tolerance
    if (Math.abs(numExtracted - numExpected) < 0.0001) return true;
  }

  // Check if one contains the other (for partial matches like "45" vs "45 degrees")
  if (normExpected.includes(normExtracted) || normExtracted.includes(normExpected)) {
    return true;
  }

  return false;
}
