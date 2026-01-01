import { z } from "zod";
import { type CompressionResult, compress, quickCompress } from "../lib/compression.ts";

/**
 * Standalone compress tool - Enhanced CPC-style context compression
 * Features: TF-IDF, NCD relevance, coreference/causal constraints, filler removal
 */
export const compressTool = {
  name: "compress",
  description: `Compress context using enhanced CPC-style sentence-level relevance scoring.

Features:
- TF-IDF + NCD (gzip-based) query relevance scoring
- Coreference constraints (keeps pronoun antecedents)
- Causal chain preservation (keeps premises for "therefore" etc.)
- Filler/meta-cognition removal
- Repetition detection and penalization

Up to 10x faster than token-level compression methods. Keeps sentences most relevant 
to the query while maintaining coherence by preserving original sentence order.

Use this to reduce token costs before sending large contexts to LLMs.`,

  parameters: z.object({
    context: z
      .string()
      .max(1_000_000, "Context exceeds 1MB limit - split into smaller chunks")
      .describe("The text/context to compress"),
    query: z
      .string()
      .max(10_000, "Query exceeds 10KB limit")
      .describe("Focus query - sentences relevant to this are kept"),
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
    use_ncd: z.boolean().default(true).describe("Use NCD (gzip-based) query similarity scoring"),
    enforce_coref: z
      .boolean()
      .default(true)
      .describe("Keep antecedent sentences when pronouns are selected"),
    enforce_causal: z
      .boolean()
      .default(true)
      .describe("Keep premise sentences when causal conclusions are selected"),
    remove_fillers: z
      .boolean()
      .default(true)
      .describe("Remove filler phrases (basically, actually, let me think, etc.)"),
  }),

  execute: async (args: {
    context: string;
    query: string;
    target_ratio?: number;
    max_tokens?: number;
    boost_reasoning?: boolean;
    use_ncd?: boolean;
    enforce_coref?: boolean;
    enforce_causal?: boolean;
    remove_fillers?: boolean;
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

    // Standard ratio-based compression with all options
    const result = compress(args.context, args.query, {
      target_ratio: args.target_ratio ?? 0.5,
      boost_reasoning: args.boost_reasoning ?? true,
      useNCD: args.use_ncd ?? true,
      enforceCoref: args.enforce_coref ?? true,
      enforceCausalChains: args.enforce_causal ?? true,
      removeFillers: args.remove_fillers ?? true,
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
  ];

  // Add enhancement details if present
  if (result.enhancements) {
    const enh = result.enhancements;
    const enhParts: string[] = [];
    if (enh.fillers_removed > 0) enhParts.push(`fillers=${enh.fillers_removed}`);
    if (enh.coref_constraints_applied > 0) enhParts.push(`coref=${enh.coref_constraints_applied}`);
    if (enh.causal_constraints_applied > 0)
      enhParts.push(`causal=${enh.causal_constraints_applied}`);
    if (enh.repetitions_penalized > 0) enhParts.push(`repetitions=${enh.repetitions_penalized}`);
    if (enhParts.length > 0) {
      lines.push(`- Enhancements: ${enhParts.join(", ")}`);
    }
  }

  lines.push(``, `**Compressed Context:**`, result.compressed);

  return lines.join("\n");
}
