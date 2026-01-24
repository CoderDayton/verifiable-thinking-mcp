import { z } from "zod";
import { type CompressionResult, compress, quickCompress } from "../lib/compression.ts";
import { calculateTokenUsage } from "../lib/tokens.ts";

/**
 * Standalone compress tool - Enhanced CPC-style context compression
 * Features: TF-IDF, NCD relevance, coreference/causal constraints, filler removal
 */
export const compressTool = {
  name: "compress",
  description: `CPC-style sentence-level compression. TF-IDF + NCD scoring, coreference/causal chains, filler removal. 10× faster than token-level. Keeps query-relevant sentences.`,

  parameters: z.object({
    context: z.string().max(1_000_000, "Max 1MB").describe("Text to compress"),
    query: z.string().max(10_000, "Max 10KB").describe("Focus query"),
    target_ratio: z.number().min(0.1).max(1.0).default(0.5).describe("Target ratio (0.5=50%)"),
    max_tokens: z.number().int().min(50).optional().describe("Max tokens (alternative to ratio)"),
    boost_reasoning: z.boolean().default(true).describe("Boost reasoning keywords"),
    use_ncd: z.boolean().default(true).describe("Use NCD (gzip) scoring"),
    enforce_coref: z.boolean().default(true).describe("Keep pronoun antecedents"),
    enforce_causal: z.boolean().default(true).describe("Keep causal premises"),
    remove_fillers: z.boolean().default(true).describe("Remove filler phrases"),
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
    let result: CompressionResult;

    // Use max_tokens mode if specified
    if (args.max_tokens) {
      const compressed = quickCompress(args.context, args.query, args.max_tokens);
      const originalTokens = Math.ceil(args.context.length / 4);
      const compressedTokens = Math.ceil(compressed.length / 4);

      result = {
        compressed,
        original_tokens: originalTokens,
        compressed_tokens: compressedTokens,
        ratio: compressed.length / args.context.length,
        kept_sentences: compressed.split(/(?<=[.!?])\s+/).length,
        dropped_sentences: [],
      };
    } else {
      // Standard ratio-based compression with all options
      result = compress(args.context, args.query, {
        target_ratio: args.target_ratio ?? 0.5,
        boost_reasoning: args.boost_reasoning ?? true,
        useNCD: args.use_ncd ?? true,
        enforceCoref: args.enforce_coref ?? true,
        enforceCausalChains: args.enforce_causal ?? true,
        removeFillers: args.remove_fillers ?? true,
      });
    }

    const output = formatCompressResult(result);
    const tokens = calculateTokenUsage(args, output);

    return `${output}\n\n---\n_tokens: ${tokens.input_tokens} in, ${tokens.output_tokens} out, ${tokens.total_tokens} total_`;
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
