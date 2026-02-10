/**
 * Smoke tests for pre-compiled regex patterns
 * Ensures all patterns compile and match expected inputs
 *
 * Note: Global regex patterns (with 'g' flag) maintain lastIndex state.
 * We use .test() with reset or string.match() for reliable testing.
 */

import { describe, expect, it } from "bun:test";
import {
  RE_AMP,
  RE_ANTITHINK,
  RE_APOS,
  RE_ARTIFACTS,
  RE_BEGIN_BOX,
  RE_BLOCKQUOTE,
  RE_BOLD_ASTERISK,
  RE_BOLD_UNDERSCORE,
  RE_BOXED,
  RE_BOXED_DOLLAR,
  RE_BR,
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
  RE_MULTI_NEWLINE,
  RE_MULTI_SPACE,
  RE_NBSP,
  RE_ORDERED_LIST,
  RE_PAD,
  RE_PERCENTAGE,
  RE_QUOT,
  RE_REASONING,
  RE_REFLECTION,
  RE_SIMPLE_TAGS,
  RE_STRIKETHROUGH,
  RE_THINK,
  RE_THINKING,
  RE_THOUGHT,
  RE_THOUGHTS,
  RE_TOOL_CALL,
  RE_TOOL_RESULT,
  RE_TRAILING_WHITESPACE,
  RE_UNORDERED_LIST,
  RE_WORD_FRACTION,
  RE_WORD_FRACTION_START,
} from "../src/text/patterns.ts";

/** Helper to test global regex without state issues */
function testMatch(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

/** Helper to get all matches from global regex */
function getMatches(pattern: RegExp, text: string): RegExpMatchArray | null {
  pattern.lastIndex = 0;
  return text.match(pattern);
}

describe("patterns", () => {
  describe("thinking/reasoning tags", () => {
    it("RE_THINK matches <think>...</think>", () => {
      expect(testMatch(RE_THINK, "<think>some reasoning</think>")).toBe(true);
      expect(testMatch(RE_THINK, "no tags here")).toBe(false);
    });

    it("RE_THINKING matches <thinking>...</thinking>", () => {
      expect(testMatch(RE_THINKING, "<thinking>let me think</thinking>")).toBe(true);
    });

    it("RE_REASONING matches <reasoning>...</reasoning>", () => {
      expect(testMatch(RE_REASONING, "<reasoning>step by step</reasoning>")).toBe(true);
    });

    it("RE_ANTITHINK matches <antithink>...</antithink>", () => {
      expect(testMatch(RE_ANTITHINK, "<antithink>wait no</antithink>")).toBe(true);
    });

    it("RE_THOUGHT matches <thought>...</thought>", () => {
      expect(testMatch(RE_THOUGHT, "<thought>hmm</thought>")).toBe(true);
    });

    it("RE_THOUGHTS matches <thoughts>...</thoughts>", () => {
      expect(testMatch(RE_THOUGHTS, "<thoughts>multiple</thoughts>")).toBe(true);
    });

    it("RE_REFLECTION matches <reflection>...</reflection>", () => {
      expect(testMatch(RE_REFLECTION, "<reflection>looking back</reflection>")).toBe(true);
    });

    it("RE_INTERNAL_MONOLOGUE matches <internal_monologue>...</internal_monologue>", () => {
      expect(
        testMatch(RE_INTERNAL_MONOLOGUE, "<internal_monologue>inner voice</internal_monologue>"),
      ).toBe(true);
    });

    it("handles multiline content", () => {
      const multiline = "<think>\nline1\nline2\n</think>";
      expect(testMatch(RE_THINK, multiline)).toBe(true);
    });
  });

  describe("tool/artifact containers", () => {
    it("RE_TOOL_CALL matches <tool_call>...</tool_call>", () => {
      expect(testMatch(RE_TOOL_CALL, "<tool_call>search(query)</tool_call>")).toBe(true);
    });

    it("RE_TOOL_RESULT matches <tool_result>...</tool_result>", () => {
      expect(testMatch(RE_TOOL_RESULT, "<tool_result>found 5 results</tool_result>")).toBe(true);
    });

    it("RE_ARTIFACTS matches <ARTIFACTS>...</ARTIFACTS>", () => {
      expect(testMatch(RE_ARTIFACTS, "<ARTIFACTS>code here</ARTIFACTS>")).toBe(true);
    });

    it("RE_DOCUMENT_CONTENT matches <document_content>...</document_content>", () => {
      expect(
        testMatch(RE_DOCUMENT_CONTENT, "<document_content>file content</document_content>"),
      ).toBe(true);
    });

    it("RE_CONTEXT matches <context>...</context>", () => {
      expect(testMatch(RE_CONTEXT, "<context>background info</context>")).toBe(true);
    });
  });

  describe("model-specific tokens", () => {
    it("RE_BEGIN_BOX matches <|begin_of_box|>", () => {
      expect(testMatch(RE_BEGIN_BOX, "<|begin_of_box|>")).toBe(true);
    });

    it("RE_END_BOX matches <|end_of_box|>", () => {
      expect(testMatch(RE_END_BOX, "<|end_of_box|>")).toBe(true);
    });

    it("RE_IM_BLOCK matches ChatML blocks", () => {
      expect(testMatch(RE_IM_BLOCK, "<|im_start|>assistant\nhello<|im_end|>")).toBe(true);
    });

    it("RE_ENDOFTEXT matches <|endoftext|>", () => {
      expect(testMatch(RE_ENDOFTEXT, "<|endoftext|>")).toBe(true);
    });

    it("RE_PAD matches <|pad|>", () => {
      expect(testMatch(RE_PAD, "<|pad|>")).toBe(true);
    });

    it("RE_MODEL_TOKENS_FAST matches combined tokens", () => {
      expect(testMatch(RE_MODEL_TOKENS_FAST, "<|endoftext|>")).toBe(true);
      expect(testMatch(RE_MODEL_TOKENS_FAST, "<|pad|>")).toBe(true);
      expect(testMatch(RE_MODEL_TOKENS_FAST, "<|begin_of_box|>")).toBe(true);
      expect(testMatch(RE_MODEL_TOKENS_FAST, "<|end_of_box|>")).toBe(true);
    });
  });

  describe("markdown patterns", () => {
    it("RE_CODE_BLOCK matches fenced code", () => {
      expect(testMatch(RE_CODE_BLOCK, "```js\nconst x = 1;\n```")).toBe(true);
    });

    it("RE_BOLD_ASTERISK captures bold text", () => {
      const match = getMatches(RE_BOLD_ASTERISK, "**bold**");
      expect(match).not.toBeNull();
    });

    it("RE_BOLD_UNDERSCORE captures bold text", () => {
      const match = getMatches(RE_BOLD_UNDERSCORE, "__bold__");
      expect(match).not.toBeNull();
    });

    it("RE_ITALIC_ASTERISK captures italic text", () => {
      const match = getMatches(RE_ITALIC_ASTERISK, "*italic*");
      expect(match).not.toBeNull();
    });

    it("RE_ITALIC_UNDERSCORE captures italic text", () => {
      const match = getMatches(RE_ITALIC_UNDERSCORE, "_italic_");
      expect(match).not.toBeNull();
    });

    it("RE_INLINE_CODE captures code", () => {
      const match = getMatches(RE_INLINE_CODE, "`code`");
      expect(match).not.toBeNull();
    });

    it("RE_HEADINGS matches heading markers", () => {
      expect(testMatch(RE_HEADINGS, "# H1")).toBe(true);
      expect(testMatch(RE_HEADINGS, "## H2")).toBe(true);
      expect(testMatch(RE_HEADINGS, "###### H6")).toBe(true);
    });

    it("RE_STRIKETHROUGH captures strikethrough", () => {
      const match = getMatches(RE_STRIKETHROUGH, "~~deleted~~");
      expect(match).not.toBeNull();
    });

    it("RE_IMAGES matches image syntax", () => {
      expect(testMatch(RE_IMAGES, "![alt](image.png)")).toBe(true);
    });

    it("RE_LINKS captures link text", () => {
      const match = getMatches(RE_LINKS, "[text](url)");
      expect(match).not.toBeNull();
    });

    it("RE_BLOCKQUOTE matches quote markers", () => {
      expect(testMatch(RE_BLOCKQUOTE, "> quoted")).toBe(true);
    });

    it("RE_HORIZONTAL_RULE matches rules", () => {
      expect(testMatch(RE_HORIZONTAL_RULE, "---")).toBe(true);
      expect(testMatch(RE_HORIZONTAL_RULE, "***")).toBe(true);
      expect(testMatch(RE_HORIZONTAL_RULE, "___")).toBe(true);
    });

    it("RE_UNORDERED_LIST matches list items", () => {
      expect(testMatch(RE_UNORDERED_LIST, "- item")).toBe(true);
      expect(testMatch(RE_UNORDERED_LIST, "* item")).toBe(true);
      expect(testMatch(RE_UNORDERED_LIST, "+ item")).toBe(true);
    });

    it("RE_ORDERED_LIST matches numbered items", () => {
      expect(testMatch(RE_ORDERED_LIST, "1. first")).toBe(true);
      expect(testMatch(RE_ORDERED_LIST, "99. ninety-nine")).toBe(true);
    });
  });

  describe("latex patterns", () => {
    it("RE_BOXED_DOLLAR captures $\\boxed{...}$", () => {
      // Use matchAll for global regex to get capture groups
      const matches = [..."$\\boxed{42}$".matchAll(RE_BOXED_DOLLAR)];
      expect(matches.length).toBe(1);
      expect(matches[0]?.[1]).toBe("42");
    });

    it("RE_BOXED captures \\boxed{...}", () => {
      const matches = [..."\\boxed{answer}".matchAll(RE_BOXED)];
      expect(matches.length).toBe(1);
      expect(matches[0]?.[1]).toBe("answer");
    });

    it("RE_INLINE_MATH captures $...$", () => {
      const match = getMatches(RE_INLINE_MATH, "$x^2 + y^2$");
      expect(match).not.toBeNull();
    });
  });

  describe("HTML entities", () => {
    it("RE_NBSP matches &nbsp;", () => {
      expect(testMatch(RE_NBSP, "&nbsp;")).toBe(true);
    });

    it("RE_AMP matches &amp;", () => {
      expect(testMatch(RE_AMP, "&amp;")).toBe(true);
    });

    it("RE_LT matches &lt;", () => {
      expect(testMatch(RE_LT, "&lt;")).toBe(true);
    });

    it("RE_GT matches &gt;", () => {
      expect(testMatch(RE_GT, "&gt;")).toBe(true);
    });

    it("RE_QUOT matches &quot;", () => {
      expect(testMatch(RE_QUOT, "&quot;")).toBe(true);
    });

    it("RE_APOS matches &#39;", () => {
      expect(testMatch(RE_APOS, "&#39;")).toBe(true);
    });

    it("RE_BR matches <br> variants", () => {
      expect(testMatch(RE_BR, "<br>")).toBe(true);
      expect(testMatch(RE_BR, "<br/>")).toBe(true);
      expect(testMatch(RE_BR, "<br />")).toBe(true);
    });

    it("RE_SIMPLE_TAGS matches common HTML tags", () => {
      expect(testMatch(RE_SIMPLE_TAGS, "<p>")).toBe(true);
      expect(testMatch(RE_SIMPLE_TAGS, "</p>")).toBe(true);
      expect(testMatch(RE_SIMPLE_TAGS, "<div>")).toBe(true);
      expect(testMatch(RE_SIMPLE_TAGS, "<span>")).toBe(true);
      expect(testMatch(RE_SIMPLE_TAGS, "<strong>")).toBe(true);
      expect(testMatch(RE_SIMPLE_TAGS, "<em>")).toBe(true);
    });
  });

  describe("whitespace patterns", () => {
    it("RE_MULTI_NEWLINE matches 3+ newlines", () => {
      expect(testMatch(RE_MULTI_NEWLINE, "\n\n\n")).toBe(true);
      expect(testMatch(RE_MULTI_NEWLINE, "\n\n\n\n\n")).toBe(true);
      expect(testMatch(RE_MULTI_NEWLINE, "\n\n")).toBe(false);
    });

    it("RE_TRAILING_WHITESPACE matches line-end spaces", () => {
      expect(testMatch(RE_TRAILING_WHITESPACE, "text  ")).toBe(true);
      expect(testMatch(RE_TRAILING_WHITESPACE, "text\t")).toBe(true);
    });

    it("RE_MULTI_SPACE matches 2+ spaces", () => {
      expect(testMatch(RE_MULTI_SPACE, "word  word")).toBe(true);
      expect(testMatch(RE_MULTI_SPACE, "word word")).toBe(false);
    });
  });

  describe("answer extraction patterns", () => {
    it("RE_WORD_FRACTION matches word fractions", () => {
      expect(testMatch(RE_WORD_FRACTION, "one half")).toBe(true);
      expect(testMatch(RE_WORD_FRACTION, "two-thirds")).toBe(true);
      expect(testMatch(RE_WORD_FRACTION, "three quarters")).toBe(true);
      expect(testMatch(RE_WORD_FRACTION, "a third")).toBe(true);
    });

    it("RE_WORD_FRACTION_START matches at string start", () => {
      // This pattern is not global, so .test() works without reset
      expect(RE_WORD_FRACTION_START.test("one half of the pie")).toBe(true);
      expect(RE_WORD_FRACTION_START.test("the one half")).toBe(false);
    });

    it("RE_PERCENTAGE captures percentages", () => {
      const matches = [..."75%".matchAll(RE_PERCENTAGE)];
      expect(matches.length).toBe(1);
      expect(matches[0]?.[1]).toBe("75");

      const negMatches = [..."-3.14%".matchAll(RE_PERCENTAGE)];
      expect(negMatches[0]?.[1]).toBe("-3.14");
    });
  });

  describe("patterns are reusable (stateless after reset)", () => {
    it("global patterns can be reused with lastIndex reset", () => {
      const text = "one half and two thirds";

      // First use
      RE_WORD_FRACTION.lastIndex = 0;
      const matches1 = [...text.matchAll(RE_WORD_FRACTION)];
      expect(matches1.length).toBe(2);

      // Second use (same pattern, same text)
      RE_WORD_FRACTION.lastIndex = 0;
      const matches2 = [...text.matchAll(RE_WORD_FRACTION)];
      expect(matches2.length).toBe(2);
    });
  });
});
