/**
 * Pre-compiled Regex Patterns for LLM Output Processing
 *
 * Centralized patterns for:
 * - Thinking/reasoning tag removal
 * - Markdown stripping
 * - LaTeX extraction
 * - Model-specific token cleanup
 *
 * Module-level constants avoid recompilation on every call.
 * All patterns are exported for testing and reuse.
 */

// =============================================================================
// THINKING/REASONING TAGS
// =============================================================================

/** Remove <think>...</think> blocks */
export const RE_THINK = /<think>[\s\S]*?<\/think>/gi;

/** Remove <thinking>...</thinking> blocks */
export const RE_THINKING = /<thinking>[\s\S]*?<\/thinking>/gi;

/** Remove <reasoning>...</reasoning> blocks */
export const RE_REASONING = /<reasoning>[\s\S]*?<\/reasoning>/gi;

/** Remove <antithink>...</antithink> blocks (Anthropic) */
export const RE_ANTITHINK = /<antithink>[\s\S]*?<\/antithink>/gi;

/** Remove <thought>...</thought> blocks */
export const RE_THOUGHT = /<thought>[\s\S]*?<\/thought>/gi;

/** Remove <thoughts>...</thoughts> blocks */
export const RE_THOUGHTS = /<thoughts>[\s\S]*?<\/thoughts>/gi;

/** Remove <reflection>...</reflection> blocks */
export const RE_REFLECTION = /<reflection>[\s\S]*?<\/reflection>/gi;

/** Remove <internal_monologue>...</internal_monologue> blocks */
export const RE_INTERNAL_MONOLOGUE = /<internal_monologue>[\s\S]*?<\/internal_monologue>/gi;

// =============================================================================
// TOOL/ARTIFACT CONTAINERS
// =============================================================================

/** Remove <tool_call>...</tool_call> blocks */
export const RE_TOOL_CALL = /<tool_call>[\s\S]*?<\/tool_call>/gi;

/** Remove <tool_result>...</tool_result> blocks */
export const RE_TOOL_RESULT = /<tool_result>[\s\S]*?<\/tool_result>/gi;

/** Remove <ARTIFACTS>...</ARTIFACTS> blocks */
export const RE_ARTIFACTS = /<ARTIFACTS>[\s\S]*?<\/ARTIFACTS>/gi;

/** Remove <document_content>...</document_content> blocks */
export const RE_DOCUMENT_CONTENT = /<document_content>[\s\S]*?<\/document_content>/gi;

/** Remove <context>...</context> blocks */
export const RE_CONTEXT = /<context>[\s\S]*?<\/context>/gi;

// =============================================================================
// MODEL-SPECIFIC TOKENS
// =============================================================================

/** Remove <|begin_of_box|> tokens */
export const RE_BEGIN_BOX = /<\|begin_of_box\|>/gi;

/** Remove <|end_of_box|> tokens */
export const RE_END_BOX = /<\|end_of_box\|>/gi;

/** Remove <|im_start|>...<|im_end|> blocks (ChatML) */
export const RE_IM_BLOCK = /<\|im_start\|>[\s\S]*?<\|im_end\|>/gi;

/** Remove <|endoftext|> tokens */
export const RE_ENDOFTEXT = /<\|endoftext\|>/gi;

/** Remove <|pad|> tokens */
export const RE_PAD = /<\|pad\|>/gi;

// =============================================================================
// MARKDOWN
// =============================================================================

/** Remove code blocks ```...``` */
export const RE_CODE_BLOCK = /```[\s\S]*?```/g;

/** Extract bold text **...** */
export const RE_BOLD_ASTERISK = /\*\*([^*]+)\*\*/g;

/** Extract bold text __...__ */
export const RE_BOLD_UNDERSCORE = /__([^_]+)__/g;

/** Extract italic text *...* */
export const RE_ITALIC_ASTERISK = /\*([^*]+)\*/g;

/** Extract italic text _..._ */
export const RE_ITALIC_UNDERSCORE = /_([^_]+)_/g;

/** Extract inline code `...` */
export const RE_INLINE_CODE = /`([^`]+)`/g;

/** Remove heading markers # */
export const RE_HEADINGS = /^#{1,6}\s*/gm;

/** Extract strikethrough text ~~...~~ */
export const RE_STRIKETHROUGH = /~~([^~]+)~~/g;

/** Remove image syntax ![...](...) */
export const RE_IMAGES = /!\[[^\]]*\]\([^)]+\)/g;

/** Extract link text [...](...) */
export const RE_LINKS = /\[([^\]]+)\]\([^)]+\)/g;

/** Remove blockquote markers > */
export const RE_BLOCKQUOTE = /^>\s*/gm;

/** Remove horizontal rules --- or *** or ___ */
export const RE_HORIZONTAL_RULE = /^[-*_]{3,}\s*$/gm;

/** Remove unordered list markers - * + */
export const RE_UNORDERED_LIST = /^[\s]*[-*+]\s+/gm;

/** Remove ordered list markers 1. 2. etc */
export const RE_ORDERED_LIST = /^[\s]*\d+\.\s+/gm;

// =============================================================================
// LATEX
// =============================================================================

/** Extract content from $\boxed{...}$ */
export const RE_BOXED_DOLLAR = /\$\\boxed\{([^}]+)\}\$/g;

/** Extract content from \boxed{...} */
export const RE_BOXED = /\\boxed\{([^}]+)\}/g;

/** Extract content from inline math $...$ */
export const RE_INLINE_MATH = /\$([^$]+)\$/g;

// =============================================================================
// HTML ENTITIES
// =============================================================================

/** Replace &nbsp; with space */
export const RE_NBSP = /&nbsp;/gi;

/** Replace &amp; with & */
export const RE_AMP = /&amp;/gi;

/** Replace &lt; with < */
export const RE_LT = /&lt;/gi;

/** Replace &gt; with > */
export const RE_GT = /&gt;/gi;

/** Replace &quot; with " */
export const RE_QUOT = /&quot;/gi;

/** Replace &#39; with ' */
export const RE_APOS = /&#39;/gi;

/** Replace <br> with newline */
export const RE_BR = /<br\s*\/?>/gi;

/** Remove simple HTML tags <p>, <div>, <span>, <b>, <i>, <u>, <em>, <strong> */
export const RE_SIMPLE_TAGS = /<\/?(?:p|div|span|b|i|u|em|strong)>/gi;

// =============================================================================
// FAST-PATH TOKENS (Combined patterns for performance)
// =============================================================================

/** Model tokens commonly appearing with thinking tags (for fast strip) */
export const RE_MODEL_TOKENS_FAST = /<\|(?:endoftext|pad|begin_of_box|end_of_box)\|>/gi;

// =============================================================================
// WHITESPACE
// =============================================================================

/** Collapse 3+ newlines to 2 */
export const RE_MULTI_NEWLINE = /\n{3,}/g;

/** Remove trailing whitespace from lines */
export const RE_TRAILING_WHITESPACE = /[ \t]+$/gm;

/** Collapse multiple spaces to one */
export const RE_MULTI_SPACE = /[ \t]{2,}/g;

// =============================================================================
// ANSWER EXTRACTION
// =============================================================================

/** Word fractions: "one half", "two thirds", etc */
export const RE_WORD_FRACTION =
  /\b(a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]?(half|halves|third|thirds|fourth|fourths|quarter|quarters|fifth|fifths|sixth|sixths|seventh|sevenths|eighth|eighths|ninth|ninths|tenth|tenths)\b/gi;

/** Word fraction at start of string */
export const RE_WORD_FRACTION_START =
  /^(a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]?(half|halves|third|thirds|fourth|fourths|quarter|quarters|fifth|fifths|sixth|sixths|seventh|sevenths|eighth|eighths|ninth|ninths|tenth|tenths)\b/i;

/** Percentage pattern: 42%, -3.14% */
export const RE_PERCENTAGE = /(-?[\d,]+(?:\.\d+)?)\s*%/g;
