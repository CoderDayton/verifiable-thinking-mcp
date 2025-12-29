import { z } from "zod";
import { type CompressionResult, compress, quickCompress } from "../lib/compression.ts";

/**
 * Standalone compress tool - CPC-style context compression
 * Useful for compressing any context before sending to LLMs
 */
export const compressTool = {
  name: "compress",
  description: `Compress context using CPC-style sentence-level relevance scoring.

Up to 10x faster than token-level compression methods. Keeps sentences most relevant 
to the query while maintaining coherence by preserving original sentence order.

Use this to reduce token costs before sending large contexts to LLMs.`,

  parameters: z.object({
    context: z.string().describe("The text/context to compress"),
    query: z.string().describe("Focus query - sentences relevant to this are kept"),
    target_ratio: z
      .number()
      .min(0.1)
      .max(1.0)
      .default(0.5)
      .describe("Target compression ratio (0.5 = keep ~50%)"),
    max_tokens: z
      .number()
      .int()
      .min(50)
      .optional()
      .describe("Alternative: specify max tokens instead of ratio"),
    boost_reasoning: z
      .boolean()
      .default(true)
      .describe("Boost sentences with reasoning keywords (therefore, because, etc.)"),
  }),

  execute: async (args: {
    context: string;
    query: string;
    target_ratio?: number;
    max_tokens?: number;
    boost_reasoning?: boolean;
  }): Promise<string> => {
    // Use max_tokens mode if specified
    if (args.max_tokens) {
      const compressed = quickCompress(args.context, args.query, args.max_tokens);
      const originalTokens = Math.ceil(args.context.length / 4);
      const compressedTokens = Math.ceil(compressed.length / 4);

      return formatCompressResult({
        compressed,
        original_tokens: originalTokens,
        compressed_tokens: compressedTokens,
        ratio: compressed.length / args.context.length,
        kept_sentences: compressed.split(/(?<=[.!?])\s+/).length,
        dropped_sentences: [],
      });
    }

    // Standard ratio-based compression
    const result = compress(args.context, args.query, {
      target_ratio: args.target_ratio ?? 0.5,
      boost_reasoning: args.boost_reasoning ?? true,
    });

    return formatCompressResult(result);
  },
};

function formatCompressResult(result: CompressionResult): string {
  const savings = Math.round((1 - result.ratio) * 100);

  const lines = [
    `**Compression Results**`,
    `- Tokens: ${result.original_tokens} → ${result.compressed_tokens} (${savings}% reduction)`,
    `- Sentences kept: ${result.kept_sentences}`,
    `- Sentences dropped: ${result.dropped_sentences.length}`,
    ``,
    `**Compressed Context:**`,
    result.compressed,
  ];

  return lines.join("\n");
}
