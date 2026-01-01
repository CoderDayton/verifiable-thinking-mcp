/**
 * Answer Extraction Utilities
 * Priority-based extraction for structured and unstructured LLM responses
 * Based on HuggingFace Math-Verify patterns
 */

// Import pre-compiled regex patterns from centralized module
import {
  RE_AMP,
  RE_ANTITHINK,
  RE_APOS,
  RE_ARTIFACTS,
  // Model-Specific Tokens
  RE_BEGIN_BOX,
  RE_BLOCKQUOTE,
  RE_BOLD_ASTERISK,
  RE_BOLD_UNDERSCORE,
  RE_BOXED,
  // LaTeX
  RE_BOXED_DOLLAR,
  RE_BR,
  // Markdown
  RE_CODE_BLOCK,
  RE_CONTEXT,
  RE_DOCUMENT_CONTENT,
  RE_END_BOX,
  RE_ENDOFTEXT,
  RE_GT,
  RE_HEADINGS,
  RE_HORIZONTAL_RULE,
  RE_IM_BLOCK,
  RE_IMAGES,
  RE_INLINE_CODE,
  RE_INLINE_MATH,
  RE_INTERNAL_MONOLOGUE,
  RE_ITALIC_ASTERISK,
  RE_ITALIC_UNDERSCORE,
  RE_LINKS,
  RE_LT,
  RE_MODEL_TOKENS_FAST,
  // Whitespace
  RE_MULTI_NEWLINE,
  RE_MULTI_SPACE,
  // HTML
  RE_NBSP,
  RE_ORDERED_LIST,
  RE_PAD,
  RE_PERCENTAGE,
  RE_QUOT,
  RE_REASONING,
  RE_REFLECTION,
  RE_SIMPLE_TAGS,
  RE_STRIKETHROUGH,
  // Thinking/Reasoning Tags
  RE_THINK,
  RE_THINKING,
  RE_THOUGHT,
  RE_THOUGHTS,
  // Tool/Artifact Containers
  RE_TOOL_CALL,
  RE_TOOL_RESULT,
  RE_TRAILING_WHITESPACE,
  RE_UNORDERED_LIST,
  // Answer Extraction
  RE_WORD_FRACTION,
  RE_WORD_FRACTION_START,
} from "./patterns.ts";

/**
 * Strip all LLM output artifacts for clean display/comparison.
 * Handles:
 * - Thinking/reasoning tags (DeepSeek, Claude, Gemini, Llama, Mistral)
 * - Model-specific tokens (GLM, etc.)
 * - Tool invocation artifacts
 * - Markdown formatting
 * - HTML entities
 * - Excess whitespace
 *
 * Performance: Regex patterns are pre-compiled at module load time.
 */
export function stripLLMOutput(text: string): string {
  return (
    text
      // === THINKING/REASONING TAGS ===
      .replace(RE_THINK, "")
      .replace(RE_THINKING, "")
      .replace(RE_REASONING, "")
      .replace(RE_ANTITHINK, "")
      .replace(RE_THOUGHT, "")
      .replace(RE_THOUGHTS, "")
      .replace(RE_REFLECTION, "")
      .replace(RE_INTERNAL_MONOLOGUE, "")

      // === TOOL/ARTIFACT CONTAINERS ===
      .replace(RE_TOOL_CALL, "")
      .replace(RE_TOOL_RESULT, "")
      .replace(RE_ARTIFACTS, "")
      .replace(RE_DOCUMENT_CONTENT, "")
      .replace(RE_CONTEXT, "")

      // === MODEL-SPECIFIC TOKENS ===
      .replace(RE_BEGIN_BOX, "")
      .replace(RE_END_BOX, "")
      .replace(RE_IM_BLOCK, "")
      .replace(RE_ENDOFTEXT, "")
      .replace(RE_PAD, "")

      // === MARKDOWN ===
      .replace(RE_CODE_BLOCK, "")
      .replace(RE_BOLD_ASTERISK, "$1")
      .replace(RE_BOLD_UNDERSCORE, "$1")
      .replace(RE_ITALIC_ASTERISK, "$1")
      .replace(RE_ITALIC_UNDERSCORE, "$1")
      .replace(RE_INLINE_CODE, "$1")
      .replace(RE_HEADINGS, "")
      .replace(RE_STRIKETHROUGH, "$1")
      .replace(RE_IMAGES, "")
      .replace(RE_LINKS, "$1")
      .replace(RE_BLOCKQUOTE, "")
      .replace(RE_HORIZONTAL_RULE, "")
      .replace(RE_UNORDERED_LIST, "")
      .replace(RE_ORDERED_LIST, "")

      // === LATEX (extract content) ===
      .replace(RE_BOXED_DOLLAR, "$1")
      .replace(RE_BOXED, "$1")
      .replace(RE_INLINE_MATH, "$1")

      // === HTML ===
      .replace(RE_NBSP, " ")
      .replace(RE_AMP, "&")
      .replace(RE_LT, "<")
      .replace(RE_GT, ">")
      .replace(RE_QUOT, '"')
      .replace(RE_APOS, "'")
      .replace(RE_BR, "\n")
      .replace(RE_SIMPLE_TAGS, "")

      // === WHITESPACE CLEANUP ===
      .replace(RE_MULTI_NEWLINE, "\n\n")
      .replace(RE_TRAILING_WHITESPACE, "")
      .replace(RE_MULTI_SPACE, " ")

      .trim()
  );
}

// Keep legacy function names as aliases for backward compatibility
export const stripThinkingTags = stripLLMOutput;
export const stripMarkdown = stripLLMOutput;

// =============================================================================
// FAST PATH: Only thinking tags + model tokens (no markdown/HTML cleanup)
// =============================================================================

/**
 * Fast variant that only strips thinking tags and model tokens.
 * Use when you only need to remove reasoning artifacts, not full markdown cleanup.
 *
 * Uses the same individual regex approach as stripLLMOutput (faster than backreference).
 *
 * @example
 * ```ts
 * // Hot path: just need visible content
 * const visible = stripThinkingTagsFast(response);
 *
 * // Full cleanup needed for comparison
 * const clean = stripLLMOutput(response);
 * ```
 */
export function stripThinkingTagsFast(text: string): string {
  return text
    .replace(RE_THINK, "")
    .replace(RE_THINKING, "")
    .replace(RE_REASONING, "")
    .replace(RE_ANTITHINK, "")
    .replace(RE_THOUGHT, "")
    .replace(RE_THOUGHTS, "")
    .replace(RE_REFLECTION, "")
    .replace(RE_INTERNAL_MONOLOGUE, "")
    .replace(RE_MODEL_TOKENS_FAST, "")
    .replace(RE_MULTI_NEWLINE, "\n\n")
    .replace(RE_MULTI_SPACE, " ")
    .trim();
}

// =============================================================================
// STREAMING: For very large responses (>100KB)
// =============================================================================

/** Threshold above which streaming is recommended (100KB) */
const STREAMING_THRESHOLD = 100 * 1024;

/** Chunk size for streaming processing (32KB with overlap) */
const CHUNK_SIZE = 32 * 1024;

/** Overlap to handle tags split across chunk boundaries */
const CHUNK_OVERLAP = 1024;

/**
 * Check if a response is large enough to benefit from streaming.
 */
export function shouldStreamStrip(text: string): boolean {
  return text.length > STREAMING_THRESHOLD;
}

/**
 * Generator that yields cleaned chunks for very large responses.
 *
 * Two-phase approach:
 * 1. Strip all thinking/reasoning tags first (single regex pass)
 * 2. Chunk the cleaned result for memory-friendly processing
 *
 * Use for responses >100KB to avoid memory spikes during markdown/entity cleanup.
 *
 * @example
 * ```ts
 * if (shouldStreamStrip(hugeResponse)) {
 *   const chunks: string[] = [];
 *   for (const chunk of stripLLMOutputStreaming(hugeResponse)) {
 *     chunks.push(chunk);
 *   }
 *   const result = chunks.join('');
 * } else {
 *   const result = stripLLMOutput(hugeResponse);
 * }
 * ```
 */
export function* stripLLMOutputStreaming(text: string): Generator<string, void, unknown> {
  const len = text.length;

  // For small inputs, just yield the full result
  if (len <= STREAMING_THRESHOLD) {
    yield stripLLMOutput(text);
    return;
  }

  // Phase 1: Strip all thinking tags first (they can span chunks)
  // Uses individual patterns (faster than combined backreference regex)
  const withoutThinking = text
    .replace(RE_THINK, "")
    .replace(RE_THINKING, "")
    .replace(RE_REASONING, "")
    .replace(RE_ANTITHINK, "")
    .replace(RE_THOUGHT, "")
    .replace(RE_THOUGHTS, "")
    .replace(RE_REFLECTION, "")
    .replace(RE_INTERNAL_MONOLOGUE, "")
    .replace(RE_MODEL_TOKENS_FAST, "");

  // Phase 2: Chunk the remaining content for markdown/entity cleanup
  const cleanedLen = withoutThinking.length;
  let pos = 0;

  while (pos < cleanedLen) {
    // Calculate chunk boundaries
    const chunkEnd = Math.min(pos + CHUNK_SIZE, cleanedLen);
    const isLastChunk = chunkEnd >= cleanedLen;

    let chunk = withoutThinking.slice(pos, chunkEnd);

    // For non-last chunks, find a safe break point (newline or space)
    if (!isLastChunk) {
      const searchStart = Math.max(0, chunk.length - CHUNK_OVERLAP);
      const lastNewline = chunk.lastIndexOf("\n", searchStart);
      const lastSpace = chunk.lastIndexOf(" ", searchStart);
      // Guard against -1 from lastIndexOf when no match found
      const safeEnd = Math.max(
        lastNewline >= 0 ? lastNewline : 0,
        lastSpace >= 0 ? lastSpace : 0,
        searchStart,
      );

      // Adjust next position to continue from safe point
      pos += safeEnd;
      chunk = chunk.slice(0, safeEnd);
    } else {
      pos = chunkEnd;
    }

    // Apply remaining cleanup (markdown, entities, whitespace)
    const processed = chunk
      // Tool/artifact containers
      .replace(RE_TOOL_CALL, "")
      .replace(RE_TOOL_RESULT, "")
      .replace(RE_ARTIFACTS, "")
      .replace(RE_DOCUMENT_CONTENT, "")
      .replace(RE_CONTEXT, "")
      // Markdown
      .replace(RE_CODE_BLOCK, "")
      .replace(RE_HEADINGS, "")
      .replace(RE_BOLD_ASTERISK, "$1")
      .replace(RE_BOLD_UNDERSCORE, "$1")
      .replace(RE_ITALIC_ASTERISK, "$1")
      .replace(RE_ITALIC_UNDERSCORE, "$1")
      .replace(RE_STRIKETHROUGH, "$1")
      .replace(RE_IMAGES, "")
      .replace(RE_LINKS, "$1")
      .replace(RE_INLINE_CODE, "$1")
      .replace(RE_BLOCKQUOTE, "")
      .replace(RE_HORIZONTAL_RULE, "")
      .replace(RE_UNORDERED_LIST, "")
      .replace(RE_ORDERED_LIST, "")
      // HTML
      .replace(RE_NBSP, " ")
      .replace(RE_LT, "<")
      .replace(RE_GT, ">")
      .replace(RE_AMP, "&")
      .replace(RE_QUOT, '"')
      .replace(RE_APOS, "'")
      .replace(RE_BR, "\n")
      .replace(RE_SIMPLE_TAGS, "")
      // Whitespace
      .replace(RE_MULTI_NEWLINE, "\n\n")
      .replace(RE_MULTI_SPACE, " ")
      .trim();

    // Yield non-empty results
    if (processed) {
      yield processed;
    }
  }
}

/**
 * Streaming version that returns a Promise for async contexts.
 * Processes chunks with yielding to avoid blocking the event loop.
 */
export async function stripLLMOutputAsync(text: string): Promise<string> {
  if (text.length <= STREAMING_THRESHOLD) {
    return stripLLMOutput(text);
  }

  const chunks: string[] = [];
  let chunkCount = 0;

  for (const chunk of stripLLMOutputStreaming(text)) {
    chunks.push(chunk);
    chunkCount++;

    // Yield to event loop every 10 chunks to avoid blocking
    if (chunkCount % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return chunks.join(" ");
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

  // Priority 0: Word fractions at the start ("two-thirds", "one half", "a third")
  const wordFracMatch = trimmed.match(RE_WORD_FRACTION_START);
  if (wordFracMatch?.[0]) return wordFracMatch[0];

  // Priority 1: Leading number with optional percent (75%, 3.14, 2/3)
  const numMatch = trimmed.match(/^(-?[\d,]+(?:\.\d+)?(?:\/\d+)?%?)/);
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
 * Try to match expected answers directly in the response.
 * This is Priority 0 - the fastest path when we have ground truth.
 * @returns The matched expected answer, or null if no match found
 */
function matchExpectedAnswer(cleaned: string, expectedAnswers: string[]): string | null {
  // Try exact word boundary match first
  for (const expected of expectedAnswers) {
    const escapedExpected = expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escapedExpected}\\b`, "i");
    if (pattern.test(cleaned)) {
      return expected;
    }
  }
  // Try normalized versions (e.g., "A, 7" vs "A,7")
  const normalizedResponse = cleaned.replace(/\s+/g, "").toLowerCase();
  for (const expected of expectedAnswers) {
    const normalizedExpected = expected.replace(/\s+/g, "").toLowerCase();
    if (normalizedResponse.includes(normalizedExpected)) {
      return expected;
    }
  }
  return null;
}

/**
 * Match explicit answer markers in text (Priority 2-5).
 * Patterns: "Final Answer: X", "Answer: X", "The answer is X", "Result: X", etc.
 * @returns The extracted answer, or null if no marker found
 */
function matchExplicitMarkers(cleaned: string): string | null {
  // Priority 2: "Final Answer: X" (with colon, very explicit)
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
    const cards = flipMatch[1]
      .trim()
      .replace(/\s+and\s+/gi, ",")
      .replace(/\s+/g, "");
    if (cards) return cards;
  }

  // Priority 4d: "conclusion is X" or "I conclude X"
  const concludeMatch = cleaned.match(
    /(?:conclusion|conclude|I\s+conclude)\s+(?:is\s+|that\s+)?([^\n.]+)/i,
  );
  if (concludeMatch?.[1]) {
    const extracted = extractFromPhrase(concludeMatch[1].trim());
    if (extracted) return extracted;
  }

  // Priority 4e: "therefore X" or "thus X" at sentence start
  const thereforeMatch = cleaned.match(/(?:^|\n)\s*(?:therefore|thus|hence|so)\s+([^\n.]+)/im);
  if (thereforeMatch?.[1]) {
    const extracted = extractFromPhrase(thereforeMatch[1].trim());
    if (extracted) return extracted;
  }

  // Priority 5: "Result: X"
  const resultMatch = cleaned.match(/result:\s*([^\n]+?)(?:\.\s|$)/i);
  if (resultMatch?.[1]) {
    const extracted = extractFromPhrase(resultMatch[1]);
    if (extracted) return extracted;
  }

  return null;
}

/**
 * Answer extraction result with confidence score.
 */
export interface AnswerExtractionResult {
  answer: string;
  confidence: number; // 0-1, higher = more confident
  source: "expected" | "boxed" | "explicit" | "equation" | "standalone" | "implicit" | "fallback";
}

/**
 * Extract answer from LLM response with confidence scoring.
 * Higher confidence sources (explicit markers, boxed) are preferred over implicit ones.
 *
 * Confidence levels:
 * - 1.0: Expected answer found in response (verified match)
 * - 0.95: LaTeX \boxed{X} (LLM explicitly marked)
 * - 0.85: "Final Answer:", "Answer:", "The answer is" patterns
 * - 0.7: Equation result "= X"
 * - 0.6: Standalone number in last lines
 * - 0.4: Last number/percentage in response
 * - 0.3: Word fractions, YES/NO fallback
 */
export function extractAnswerWithConfidence(
  response: string,
  expectedAnswers?: string[],
): AnswerExtractionResult {
  // Priority 1: LaTeX boxed (check BEFORE stripping - stripLLMOutput extracts boxed content)
  // Highest confidence because LLM explicitly marked this as the answer
  const boxedMatch = response.match(/\\boxed\{([^}]+)\}/);
  if (boxedMatch?.[1]) {
    return { answer: cleanNumber(boxedMatch[1]), confidence: 0.95, source: "boxed" };
  }

  // Strip all LLM artifacts (thinking tags, markdown, model tokens, etc.)
  const cleaned = stripLLMOutput(response);

  // Priority 0: If we know expected answers, look for them directly in the response
  if (expectedAnswers && expectedAnswers.length > 0) {
    const matched = matchExpectedAnswer(cleaned, expectedAnswers);
    if (matched) return { answer: matched, confidence: 1.0, source: "expected" };
  }

  // Priority 2-5: Explicit answer markers
  const explicitMatch = matchExplicitMarkers(cleaned);
  if (explicitMatch) {
    return { answer: explicitMatch, confidence: 0.85, source: "explicit" };
  }

  // Priority 6-9: Implicit patterns (equations, standalone numbers, word fractions)
  return matchImplicitPatternsWithConfidence(cleaned);
}

/**
 * Extract answer from LLM response using priority-based pattern matching
 *
 * Priority order:
 * 0. If expectedAnswers provided, look for exact match in response (fastest path)
 * 1. LaTeX \boxed{X} (explicit answer marking)
 * 2-5. Explicit markers (via matchExplicitMarkers): "Final Answer:", "Answer:", "The answer is"
 * 6-9. Implicit patterns (via matchImplicitPatterns): equations, numbers, fractions, YES/NO
 */
export function extractAnswer(response: string, expectedAnswers?: string[]): string {
  return extractAnswerWithConfidence(response, expectedAnswers).answer;
}

/**
 * Match implicit answer patterns with confidence scoring (Priority 6-9).
 */
function matchImplicitPatternsWithConfidence(cleaned: string): AnswerExtractionResult {
  // Priority 6: Last equation result "= X" (confidence 0.7)
  const eqMatches = [...cleaned.matchAll(/=\s*(-?[\d,]+(?:\.\d+)?(?:\/\d+)?)/g)];
  if (eqMatches.length > 0) {
    const lastMatch = eqMatches[eqMatches.length - 1];
    if (lastMatch?.[1]) {
      return { answer: cleanNumber(lastMatch[1]), confidence: 0.7, source: "equation" };
    }
  }

  // Priority 7: Standalone numbers in last few lines (confidence 0.6)
  const lines = cleaned.trim().split("\n").slice(-5);
  for (const line of lines.reverse()) {
    const isNumMatch = line.match(/is\s+(-?[\d,]+(?:\.\d+)?(?:\/\d+)?%?)(?=\s|$|[.,;:!?)])/i);
    if (isNumMatch?.[1]) {
      return { answer: cleanNumber(isNumMatch[1]), confidence: 0.6, source: "standalone" };
    }

    const standaloneNum = line.match(/^\s*(-?[\d,]+(?:\.\d+)?(?:\/\d+)?%?)\s*$/);
    if (standaloneNum?.[1]) {
      return { answer: cleanNumber(standaloneNum[1]), confidence: 0.6, source: "standalone" };
    }
  }

  // Priority 8: Last percentage (confidence 0.4)
  const percentMatches = [...cleaned.matchAll(RE_PERCENTAGE)];
  if (percentMatches.length > 0) {
    const lastMatch = percentMatches[percentMatches.length - 1];
    if (lastMatch?.[1]) {
      return { answer: `${cleanNumber(lastMatch[1])}%`, confidence: 0.4, source: "implicit" };
    }
  }

  // Priority 8a: Last number/fraction (confidence 0.4)
  const allNumbers = cleaned.match(/-?[\d,]+(?:\.\d+)?(?:\/\d+)?/g);
  if (allNumbers && allNumbers.length > 0) {
    const lastNum = allNumbers[allNumbers.length - 1];
    if (lastNum) {
      return { answer: cleanNumber(lastNum), confidence: 0.4, source: "implicit" };
    }
  }

  // Priority 8b: Word fractions (confidence 0.3)
  RE_WORD_FRACTION.lastIndex = 0;
  const wordFractionMatch = cleaned.match(RE_WORD_FRACTION);
  if (wordFractionMatch && wordFractionMatch.length > 0) {
    return {
      answer: wordFractionMatch[wordFractionMatch.length - 1]!,
      confidence: 0.3,
      source: "fallback",
    };
  }

  // Priority 9: Last meaningful word (confidence 0.3)
  const lastLines = cleaned.trim().split("\n").slice(-3).join(" ");
  return {
    answer: extractLastMeaningfulWord(lastLines),
    confidence: 0.3,
    source: "fallback",
  };
}

// =============================================================================
// FRACTION HANDLING
// =============================================================================

/** Word-to-number mapping for fraction parsing */
const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Word-to-denominator mapping for common fractions */
const WORD_DENOMINATORS: Record<string, number> = {
  half: 2,
  halves: 2,
  third: 3,
  thirds: 3,
  fourth: 4,
  fourths: 4,
  quarter: 4,
  quarters: 4,
  fifth: 5,
  fifths: 5,
  sixth: 6,
  sixths: 6,
  seventh: 7,
  sevenths: 7,
  eighth: 8,
  eighths: 8,
  ninth: 9,
  ninths: 9,
  tenth: 10,
  tenths: 10,
};

/**
 * Parse a fraction string into a decimal number.
 * Handles:
 * - Numeric fractions: "2/3", "1/2", "3/4"
 * - Word fractions: "two-thirds", "one-half", "three-quarters"
 * - Mixed numbers: "1 1/2", "2 3/4" (whole + fraction)
 *
 * @returns The decimal value, or null if not a valid fraction
 */
export function parseFraction(input: string): number | null {
  const trimmed = input.trim().toLowerCase();

  // Pattern 1: Numeric fraction "a/b" or mixed "w a/b"
  const numericMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const [, num, denom] = numericMatch;
    const d = Number.parseFloat(denom!);
    if (d === 0) return null;
    return Number.parseFloat(num!) / d;
  }

  // Pattern 2: Mixed number "w a/b" (e.g., "1 1/2" or "2 3/4")
  const mixedMatch = trimmed.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedMatch) {
    const [, whole, num, denom] = mixedMatch;
    const w = Number.parseInt(whole!, 10);
    const n = Number.parseInt(num!, 10);
    const d = Number.parseInt(denom!, 10);
    if (d === 0) return null;
    const sign = w < 0 ? -1 : 1;
    return w + sign * (n / d);
  }

  // Pattern 3: Word fraction "one-half", "two-thirds", "three-quarters"
  // Also handles "a half", "a third", etc.
  const wordMatch = trimmed.match(
    /^(a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]?(half|halves|third|thirds|fourth|fourths|quarter|quarters|fifth|fifths|sixth|sixths|seventh|sevenths|eighth|eighths|ninth|ninths|tenth|tenths)$/,
  );
  if (wordMatch) {
    const [, numWord, denomWord] = wordMatch;
    const numerator = numWord === "a" ? 1 : (WORD_NUMBERS[numWord!] ?? 1);
    const denominator = WORD_DENOMINATORS[denomWord!];
    if (denominator) {
      return numerator / denominator;
    }
  }

  return null;
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
 * Compare two answers for equivalence.
 * Handles:
 * - Case-insensitive comparison
 * - Numeric tolerance (0.01% relative or 0.001 absolute for fraction tolerance)
 * - Fractions: "2/3" matches "0.667", "two-thirds"
 * - Percentages: "75%" matches "0.75", "75 percent"
 * - Scientific notation: "1.5e6" matches "1500000", "3×10^8"
 * - Partial containment: "45" matches "45 degrees"
 */
export function answersMatch(extracted: string, expected: string): boolean {
  const normExtracted = normalizeAnswer(extracted);
  const normExpected = normalizeAnswer(expected);

  // Exact match
  if (normExtracted === normExpected) return true;

  // Track if we parsed fractions (need wider tolerance for rounding)
  let hasFraction = false;

  // Try fraction parsing FIRST (before parseNumericValue, since parseFloat("1/2") = 1)
  let numExtracted: number | null = null;
  let numExpected: number | null = null;

  if (extracted.includes("/")) {
    const fracExtracted = parseFraction(extracted);
    if (fracExtracted !== null) {
      numExtracted = fracExtracted;
      hasFraction = true;
    }
  }
  if (expected.includes("/")) {
    const fracExpected = parseFraction(expected);
    if (fracExpected !== null) {
      numExpected = fracExpected;
      hasFraction = true;
    }
  }

  // Try word fractions ("two-thirds", "one-half")
  // Just try parseFraction() - it handles all word fraction formats
  if (numExtracted === null) {
    const fracExtracted = parseFraction(extracted);
    if (fracExtracted !== null) {
      numExtracted = fracExtracted;
      hasFraction = true;
    }
  }
  if (numExpected === null) {
    const fracExpected = parseFraction(expected);
    if (fracExpected !== null) {
      numExpected = fracExpected;
      hasFraction = true;
    }
  }

  // Try numeric comparison (percentages, scientific notation, plain numbers)
  if (numExtracted === null) {
    numExtracted = parseNumericValue(extracted);
  }
  if (numExpected === null) {
    numExpected = parseNumericValue(expected);
  }

  if (numExtracted !== null && numExpected !== null) {
    // Use wider tolerance for fractions (0.001 absolute) to handle rounding in 3-digit decimals
    // For non-fractions, use tighter tolerance (0.0001 absolute or 0.01% relative)
    const absDiff = Math.abs(numExtracted - numExpected);
    const absTol = hasFraction ? 0.001 : 0.0001;
    const relTol = Math.abs(numExpected) * 0.0001;
    if (absDiff < Math.max(absTol, relTol)) return true;
  }

  // Check if one contains the other as a complete token (for "45" vs "45 degrees")
  // Only applies when not both purely numeric (numeric comparison already handled above)
  // For "45 degrees" vs "45": shorter appears at start/end of longer (after normalization removes spaces)
  const hasNonNumeric = /[a-z]/i.test(normExtracted) || /[a-z]/i.test(normExpected);
  if (hasNonNumeric) {
    const shorter = normExtracted.length <= normExpected.length ? normExtracted : normExpected;
    const longer = normExtracted.length > normExpected.length ? normExtracted : normExpected;

    // Shorter must appear at start or end of longer (handles "45degrees"↔"45", "answeris42"↔"42")
    if (shorter.length > 0 && (longer.startsWith(shorter) || longer.endsWith(shorter))) {
      return true;
    }
  }

  return false;
}

/**
 * Parse a numeric value from a string, handling percentages and scientific notation.
 * @returns The numeric value, or null if not parseable
 */
function parseNumericValue(input: string): number | null {
  const trimmed = input.trim();

  // Check for percentage (75%, 75 percent, 75 pct)
  const percentMatch = trimmed.match(/^(-?[\d,]+(?:\.\d+)?)\s*(%|percent|pct)$/i);
  if (percentMatch?.[1]) {
    const value = Number.parseFloat(percentMatch[1].replace(/,/g, ""));
    if (!Number.isNaN(value)) return value / 100;
  }

  // Check for scientific notation with × or x (3×10^8, 3x10^8, 3×10⁸)
  const sciMultMatch = trimmed.match(/^(-?[\d.]+)\s*[×xX]\s*10[\^]?(-?\d+)$/);
  if (sciMultMatch?.[1] && sciMultMatch?.[2]) {
    const base = Number.parseFloat(sciMultMatch[1]);
    const exp = Number.parseInt(sciMultMatch[2], 10);
    if (!Number.isNaN(base) && !Number.isNaN(exp)) return base * 10 ** exp;
  }

  // Check for Unicode superscript exponents (10⁸, 10⁻³)
  const superscriptMap: Record<string, string> = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁻": "-",
  };
  const superMatch = trimmed.match(/^(-?[\d.]+)\s*[×xX]\s*10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)$/);
  if (superMatch?.[1] && superMatch?.[2]) {
    const base = Number.parseFloat(superMatch[1]);
    const expStr = superMatch[2]
      .split("")
      .map((c) => superscriptMap[c] ?? c)
      .join("");
    const exp = Number.parseInt(expStr, 10);
    if (!Number.isNaN(base) && !Number.isNaN(exp)) return base * 10 ** exp;
  }

  // Standard parseFloat handles 1.5e6 notation
  const value = Number.parseFloat(trimmed.replace(/,/g, ""));
  return Number.isNaN(value) ? null : value;
}
