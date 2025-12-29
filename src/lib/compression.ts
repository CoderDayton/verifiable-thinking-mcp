/**
 * CPC-style Prompt Compression - Sentence-level compression with relevance scoring
 * Based on: "Prompt Compression with Context-Aware Sentence Encoding" (arXiv:2409.01227)
 *
 * Lightweight implementation without ML model - uses TF-IDF-like heuristics
 * ~10x faster than token-level methods
 */

export interface CompressionResult {
  compressed: string;
  original_tokens: number;
  compressed_tokens: number;
  ratio: number;
  kept_sentences: number;
  dropped_sentences: string[];
}

export interface CompressionOptions {
  target_ratio?: number; // 0.1-1.0, default 0.5 (keep 50%)
  min_sentences?: number; // Minimum sentences to keep, default 1
  boost_reasoning?: boolean; // Boost logical connectives, default true
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  target_ratio: 0.5,
  min_sentences: 1,
  boost_reasoning: true,
};

// Reasoning keywords to boost (from Self-Correction Bench research)
const REASONING_KEYWORDS =
  /\b(therefore|because|thus|hence|consequently|result|conclude|implies|means|since|given|if|then|however|but|although|wait)\b/i;

// High-value sentence starters
const VALUE_STARTERS =
  /^(the key|importantly|note that|crucially|specifically|in summary|to summarize|finally|first|second|third)/i;

/**
 * Compress context by keeping sentences most relevant to the query
 */
export function compress(
  context: string,
  query: string,
  options: CompressionOptions = {},
): CompressionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Split into sentences
  const sentences = splitSentences(context);

  if (sentences.length <= opts.min_sentences) {
    return {
      compressed: context,
      original_tokens: estimateTokens(context),
      compressed_tokens: estimateTokens(context),
      ratio: 1.0,
      kept_sentences: sentences.length,
      dropped_sentences: [],
    };
  }

  // Score each sentence by relevance
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: relevanceScore(sentence, query, index, sentences.length, opts.boost_reasoning),
  }));

  // Determine how many to keep
  const keepCount = Math.max(opts.min_sentences, Math.ceil(sentences.length * opts.target_ratio));

  // Sort by score, keep top N
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const keptIndices = new Set(sorted.slice(0, keepCount).map((s) => s.index));

  // Reconstruct in original order for coherence
  const kept = sentences.filter((_, i) => keptIndices.has(i));
  const dropped = sentences.filter((_, i) => !keptIndices.has(i));
  const compressed = kept.join(" ");

  return {
    compressed,
    original_tokens: estimateTokens(context),
    compressed_tokens: estimateTokens(compressed),
    ratio: compressed.length / Math.max(context.length, 1),
    kept_sentences: kept.length,
    dropped_sentences: dropped,
  };
}

/**
 * Calculate relevance score for a sentence
 */
function relevanceScore(
  sentence: string,
  query: string,
  position: number,
  totalSentences: number,
  boostReasoning: boolean,
): number {
  let score = 0;

  // 1. Term overlap with query (TF-IDF-like)
  const queryTerms = tokenize(query);
  const sentenceTerms = tokenize(sentence);
  const sentenceTermSet = new Set(sentenceTerms);

  for (const term of queryTerms) {
    if (sentenceTermSet.has(term)) {
      // IDF-like: rarer terms in sentence = higher weight
      const termFreq = sentenceTerms.filter((t) => t === term).length;
      score += 1 / Math.log(1 + termFreq);
    }
  }

  // 2. Position bias (first and last sentences often important)
  const positionScore = position === 0 ? 0.3 : position === totalSentences - 1 ? 0.2 : 0;
  score += positionScore;

  // 3. Reasoning keyword boost
  if (boostReasoning && REASONING_KEYWORDS.test(sentence)) {
    score *= 1.5;
  }

  // 4. High-value starter boost
  if (VALUE_STARTERS.test(sentence.trim())) {
    score *= 1.3;
  }

  // 5. Length penalty for very short sentences (likely not informative)
  if (sentence.length < 20) {
    score *= 0.5;
  }

  // 6. Penalty for filler phrases
  if (/^(um|uh|well|so|okay|basically|actually|like)\b/i.test(sentence.trim())) {
    score *= 0.3;
  }

  return score;
}

/**
 * Split text into sentences
 */
function splitSentences(text: string): string[] {
  // Split on sentence boundaries, preserving the delimiter
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Tokenize text for term comparison
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Estimate token count (rough: ~4 chars per token for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Common stop words to filter out
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "been",
  "be",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "where",
  "when",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "here",
  "there",
  "then",
]);

/**
 * Quick compression for context before adding to prompt
 * Returns compressed text if compression is beneficial, otherwise original
 */
export function quickCompress(context: string, query: string, maxTokens: number = 500): string {
  const currentTokens = estimateTokens(context);

  if (currentTokens <= maxTokens) {
    return context;
  }

  const targetRatio = maxTokens / currentTokens;
  const result = compress(context, query, { target_ratio: targetRatio });

  return result.compressed;
}

// ============================================================================
// COMPRESSION DETECTION - Determine if text would benefit from compression
// ============================================================================

export interface CompressionAnalysis {
  /** Whether compression is recommended */
  shouldCompress: boolean;
  /** Shannon entropy in bits per character (0-8 for bytes, ~4.5 typical for English) */
  entropy: number;
  /** Ratio of unique characters to total length (0-1) */
  uniquenessRatio: number;
  /** Estimated compression ratio achievable (0-1, lower = better compression) */
  estimatedRatio: number;
  /** Estimated tokens in text */
  tokens: number;
  /** Reasons for the recommendation */
  reasons: string[];
}

/** Thresholds for compression decision */
const COMPRESSION_THRESHOLDS = {
  /** Minimum tokens before compression is worthwhile */
  MIN_TOKENS: 100,
  /** Entropy below this indicates high redundancy (good for compression) */
  LOW_ENTROPY: 4.0,
  /** Entropy above this indicates low redundancy (compression less effective) */
  HIGH_ENTROPY: 6.5,
  /** Uniqueness ratio below this suggests repetitive content */
  LOW_UNIQUENESS: 0.3,
  /** Minimum estimated savings to recommend compression */
  MIN_SAVINGS: 0.2,
} as const;

/**
 * Calculate Shannon entropy of text (bits per character)
 *
 * Based on Shannon's source coding theorem: entropy represents the theoretical
 * lower bound for lossless compression. English text typically has entropy ~4.5
 * bits/char; random data approaches 8 bits/byte (maximum).
 *
 * @param text - Input text to analyze
 * @returns Entropy in bits per character (0 to ~8)
 */
export function calculateEntropy(text: string): number {
  if (text.length === 0) return 0;

  // Count character frequencies
  const freq = new Map<string, number>();
  for (const char of text) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  // Calculate entropy: H = -Σ p(x) * log2(p(x))
  const len = text.length;
  let entropy = 0;

  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Analyze text to determine if compression would be beneficial
 *
 * Uses multiple heuristics based on information theory research:
 * 1. Shannon entropy - measures information density
 * 2. Uniqueness ratio - character diversity
 * 3. Token count - minimum size for compression overhead to pay off
 * 4. Estimated compression ratio based on entropy
 *
 * @param text - Text to analyze
 * @param query - Optional query for context-aware analysis
 * @returns Analysis with recommendation and metrics
 */
export function needsCompression(text: string, query?: string): CompressionAnalysis {
  const tokens = estimateTokens(text);
  const reasons: string[] = [];

  // Short text: compression overhead not worthwhile
  if (tokens < COMPRESSION_THRESHOLDS.MIN_TOKENS) {
    return {
      shouldCompress: false,
      entropy: 0,
      uniquenessRatio: 1,
      estimatedRatio: 1,
      tokens,
      reasons: [`Text too short (${tokens} tokens < ${COMPRESSION_THRESHOLDS.MIN_TOKENS} minimum)`],
    };
  }

  const entropy = calculateEntropy(text);

  // Uniqueness ratio: unique chars / total length
  const uniqueChars = new Set(text).size;
  const uniquenessRatio = uniqueChars / text.length;

  // Estimate compression ratio based on entropy
  // Theoretical: ratio ≈ entropy / 8 (since 8 bits = 1 byte max)
  // For text compression targeting semantic content, we use a more practical estimate
  // Factor in that our sentence-level compression can achieve ~40-60% on repetitive text
  const theoreticalRatio = entropy / 8;
  const practicalRatio = Math.min(1, theoreticalRatio + 0.2); // Add overhead margin
  const estimatedRatio = practicalRatio;

  // Decision logic
  let shouldCompress = false;

  // High redundancy indicators
  if (entropy < COMPRESSION_THRESHOLDS.LOW_ENTROPY) {
    shouldCompress = true;
    reasons.push(`Low entropy (${entropy.toFixed(2)} bits/char) indicates high redundancy`);
  }

  if (uniquenessRatio < COMPRESSION_THRESHOLDS.LOW_UNIQUENESS) {
    shouldCompress = true;
    reasons.push(
      `Low uniqueness ratio (${(uniquenessRatio * 100).toFixed(1)}%) suggests repetitive content`,
    );
  }

  // Token count consideration
  if (tokens > 500) {
    // Longer text benefits more from compression
    if (entropy < 5.5) {
      shouldCompress = true;
      reasons.push(`Long text (${tokens} tokens) with moderate entropy benefits from compression`);
    }
  }

  // Check estimated savings
  const estimatedSavings = 1 - estimatedRatio;
  if (estimatedSavings < COMPRESSION_THRESHOLDS.MIN_SAVINGS && shouldCompress) {
    // Override if savings too small
    if (tokens < 300) {
      shouldCompress = false;
      reasons.length = 0;
      reasons.push(
        `Estimated savings (${(estimatedSavings * 100).toFixed(1)}%) too small for text size`,
      );
    }
  }

  // High entropy = likely already dense or random
  if (entropy > COMPRESSION_THRESHOLDS.HIGH_ENTROPY) {
    shouldCompress = false;
    reasons.length = 0;
    reasons.push(`High entropy (${entropy.toFixed(2)} bits/char) indicates already-dense content`);
  }

  // Query relevance boost: if query provided, check if compression preserves key terms
  if (query && shouldCompress) {
    const queryTerms = tokenize(query);
    const textTerms = new Set(tokenize(text));
    const overlap = queryTerms.filter((t) => textTerms.has(t)).length;
    const overlapRatio = queryTerms.length > 0 ? overlap / queryTerms.length : 0;

    if (overlapRatio > 0.5) {
      reasons.push(`Query terms well-represented (${(overlapRatio * 100).toFixed(0)}% overlap)`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("No strong compression indicators detected");
  }

  return {
    shouldCompress,
    entropy,
    uniquenessRatio,
    estimatedRatio,
    tokens,
    reasons,
  };
}
