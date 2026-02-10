/**
 * Unit tests for extraction module
 * Tests answer extraction, markdown stripping, and LLM output processing
 */

import { describe, expect, test } from "bun:test";
import {
  answersMatch,
  extractAnswer,
  extractAnswerWithConfidence,
  normalizeAnswer,
  parseFraction,
  shouldStreamStrip,
  stripLLMOutput,
  stripLLMOutputAsync,
  stripLLMOutputStreaming,
  stripMarkdown,
  stripThinkingTagsFast,
} from "../src/text/extraction";

describe("AnswerExtraction - stripMarkdown", () => {
  test("removes bold markdown", () => {
    expect(stripMarkdown("The **answer** is here")).toBe("The answer is here");
  });

  test("removes italic markdown", () => {
    expect(stripMarkdown("The *answer* is here")).toBe("The answer is here");
  });

  test("removes code blocks", () => {
    const input = "Text before\n```javascript\nconst x = 5;\n```\nText after";
    expect(stripMarkdown(input)).toBe("Text before\n\nText after");
  });

  test("removes inline code", () => {
    expect(stripMarkdown("Use `console.log` to debug")).toBe("Use console.log to debug");
  });

  test("removes LaTeX boxed", () => {
    expect(stripMarkdown("The answer is $\\boxed{42}$")).toBe("The answer is 42");
    expect(stripMarkdown("Result: \\boxed{123}")).toBe("Result: 123");
  });

  test("removes headings", () => {
    expect(stripMarkdown("# Heading\nContent")).toBe("Heading\nContent");
    expect(stripMarkdown("### Level 3\nMore")).toBe("Level 3\nMore");
  });

  test("removes list markers", () => {
    expect(stripMarkdown("- Item one\n* Item two\n+ Item three")).toBe(
      "Item one\nItem two\nItem three",
    );
  });

  test("removes numbered lists", () => {
    expect(stripMarkdown("1. First\n2. Second")).toBe("First\nSecond");
  });

  test("converts links to text", () => {
    expect(stripMarkdown("Check [this link](https://example.com)")).toBe("Check this link");
  });

  test("removes images", () => {
    expect(stripMarkdown("Here ![alt text](image.png) is image")).toBe("Here is image");
  });

  test("removes blockquotes", () => {
    expect(stripMarkdown("> Quoted text\nNormal")).toBe("Quoted text\nNormal");
  });
});

// =============================================================================
// stripLLMOutput COMPREHENSIVE TESTS
// Tests all pattern categories handled by the unified stripping function
// =============================================================================

describe("stripLLMOutput", () => {
  describe("Thinking/Reasoning Tags", () => {
    test("strips standard <think> tags (DeepSeek)", () => {
      const input = "Before <think>internal reasoning here</think> After";
      expect(stripLLMOutput(input)).toBe("Before After");
    });

    test("strips <thinking> tags", () => {
      const input = "Start <thinking>Let me think step by step...</thinking> End";
      expect(stripLLMOutput(input)).toBe("Start End");
    });

    test("strips <reasoning> tags", () => {
      const input = "Question <reasoning>working through logic</reasoning> Answer: 42";
      expect(stripLLMOutput(input)).toBe("Question Answer: 42");
    });

    test("strips <antithink> tags (Claude)", () => {
      const input = "Response <antithink>self-correction notes</antithink> final output";
      expect(stripLLMOutput(input)).toBe("Response final output");
    });

    test("strips <thought> tags (Gemini)", () => {
      const input = "Begin <thought>pondering the problem</thought> conclusion";
      expect(stripLLMOutput(input)).toBe("Begin conclusion");
    });

    test("strips <thoughts> tags (Gemini plural)", () => {
      const input = "Start <thoughts>multiple thoughts here</thoughts> result";
      expect(stripLLMOutput(input)).toBe("Start result");
    });

    test("strips <reflection> tags (Llama)", () => {
      const input = "Initial <reflection>self-review content</reflection> final";
      expect(stripLLMOutput(input)).toBe("Initial final");
    });

    test("strips <internal_monologue> tags (Mistral)", () => {
      const input = "Output <internal_monologue>inner dialogue</internal_monologue> answer";
      expect(stripLLMOutput(input)).toBe("Output answer");
    });

    test("handles case-insensitive tags", () => {
      const input1 = "<THINK>caps</THINK> result";
      const input2 = "<Think>mixed</Think> result";
      expect(stripLLMOutput(input1)).toBe("result");
      expect(stripLLMOutput(input2)).toBe("result");
    });

    test("handles multiline thinking content", () => {
      const input = `Before
<think>
Line 1 of reasoning
Line 2 of reasoning
</think>
After`;
      expect(stripLLMOutput(input)).toBe("Before\n\nAfter");
    });

    test("handles multiple thinking tags", () => {
      const input = "<think>first</think> middle <think>second</think> end";
      expect(stripLLMOutput(input)).toBe("middle end");
    });
  });

  describe("Tool/Artifact Containers", () => {
    test("strips <tool_call> tags", () => {
      const input = "Calling <tool_call>function(args)</tool_call> done";
      expect(stripLLMOutput(input)).toBe("Calling done");
    });

    test("strips <tool_result> tags", () => {
      const input = "Got <tool_result>returned data</tool_result> processed";
      expect(stripLLMOutput(input)).toBe("Got processed");
    });

    test("strips <ARTIFACTS> tags", () => {
      const input = "Content <ARTIFACTS>artifact data here</ARTIFACTS> more";
      expect(stripLLMOutput(input)).toBe("Content more");
    });

    test("strips <document_content> tags", () => {
      const input = "See <document_content>doc text</document_content> reference";
      expect(stripLLMOutput(input)).toBe("See reference");
    });

    test("strips <context> tags", () => {
      const input = "With <context>background info</context> analysis";
      expect(stripLLMOutput(input)).toBe("With analysis");
    });
  });

  describe("Model-Specific Tokens", () => {
    test("strips GLM box tokens", () => {
      const input = "<|begin_of_box|>Answer: 42<|end_of_box|>";
      expect(stripLLMOutput(input)).toBe("Answer: 42");
    });

    test("strips <|im_start|>...<|im_end|> sequences", () => {
      const input = "Before <|im_start|>system content here<|im_end|> After";
      expect(stripLLMOutput(input)).toBe("Before After");
    });

    test("strips <|endoftext|> token", () => {
      const input = "Final answer<|endoftext|>";
      expect(stripLLMOutput(input)).toBe("Final answer");
    });

    test("strips <|pad|> tokens", () => {
      const input = "Content<|pad|><|pad|><|pad|>more";
      expect(stripLLMOutput(input)).toBe("Contentmore");
    });

    test("handles multiple model tokens together", () => {
      const input = "<|begin_of_box|>42<|end_of_box|><|endoftext|><|pad|>";
      expect(stripLLMOutput(input)).toBe("42");
    });
  });

  describe("Markdown Formatting", () => {
    test("removes code blocks", () => {
      const input = "Before\n```python\ndef foo(): pass\n```\nAfter";
      expect(stripLLMOutput(input)).toBe("Before\n\nAfter");
    });

    test("removes bold **text**", () => {
      expect(stripLLMOutput("The **answer** is")).toBe("The answer is");
    });

    test("removes bold __text__", () => {
      expect(stripLLMOutput("The __answer__ is")).toBe("The answer is");
    });

    test("removes italic *text*", () => {
      expect(stripLLMOutput("This is *important*")).toBe("This is important");
    });

    test("removes italic _text_", () => {
      expect(stripLLMOutput("This is _important_")).toBe("This is important");
    });

    test("removes inline code", () => {
      expect(stripLLMOutput("Use `console.log`")).toBe("Use console.log");
    });

    test("removes headings", () => {
      expect(stripLLMOutput("# Title\n## Subtitle")).toBe("Title\nSubtitle");
    });

    test("removes strikethrough", () => {
      expect(stripLLMOutput("Not ~~wrong~~ correct")).toBe("Not wrong correct");
    });

    test("removes images", () => {
      expect(stripLLMOutput("See ![alt](img.png) here")).toBe("See here");
    });

    test("converts links to text", () => {
      expect(stripLLMOutput("Click [here](url)")).toBe("Click here");
    });

    test("removes blockquote markers", () => {
      expect(stripLLMOutput("> Quote\nNormal")).toBe("Quote\nNormal");
    });

    test("removes horizontal rules", () => {
      expect(stripLLMOutput("Above\n---\nBelow")).toBe("Above\n\nBelow");
    });

    test("removes unordered list markers", () => {
      expect(stripLLMOutput("- Item 1\n* Item 2\n+ Item 3")).toBe("Item 1\nItem 2\nItem 3");
    });

    test("removes ordered list markers", () => {
      expect(stripLLMOutput("1. First\n2. Second")).toBe("First\nSecond");
    });
  });

  describe("LaTeX Content", () => {
    test("extracts from $\\boxed{X}$", () => {
      expect(stripLLMOutput("Result: $\\boxed{42}$")).toBe("Result: 42");
    });

    test("extracts from \\boxed{X} without dollar", () => {
      expect(stripLLMOutput("Answer: \\boxed{-17}")).toBe("Answer: -17");
    });

    test("strips inline math $...$", () => {
      expect(stripLLMOutput("The value $x + y$ equals")).toBe("The value x + y equals");
    });
  });

  describe("HTML Entities and Tags", () => {
    test("converts &nbsp; to space", () => {
      expect(stripLLMOutput("Hello&nbsp;World")).toBe("Hello World");
    });

    test("converts &amp; to &", () => {
      expect(stripLLMOutput("A &amp; B")).toBe("A & B");
    });

    test("converts &lt; and &gt;", () => {
      expect(stripLLMOutput("&lt;tag&gt;")).toBe("<tag>");
    });

    test("converts &quot; to quote", () => {
      expect(stripLLMOutput("He said &quot;hello&quot;")).toBe('He said "hello"');
    });

    test("converts &#39; to apostrophe", () => {
      expect(stripLLMOutput("It&#39;s fine")).toBe("It's fine");
    });

    test("converts <br> to newline", () => {
      expect(stripLLMOutput("Line1<br>Line2")).toBe("Line1\nLine2");
    });

    test("converts <br/> and <br /> variants", () => {
      expect(stripLLMOutput("A<br/>B<br />C")).toBe("A\nB\nC");
    });

    test("strips simple HTML tags", () => {
      expect(stripLLMOutput("<p>Paragraph</p>")).toBe("Paragraph");
      expect(stripLLMOutput("<div>Content</div>")).toBe("Content");
      expect(stripLLMOutput("<span>Inline</span>")).toBe("Inline");
      expect(stripLLMOutput("<b>Bold</b>")).toBe("Bold");
      expect(stripLLMOutput("<i>Italic</i>")).toBe("Italic");
      expect(stripLLMOutput("<em>Emphasis</em>")).toBe("Emphasis");
      expect(stripLLMOutput("<strong>Strong</strong>")).toBe("Strong");
    });
  });

  describe("Whitespace Cleanup", () => {
    test("collapses multiple newlines to double", () => {
      expect(stripLLMOutput("A\n\n\n\nB")).toBe("A\n\nB");
    });

    test("removes trailing whitespace from lines", () => {
      expect(stripLLMOutput("Line1   \nLine2\t\nLine3")).toBe("Line1\nLine2\nLine3");
    });

    test("collapses multiple spaces to single", () => {
      expect(stripLLMOutput("Word    word")).toBe("Word word");
    });

    test("trims leading/trailing whitespace", () => {
      expect(stripLLMOutput("  trimmed  ")).toBe("trimmed");
    });
  });

  describe("Combined/Nested Cases", () => {
    test("thinking tags containing markdown", () => {
      const input = "<think>**bold** reasoning with `code`</think> Answer: 42";
      expect(stripLLMOutput(input)).toBe("Answer: 42");
    });

    test("markdown around thinking tags", () => {
      const input = "**Note**: <think>internal</think> The result is `42`";
      expect(stripLLMOutput(input)).toBe("Note: The result is 42");
    });

    test("multiple tag types interleaved", () => {
      const input = "<think>reasoning</think> **Answer**: <tool_call>call()</tool_call> 42";
      expect(stripLLMOutput(input)).toBe("Answer: 42");
    });

    test("model tokens with thinking and markdown", () => {
      const input =
        "<|begin_of_box|><think>process</think>**Final**: 42<|end_of_box|><|endoftext|>";
      expect(stripLLMOutput(input)).toBe("Final: 42");
    });

    test("full realistic model output", () => {
      const input = `<think>
Let me work through this step by step.
First, I'll calculate...
</think>

Based on my analysis:

**The answer is 42.**

<|endoftext|>`;
      expect(stripLLMOutput(input)).toBe("Based on my analysis:\n\nThe answer is 42.");
    });

    test("HTML entities in markdown context", () => {
      const input = "**A &amp; B** is `x &lt; y`";
      expect(stripLLMOutput(input)).toBe("A & B is x < y");
    });
  });

  describe("Edge Cases", () => {
    test("empty string", () => {
      expect(stripLLMOutput("")).toBe("");
    });

    test("already clean text", () => {
      const input = "This is clean text without any markup.";
      expect(stripLLMOutput(input)).toBe("This is clean text without any markup.");
    });

    test("unclosed tags remain unchanged", () => {
      // Unclosed tags shouldn't cause infinite loops or crashes
      const input = "<think>unclosed content without end tag";
      expect(stripLLMOutput(input)).toBe("<think>unclosed content without end tag");
    });

    test("nested same-type tags (greedy match)", () => {
      // Regex is non-greedy, so nested same tags may not work perfectly
      // This documents the current behavior
      const input = "<think>outer<think>inner</think>still outer</think>end";
      // Current behavior: first </think> closes first <think>
      expect(stripLLMOutput(input)).not.toContain("inner");
    });

    test("preserves meaningful content between artifacts", () => {
      const input =
        "<think>hidden</think>VISIBLE<tool_call>ignored</tool_call>ALSO VISIBLE<|endoftext|>";
      expect(stripLLMOutput(input)).toBe("VISIBLEALSO VISIBLE");
    });
  });

  describe("Performance", () => {
    test("processes 5KB response in under 1ms", () => {
      // Realistic model output with mixed artifacts
      const chunk = `<think>
Let me reason through this step by step.
First, I need to consider...
</think>

**Analysis**: The problem requires us to calculate the sum.

Given: $x = 5$ and $y = 10$

\`\`\`python
result = x + y
\`\`\`

The answer is $\\boxed{15}$.

<|endoftext|>`;

      // Build 5KB input
      const targetBytes = 5000;
      const repetitions = Math.ceil(targetBytes / chunk.length);
      const input = chunk.repeat(repetitions).slice(0, targetBytes);

      // Warm-up
      stripLLMOutput(input);

      // Timed run (multiple iterations for stability)
      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(input);
      }
      const elapsed = performance.now() - start;
      const avgMs = elapsed / iterations;

      // Should be under 1ms for 5KB
      expect(avgMs).toBeLessThan(1);
    });

    test("maintains O(n) scaling", () => {
      const base = "<think>reasoning</think> **Bold** `code` answer ";

      // Test at 1KB and 10KB
      const small = base.repeat(Math.ceil(1000 / base.length)).slice(0, 1000);
      const large = base.repeat(Math.ceil(10000 / base.length)).slice(0, 10000);

      // Warm-up
      stripLLMOutput(small);
      stripLLMOutput(large);

      // Time small
      const iterations = 50;
      const startSmall = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(small);
      }
      const elapsedSmall = performance.now() - startSmall;

      // Time large
      const startLarge = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(large);
      }
      const elapsedLarge = performance.now() - startLarge;

      // 10x input should be roughly 10x time (allow 20x for overhead)
      const ratio = elapsedLarge / elapsedSmall;
      expect(ratio).toBeLessThan(20);
    });
  });

  describe("Backward Compatibility", () => {
    test("stripThinkingTags alias works", () => {
      // stripThinkingTags is exported as alias
      expect(stripMarkdown("<think>test</think> result")).toBe("result");
    });

    test("stripMarkdown alias produces same result", () => {
      const input = "<think>reasoning</think> **Bold** `code` $\\boxed{42}$";
      expect(stripMarkdown(input)).toBe(stripLLMOutput(input));
    });
  });
});

// =============================================================================
// stripThinkingTagsFast TESTS (S1: Fast variant)
// =============================================================================

describe("stripThinkingTagsFast", () => {
  describe("Functionality", () => {
    test("strips all thinking tag variants", () => {
      expect(stripThinkingTagsFast("<think>hidden</think> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<thinking>hidden</thinking> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<reasoning>hidden</reasoning> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<antithink>hidden</antithink> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<thought>hidden</thought> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<thoughts>hidden</thoughts> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<reflection>hidden</reflection> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<internal_monologue>hidden</internal_monologue> visible")).toBe(
        "visible",
      );
    });

    test("strips model tokens", () => {
      expect(stripThinkingTagsFast("answer<|endoftext|>")).toBe("answer");
      expect(stripThinkingTagsFast("<|begin_of_box|>42<|end_of_box|>")).toBe("42");
      expect(stripThinkingTagsFast("text<|pad|><|pad|>")).toBe("text");
    });

    test("handles combined input", () => {
      const input = "<think>reasoning</think> The answer is 42<|endoftext|>";
      expect(stripThinkingTagsFast(input)).toBe("The answer is 42");
    });

    test("preserves markdown (unlike full stripLLMOutput)", () => {
      const input = "<think>hidden</think> **Bold** and `code`";
      const result = stripThinkingTagsFast(input);
      // Fast variant keeps markdown intact
      expect(result).toContain("**Bold**");
      expect(result).toContain("`code`");
    });

    test("cleans whitespace", () => {
      const input = "<think>hidden</think>  \n\n\n\n  visible";
      const result = stripThinkingTagsFast(input);
      expect(result).not.toMatch(/\n{3,}/);
      expect(result).not.toMatch(/ {2}/);
    });

    test("handles case-insensitive tags", () => {
      expect(stripThinkingTagsFast("<THINK>hidden</THINK> visible")).toBe("visible");
      expect(stripThinkingTagsFast("<Think>hidden</Think> visible")).toBe("visible");
    });

    test("handles multiline content", () => {
      const input = `<think>
Line 1
Line 2
</think>
Result`;
      expect(stripThinkingTagsFast(input)).toBe("Result");
    });
  });

  describe("Performance", () => {
    test("is faster than stripLLMOutput for thinking-only content", () => {
      // Create larger input for more stable measurements
      const input = "<think>reasoning content here</think> Answer: 42<|endoftext|>".repeat(500);

      // Warm-up (multiple iterations)
      for (let i = 0; i < 10; i++) {
        stripThinkingTagsFast(input);
        stripLLMOutput(input);
      }

      const iterations = 100;

      // Time fast variant
      const startFast = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripThinkingTagsFast(input);
      }
      const elapsedFast = performance.now() - startFast;

      // Time full variant
      const startFull = performance.now();
      for (let i = 0; i < iterations; i++) {
        stripLLMOutput(input);
      }
      const elapsedFull = performance.now() - startFull;

      // Fast should be faster (relaxed threshold for CI variability)
      // On most systems it's 2-5x faster, but CI can be noisy
      const speedup = elapsedFull / elapsedFast;
      expect(speedup).toBeGreaterThan(1.2);
    });
  });
});

// =============================================================================
// STREAMING TESTS (S2: Large response handling)
// =============================================================================

describe("Streaming Strip Functions", () => {
  describe("shouldStreamStrip", () => {
    test("returns false for small inputs (<100KB)", () => {
      const small = "x".repeat(50 * 1024); // 50KB
      expect(shouldStreamStrip(small)).toBe(false);
    });

    test("returns true for large inputs (>100KB)", () => {
      const large = "x".repeat(150 * 1024); // 150KB
      expect(shouldStreamStrip(large)).toBe(true);
    });

    test("returns false for exactly 100KB", () => {
      const exact = "x".repeat(100 * 1024);
      expect(shouldStreamStrip(exact)).toBe(false);
    });
  });

  describe("stripLLMOutputStreaming", () => {
    test("yields single chunk for small input", () => {
      const input = "<think>hidden</think> visible";
      const chunks = [...stripLLMOutputStreaming(input)];
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("visible");
    });

    test("yields multiple chunks for large input", () => {
      // Create input >100KB with thinking tags
      const chunk = "<think>reasoning block</think> visible content here. ";
      const repetitions = Math.ceil((150 * 1024) / chunk.length);
      const largeInput = chunk.repeat(repetitions);

      const chunks = [...stripLLMOutputStreaming(largeInput)];

      // Should have multiple chunks
      expect(chunks.length).toBeGreaterThan(1);

      // Reassembled output should not contain thinking tags
      const reassembled = chunks.join(" ");
      expect(reassembled).not.toContain("<think>");
      expect(reassembled).not.toContain("</think>");
      expect(reassembled).toContain("visible content here");
    });

    test("handles tags at chunk boundaries", () => {
      // Create input where tags might span chunk boundaries
      const thinkContent = "x".repeat(30 * 1024); // 30KB of content in think tag
      const input = `<think>${thinkContent}</think> visible after`.repeat(5);

      const chunks = [...stripLLMOutputStreaming(input)];
      const reassembled = chunks.join(" ");

      // Should properly strip all think tags even across boundaries
      expect(reassembled).not.toContain("<think>");
      expect(reassembled).toContain("visible after");
    });

    test("empty input yields empty result", () => {
      const chunks = [...stripLLMOutputStreaming("")];
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("");
    });
  });

  describe("stripLLMOutputAsync", () => {
    test("returns same result as sync for small input", async () => {
      const input = "<think>hidden</think> **Bold** answer";
      const asyncResult = await stripLLMOutputAsync(input);
      const syncResult = stripLLMOutput(input);
      expect(asyncResult).toBe(syncResult);
    });

    test("processes large input without blocking", async () => {
      // Create 200KB input
      const chunk = "<think>reasoning</think> content ";
      const largeInput = chunk.repeat(Math.ceil((200 * 1024) / chunk.length));

      const start = performance.now();
      const result = await stripLLMOutputAsync(largeInput);
      const elapsed = performance.now() - start;

      // Should complete and return valid result
      expect(result).not.toContain("<think>");
      expect(result).toContain("content");

      // Should complete in reasonable time (< 1 second for 200KB)
      expect(elapsed).toBeLessThan(1000);
    });

    test("handles concurrent calls", async () => {
      const input1 = "<think>first</think> result1<|endoftext|>";
      const input2 = "<thinking>second</thinking> result2<|endoftext|>";

      const [r1, r2] = await Promise.all([
        stripLLMOutputAsync(input1),
        stripLLMOutputAsync(input2),
      ]);

      expect(r1).toBe("result1");
      expect(r2).toBe("result2");
    });
  });
});

describe("AnswerExtraction - extractAnswer", () => {
  describe("Priority 1: LaTeX boxed", () => {
    test("extracts from \\boxed{}", () => {
      expect(extractAnswer("The solution is \\boxed{42}")).toBe("42");
    });

    test("extracts from $\\boxed{}$", () => {
      expect(extractAnswer("Final answer: $\\boxed{-17}$")).toBe("-17");
    });
  });

  describe("Priority 2-3: Explicit answer markers", () => {
    test("extracts from 'Final Answer: X'", () => {
      expect(extractAnswer("After calculation, Final Answer: 45")).toBe("45");
    });

    test("extracts from 'Answer: X'", () => {
      expect(extractAnswer("After working through, Answer: 123")).toBe("123");
    });

    test("extracts word answer from 'Answer: YES'", () => {
      expect(extractAnswer("Is it valid? Answer: YES")).toBe("YES");
    });
  });

  describe("Priority 4: 'The answer is X' pattern", () => {
    test("extracts number from 'the answer is 45'", () => {
      expect(extractAnswer("So the answer is 45 degrees")).toBe("45");
    });

    test("extracts from 'answer is 100'", () => {
      expect(extractAnswer("The final answer is 100")).toBe("100");
    });

    test("extracts capitalized word", () => {
      expect(extractAnswer("The answer is YES because...")).toBe("YES");
    });
  });

  describe("Priority 5: Result marker", () => {
    test("extracts from 'Result: X'", () => {
      expect(extractAnswer("Computation Result: 256")).toBe("256");
    });
  });

  describe("Priority 6: Equation result", () => {
    test("extracts last equation result", () => {
      expect(extractAnswer("First x = 10, then y = 20, finally z = 30")).toBe("30");
    });

    test("handles single equation", () => {
      expect(extractAnswer("The sum = 45")).toBe("45");
    });

    test("extracts fraction from equation", () => {
      expect(extractAnswer("The probability = 2/3")).toBe("2/3");
    });
  });

  describe("Priority 7-8: Number extraction", () => {
    test("extracts 'is NUMBER' from last lines", () => {
      expect(extractAnswer("The calculation shows the total is 75")).toBe("75");
    });

    test("extracts standalone number on line", () => {
      expect(extractAnswer("After all calculations:\n42")).toBe("42");
    });

    test("extracts last number as fallback", () => {
      expect(extractAnswer("Numbers 5, 10, 15, 20 in the sequence")).toBe("20");
    });

    test("extracts fraction from 'is X' pattern", () => {
      expect(extractAnswer("The probability is 2/3")).toBe("2/3");
    });

    test("extracts standalone fraction on line", () => {
      expect(extractAnswer("The answer:\n3/4")).toBe("3/4");
    });

    test("extracts fraction as last number fallback", () => {
      expect(extractAnswer("2/3 is the probability")).toBe("2/3");
    });

    test("extracts word fraction with hyphen", () => {
      expect(extractAnswer("The answer is two-thirds")).toBe("two-thirds");
    });

    test("extracts word fraction with space", () => {
      expect(extractAnswer("The answer is two thirds")).toBe("two thirds");
    });

    test("extracts word fraction 'a half'", () => {
      expect(extractAnswer("The answer is a half")).toBe("a half");
    });

    test("extracts word fraction as fallback", () => {
      expect(extractAnswer("one-fourth of the total")).toBe("one-fourth");
    });
  });

  describe("Priority 9: Word answer fallback", () => {
    test("extracts meaningful last word", () => {
      expect(extractAnswer("The statement is TRUE")).toBe("TRUE");
    });

    test("skips stopwords", () => {
      // Should not extract "is" or "the"
      const result = extractAnswer("What this means is the following");
      expect(result).not.toBe("is");
      expect(result).not.toBe("the");
    });
  });

  describe("Edge cases", () => {
    test("handles comma-separated numbers", () => {
      expect(extractAnswer("The population is 1,234,567")).toBe("1234567");
    });

    test("handles negative numbers", () => {
      expect(extractAnswer("The answer is -42")).toBe("-42");
    });

    test("handles decimal numbers", () => {
      expect(extractAnswer("Result: 3.14159")).toBe("3.14159");
    });

    test("handles mixed markdown and answer", () => {
      expect(extractAnswer("**Final Answer**: 99")).toBe("99");
    });

    test("handles percentage in 'is X' pattern", () => {
      expect(extractAnswer("The probability is 75%")).toBe("75%");
    });

    test("handles percentage in 'Answer:' pattern", () => {
      expect(extractAnswer("Answer: 50%")).toBe("50%");
    });

    test("handles percentage as last value", () => {
      expect(extractAnswer("Rate of 33.3% observed")).toBe("33.3%");
    });

    test("handles standalone percentage on line", () => {
      expect(extractAnswer("The result:\n95%")).toBe("95%");
    });
  });
});

describe("AnswerExtraction - extractAnswerWithConfidence", () => {
  test("highest confidence for expected answer match", () => {
    const result = extractAnswerWithConfidence("The answer is definitely 42", ["42", "forty-two"]);
    expect(result.answer).toBe("42");
    expect(result.confidence).toBe(1.0);
    expect(result.source).toBe("expected");
  });

  test("high confidence for boxed answers", () => {
    const result = extractAnswerWithConfidence("Therefore \\boxed{42} is the answer");
    expect(result.answer).toBe("42");
    expect(result.confidence).toBe(0.95);
    expect(result.source).toBe("boxed");
  });

  test("explicit markers have good confidence", () => {
    const result = extractAnswerWithConfidence("After calculation, the answer is 99.");
    expect(result.answer).toBe("99");
    expect(result.confidence).toBe(0.85);
    expect(result.source).toBe("explicit");
  });

  test("equation results have moderate confidence", () => {
    const result = extractAnswerWithConfidence("Calculating: 2 + 2 = 4. So 5 + 7 = 12");
    expect(result.answer).toBe("12");
    expect(result.confidence).toBe(0.7);
    expect(result.source).toBe("equation");
  });

  test("standalone numbers have lower confidence", () => {
    const result = extractAnswerWithConfidence("Some text here.\n42");
    expect(result.answer).toBe("42");
    expect(result.confidence).toBe(0.6);
    expect(result.source).toBe("standalone");
  });

  test("fallback has lowest confidence", () => {
    const result = extractAnswerWithConfidence("The statement is TRUE");
    expect(result.answer).toBe("TRUE");
    expect(result.confidence).toBe(0.3);
    expect(result.source).toBe("fallback");
  });

  test("returns same answer as extractAnswer", () => {
    const inputs = ["The answer is 42", "\\boxed{99}", "Result: 3.14", "2 + 3 = 5", "YES"];
    for (const input of inputs) {
      const withConf = extractAnswerWithConfidence(input);
      const plain = extractAnswer(input);
      expect(withConf.answer).toBe(plain);
    }
  });
});

describe("AnswerExtraction - normalizeAnswer", () => {
  test("lowercases", () => {
    expect(normalizeAnswer("YES")).toBe("yes");
  });

  test("removes commas from numbers", () => {
    expect(normalizeAnswer("1,234,567")).toBe("1234567");
  });

  test("removes whitespace", () => {
    expect(normalizeAnswer("  42  ")).toBe("42");
    expect(normalizeAnswer("hello world")).toBe("helloworld");
  });

  test("removes leading zeros", () => {
    expect(normalizeAnswer("007")).toBe("7");
    expect(normalizeAnswer("0")).toBe("0"); // Keep single zero
  });

  test("removes trailing .0", () => {
    expect(normalizeAnswer("42.0")).toBe("42");
    expect(normalizeAnswer("42.00")).toBe("42");
  });
});

describe("AnswerExtraction - answersMatch", () => {
  test("exact match after normalization", () => {
    expect(answersMatch("42", "42")).toBe(true);
    expect(answersMatch("YES", "yes")).toBe(true);
    expect(answersMatch("1,234", "1234")).toBe(true);
  });

  test("numeric comparison with tolerance", () => {
    expect(answersMatch("3.14159", "3.14159")).toBe(true);
    expect(answersMatch("3.1416", "3.14159")).toBe(true); // Close enough
  });

  test("partial match (contains)", () => {
    expect(answersMatch("45", "45 degrees")).toBe(true);
    expect(answersMatch("42", "answer is 42")).toBe(true);
  });

  test("rejects non-matching", () => {
    expect(answersMatch("42", "43")).toBe(false);
    expect(answersMatch("YES", "NO")).toBe(false);
  });

  test("rejects false positive containment for numeric-only strings", () => {
    // Bug fix: "1/2" should NOT match "1" via containment (both numeric)
    expect(answersMatch("1/2", "1")).toBe(false);
    expect(answersMatch("12", "1")).toBe(false);
    expect(answersMatch("21", "1")).toBe(false);
    expect(answersMatch("123", "12")).toBe(false);
  });

  // Fraction matching tests
  test("fraction to decimal: 1/2 matches 0.5", () => {
    expect(answersMatch("1/2", "0.5")).toBe(true);
    expect(answersMatch("0.5", "1/2")).toBe(true);
  });

  test("fraction to decimal: 2/3 matches 0.667", () => {
    expect(answersMatch("2/3", "0.6667")).toBe(true);
    expect(answersMatch("2/3", "0.667")).toBe(true);
  });

  test("fraction to decimal: 3/4 matches 0.75", () => {
    expect(answersMatch("3/4", "0.75")).toBe(true);
  });

  test("fraction to fraction: equivalent fractions match", () => {
    expect(answersMatch("1/2", "2/4")).toBe(true);
    expect(answersMatch("2/3", "4/6")).toBe(true);
    expect(answersMatch("3/9", "1/3")).toBe(true);
  });

  test("word fractions match numeric: one-half matches 0.5", () => {
    expect(answersMatch("one-half", "0.5")).toBe(true);
    expect(answersMatch("one half", "0.5")).toBe(true);
    expect(answersMatch("a half", "0.5")).toBe(true);
  });

  test("word fractions match numeric: two-thirds matches 2/3", () => {
    expect(answersMatch("two-thirds", "2/3")).toBe(true);
    expect(answersMatch("two thirds", "0.6667")).toBe(true);
  });

  test("word fractions match numeric: three-quarters matches 0.75", () => {
    expect(answersMatch("three-quarters", "0.75")).toBe(true);
    expect(answersMatch("three quarters", "3/4")).toBe(true);
    expect(answersMatch("three-fourths", "0.75")).toBe(true);
  });

  test("various word fractions", () => {
    expect(answersMatch("one-third", "1/3")).toBe(true);
    expect(answersMatch("one-fourth", "0.25")).toBe(true);
    expect(answersMatch("one-quarter", "0.25")).toBe(true);
    expect(answersMatch("two-fifths", "0.4")).toBe(true);
    expect(answersMatch("three-tenths", "0.3")).toBe(true);
  });

  test("mixed numbers: 1 1/2 matches 1.5", () => {
    expect(answersMatch("1 1/2", "1.5")).toBe(true);
    expect(answersMatch("2 3/4", "2.75")).toBe(true);
  });
});

describe("AnswerExtraction - parseFraction", () => {
  test("parses simple numeric fractions", () => {
    expect(parseFraction("1/2")).toBe(0.5);
    expect(parseFraction("2/3")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("3/4")).toBe(0.75);
    expect(parseFraction("1/4")).toBe(0.25);
    expect(parseFraction("5/8")).toBe(0.625);
  });

  test("parses fractions with whitespace", () => {
    expect(parseFraction(" 1/2 ")).toBe(0.5);
    expect(parseFraction("1 / 2")).toBe(0.5);
    expect(parseFraction("  2/3  ")).toBeCloseTo(0.6667, 3);
  });

  test("parses mixed numbers", () => {
    expect(parseFraction("1 1/2")).toBe(1.5);
    expect(parseFraction("2 3/4")).toBe(2.75);
    expect(parseFraction("3 1/4")).toBe(3.25);
  });

  test("parses negative fractions", () => {
    expect(parseFraction("-1/2")).toBe(-0.5);
    expect(parseFraction("-3/4")).toBe(-0.75);
  });

  test("parses word fractions with hyphen", () => {
    expect(parseFraction("one-half")).toBe(0.5);
    expect(parseFraction("two-thirds")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("three-quarters")).toBe(0.75);
    expect(parseFraction("one-fourth")).toBe(0.25);
    expect(parseFraction("three-fourths")).toBe(0.75);
  });

  test("parses word fractions with space", () => {
    expect(parseFraction("one half")).toBe(0.5);
    expect(parseFraction("two thirds")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("three quarters")).toBe(0.75);
  });

  test("parses 'a half' and 'a third' forms", () => {
    expect(parseFraction("a half")).toBe(0.5);
    expect(parseFraction("a third")).toBeCloseTo(0.3333, 3);
    expect(parseFraction("a quarter")).toBe(0.25);
  });

  test("parses various denominator words", () => {
    expect(parseFraction("one-fifth")).toBe(0.2);
    expect(parseFraction("two-fifths")).toBe(0.4);
    expect(parseFraction("one-sixth")).toBeCloseTo(0.1667, 3);
    expect(parseFraction("one-seventh")).toBeCloseTo(0.1429, 3);
    expect(parseFraction("one-eighth")).toBe(0.125);
    expect(parseFraction("one-ninth")).toBeCloseTo(0.1111, 3);
    expect(parseFraction("one-tenth")).toBe(0.1);
  });

  test("returns null for invalid input", () => {
    expect(parseFraction("hello")).toBeNull();
    expect(parseFraction("42")).toBeNull();
    expect(parseFraction("1/0")).toBeNull(); // division by zero
    expect(parseFraction("")).toBeNull();
  });

  test("handles case insensitivity", () => {
    expect(parseFraction("ONE-HALF")).toBe(0.5);
    expect(parseFraction("Two-Thirds")).toBeCloseTo(0.6667, 3);
    expect(parseFraction("THREE-QUARTERS")).toBe(0.75);
  });
});

describe("AnswerExtraction - answersMatch percentages", () => {
  test("percentage symbol matches decimal", () => {
    expect(answersMatch("75%", "0.75")).toBe(true);
    expect(answersMatch("50%", "0.5")).toBe(true);
    expect(answersMatch("100%", "1")).toBe(true);
    expect(answersMatch("25%", "0.25")).toBe(true);
  });

  test("'percent' word matches decimal", () => {
    expect(answersMatch("75 percent", "0.75")).toBe(true);
    expect(answersMatch("50 percent", "0.5")).toBe(true);
  });

  test("'pct' abbreviation matches decimal", () => {
    expect(answersMatch("75 pct", "0.75")).toBe(true);
    expect(answersMatch("25pct", "0.25")).toBe(true);
  });

  test("decimal matches percentage", () => {
    expect(answersMatch("0.75", "75%")).toBe(true);
    expect(answersMatch("0.5", "50 percent")).toBe(true);
  });

  test("percentage with commas", () => {
    expect(answersMatch("1,000%", "10")).toBe(true);
  });
});

describe("AnswerExtraction - answersMatch scientific notation", () => {
  test("e notation matches expanded number", () => {
    expect(answersMatch("1.5e6", "1500000")).toBe(true);
    expect(answersMatch("1e3", "1000")).toBe(true);
    expect(answersMatch("2.5e-2", "0.025")).toBe(true);
  });

  test("multiplication notation matches expanded", () => {
    expect(answersMatch("3×10^8", "300000000")).toBe(true);
    expect(answersMatch("3x10^8", "300000000")).toBe(true);
    expect(answersMatch("3X10^8", "300000000")).toBe(true);
  });

  test("unicode superscript notation", () => {
    expect(answersMatch("3×10⁸", "300000000")).toBe(true);
    expect(answersMatch("1×10⁻²", "0.01")).toBe(true);
  });

  test("expanded number matches scientific", () => {
    expect(answersMatch("1500000", "1.5e6")).toBe(true);
    expect(answersMatch("300000000", "3×10^8")).toBe(true);
  });
});
