/**
 * Enhanced Prompt Compression - CPC-style sentence-level compression with:
 * - TF-IDF relevance scoring
 * - NCD (Normalized Compression Distance) for query relevance
 * - Coreference constraint enforcement
 * - Causal chain preservation
 * - Filler/meta-cognition removal
 * - Repetition detection
 *
 * Research basis:
 * - CPC: "Prompt Compression with Context-Aware Sentence Encoding" (arXiv:2409.01227)
 * - CompactPrompt (2025): N-gram abbreviation
 * - Selective Context (2023): Entropy-based pruning
 * - Information Bottleneck methods: Preserve task-relevant info
 */

import { gzipSync } from "node:zlib";

// ============================================================================
// Types
// ============================================================================

export interface CompressionResult {
  compressed: string;
  original_tokens: number;
  compressed_tokens: number;
  ratio: number;
  kept_sentences: number;
  dropped_sentences: string[];
  /** Enhancement metrics (only present when enhanced features used) */
  enhancements?: {
    fillers_removed: number;
    coref_constraints_applied: number;
    causal_constraints_applied: number;
    repetitions_penalized: number;
    ncd_boost_applied: boolean;
  };
}

export interface CompressionOptions {
  /** Target compression ratio 0.1-1.0, default 0.5 (keep 50%). If undefined, will be auto-tuned based on context. */
  target_ratio?: number;
  /** Minimum sentences to keep, default 1 */
  min_sentences?: number;
  /** Boost logical connectives, default true */
  boost_reasoning?: boolean;
  /** Use NCD for query relevance scoring (default: true) */
  useNCD?: boolean;
  /** Enforce coreference constraints - keep antecedents for pronouns (default: true) */
  enforceCoref?: boolean;
  /** Enforce causal chain constraints - keep premises for conclusions (default: true) */
  enforceCausalChains?: boolean;
  /** Remove filler phrases before scoring (default: true) */
  removeFillers?: boolean;
  /** Jaccard threshold for repetition detection (default: 0.8) */
  repeatThreshold?: number;
  /** Enable adaptive target_ratio based on context entropy/length (default: true) */
  adaptiveCompression?: boolean;
}

interface SentenceMetadata {
  index: number;
  original: string;
  cleaned: string;
  score: number;
  ncdScore: number;
  startsWithPronoun: boolean;
  hasCausalConnective: boolean;
  repeatSimilarity: number;
  requiredBy: number | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  target_ratio: 0.5,
  min_sentences: 1,
  boost_reasoning: true,
  useNCD: true,
  enforceCoref: true,
  enforceCausalChains: true,
  removeFillers: true,
  repeatThreshold: 0.8,
  adaptiveCompression: true,
};

// Filler phrases to remove (research-backed)
const FILLER_PATTERNS = [
  // Meta-cognition starters
  /^(let's see|let me (think|check|see)|i think that|i believe that|okay so|well,?)\s*/gi,
  // Inline fillers
  /\b(basically|literally|actually|you know|i mean)\b/gi,
  // Hedging (keep for nuance in some cases, lighter penalty)
  /\b(really|very|quite|rather|somewhat)\b/gi,
];

// Full meta-sentences to remove entirely
const META_SENTENCE_PATTERNS = [
  /^(let me think about this|hmm+|okay|alright|so)[.!?]?$/i,
  /^(that's a good question|interesting question)[.!?]?$/i,
];

// Pronoun starters that indicate coreference dependency
const PRONOUN_START = /^(he|she|it|they|this|that|these|those|such)\b/i;

// Causal connectives that indicate dependency on previous sentence
const CAUSAL_CONNECTIVES = /^(therefore|thus|hence|consequently|as a result|so,|accordingly)/i;

// Contrastive connectives
const CONTRASTIVE_CONNECTIVES = /^(however|but|although|yet|nevertheless|on the other hand)/i;

// Reasoning keywords to boost (from Self-Correction Bench research)
const REASONING_KEYWORDS =
  /\b(therefore|because|thus|hence|consequently|result|conclude|implies|means|since|given|if|then|however|but|although|wait)\b/i;

// High-value sentence starters
const VALUE_STARTERS =
  /^(the key|importantly|note that|crucially|specifically|in summary|to summarize|finally|first|second|third)/i;

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

// ============================================================================
// ADAPTIVE COMPRESSION - Auto-tune target_ratio based on context
// ============================================================================

/**
 * Calculate optimal compression ratio based on context characteristics
 *
 * Uses entropy and context length to determine how aggressively to compress:
 * - High entropy (dense content) → conservative compression (keep more)
 * - Low entropy (redundant) → aggressive compression (keep less)
 * - Long text → more aggressive (more redundancy expected)
 * - Short text → conservative (preserve detail)
 *
 * @param context - Text to analyze
 * @param query - Query for relevance analysis
 * @returns Optimal target_ratio (0.1-0.9)
 */
export function calculateAdaptiveRatio(context: string, query: string): number {
  const tokens = estimateTokens(context);
  const entropy = calculateEntropy(context);

  // Base ratio depends on entropy
  // Low entropy (3.5-4.5) → aggressive compression (0.3-0.5)
  // Medium entropy (4.5-5.5) → moderate compression (0.5-0.7)
  // High entropy (5.5+) → conservative compression (0.7-0.9)
  let baseRatio: number;

  if (entropy < 4.0) {
    // Very redundant content
    baseRatio = 0.35;
  } else if (entropy < 4.5) {
    // Redundant content (typical verbose explanations)
    baseRatio = 0.45;
  } else if (entropy < 5.0) {
    // Moderate redundancy (normal reasoning chains)
    baseRatio = 0.55;
  } else if (entropy < 5.5) {
    // Low redundancy (technical content)
    baseRatio = 0.65;
  } else if (entropy < 6.0) {
    // Dense content (code, math)
    baseRatio = 0.75;
  } else {
    // Very dense or near-random (already compressed)
    baseRatio = 0.85;
  }

  // Adjust based on length
  // Longer texts can be compressed more aggressively (more likely to have redundancy)
  if (tokens > 1000) {
    baseRatio *= 0.85; // 15% more aggressive
  } else if (tokens > 500) {
    baseRatio *= 0.9; // 10% more aggressive
  } else if (tokens < 150) {
    baseRatio *= 1.1; // 10% more conservative (preserve detail)
  }

  // Query relevance adjustment
  // If query is very short or empty, be more conservative (less signal for relevance)
  if (query.length < 20) {
    baseRatio *= 1.05; // 5% more conservative
  }

  // Clamp to reasonable range [0.25, 0.90]
  return Math.max(0.25, Math.min(0.9, baseRatio));
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Split text into sentences
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Simple tokenizer for Jaccard similarity
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Tokenize text for term comparison (filters stop words)
 */
function tokenizeForTfIdf(text: string): string[] {
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

/**
 * Calculate TF-IDF-like relevance score for a sentence
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
  const queryTerms = tokenizeForTfIdf(query);
  const sentenceTerms = tokenizeForTfIdf(sentence);
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
 * Remove filler phrases from text
 */
function cleanFillers(sentence: string): { cleaned: string; removedCount: number } {
  let cleaned = sentence;
  let removedCount = 0;

  for (const pattern of FILLER_PATTERNS) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, " ");
    if (cleaned !== before) removedCount++;
  }

  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return { cleaned, removedCount };
}

/**
 * Check if sentence is pure meta-cognition (should be removed entirely)
 */
function isMetaSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  return META_SENTENCE_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Compute Normalized Compression Distance between two strings
 * NCD(x,y) = (C(xy) - min(C(x), C(y))) / max(C(x), C(y))
 *
 * Lower NCD = more similar (0 = identical, 1 = unrelated)
 *
 * @param a - First string
 * @param b - Second string
 * @param cachedCa - Optional pre-computed gzip size for string a (optimization)
 * @param cachedCb - Optional pre-computed gzip size for string b (optimization)
 */
export function computeNCD(a: string, b: string, cachedCa?: number, cachedCb?: number): number {
  if (a.length === 0 || b.length === 0) return 1;

  try {
    const Ca = cachedCa ?? gzipSync(Buffer.from(a)).length;
    const Cb = cachedCb ?? gzipSync(Buffer.from(b)).length;
    const Cab = gzipSync(Buffer.from(`${a} ${b}`)).length;

    const ncd = (Cab - Math.min(Ca, Cb)) / Math.max(Ca, Cb);
    return Math.min(1, Math.max(0, ncd)); // Clamp to [0, 1]
  } catch {
    return 0.5; // Default on error
  }
}

/**
 * Compute Jaccard similarity between two token sets
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;

  return intersection / union;
}

/**
 * Compress context by keeping sentences most relevant to the query
 *
 * Features:
 * - TF-IDF relevance scoring
 * - NCD (gzip-based) query similarity
 * - Coreference constraint enforcement
 * - Causal chain preservation
 * - Filler/meta-cognition removal
 * - Repetition detection
 */
export function compress(
  context: string,
  query: string,
  options: CompressionOptions = {},
): CompressionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Apply adaptive compression if enabled and no explicit target_ratio provided
  let targetRatio = opts.target_ratio;
  if (opts.adaptiveCompression && options.target_ratio === undefined) {
    targetRatio = calculateAdaptiveRatio(context, query);
  }

  const rawSentences = splitSentences(context);

  // Early exit for short text
  if (rawSentences.length <= opts.min_sentences) {
    return createShortTextResult(context, rawSentences.length);
  }

  // Phase 1: Pre-processing - Build metadata
  const { metadata, fillersRemoved, repetitionsPenalized } = buildSentenceMetadata(
    rawSentences,
    query,
    opts,
  );

  // Phase 2: Compute scores
  computeSentenceScores(metadata, query, opts);

  // Phase 3: Select sentences
  const keepCount = Math.max(opts.min_sentences, Math.ceil(rawSentences.length * targetRatio));
  const selected = selectTopSentences(metadata, keepCount);

  // Phase 4: Enforce constraints
  const constraints = enforceConstraints(metadata, selected, opts);

  // Reconstruct in original order
  const kept = rawSentences.filter((_, i) => selected.has(i));
  const dropped = rawSentences.filter((_, i) => !selected.has(i));
  const compressed = kept.join(" ");

  return {
    compressed,
    original_tokens: estimateTokens(context),
    compressed_tokens: estimateTokens(compressed),
    ratio: compressed.length / Math.max(context.length, 1),
    kept_sentences: kept.length,
    dropped_sentences: dropped,
    enhancements: {
      fillers_removed: fillersRemoved,
      coref_constraints_applied: constraints.coref,
      causal_constraints_applied: constraints.causal,
      repetitions_penalized: repetitionsPenalized,
      ncd_boost_applied: opts.useNCD,
    },
  };
}

/** Create result for text too short to compress */
function createShortTextResult(context: string, sentenceCount: number): CompressionResult {
  return {
    compressed: context,
    original_tokens: estimateTokens(context),
    compressed_tokens: estimateTokens(context),
    ratio: 1.0,
    kept_sentences: sentenceCount,
    dropped_sentences: [],
    enhancements: {
      fillers_removed: 0,
      coref_constraints_applied: 0,
      causal_constraints_applied: 0,
      repetitions_penalized: 0,
      ncd_boost_applied: false,
    },
  };
}

/** Build metadata for all sentences */
function buildSentenceMetadata(
  rawSentences: string[],
  query: string,
  opts: Required<CompressionOptions>,
): { metadata: SentenceMetadata[]; fillersRemoved: number; repetitionsPenalized: number } {
  let fillersRemoved = 0;
  let repetitionsPenalized = 0;

  // Pre-compute query's gzip size once (optimization: avoids redundant compression)
  let cachedQueryGzipSize: number | undefined;
  if (opts.useNCD && query.length > 0) {
    try {
      cachedQueryGzipSize = gzipSync(Buffer.from(query)).length;
    } catch {
      // Fallback: let computeNCD handle it
    }
  }

  const metadata: SentenceMetadata[] = rawSentences.map((sentence, index) => {
    if (opts.removeFillers && isMetaSentence(sentence)) {
      fillersRemoved++;
      return {
        index,
        original: sentence,
        cleaned: "",
        score: -1000,
        ncdScore: 1,
        startsWithPronoun: false,
        hasCausalConnective: false,
        repeatSimilarity: 0,
        requiredBy: null,
      };
    }

    const { cleaned, removedCount } = opts.removeFillers
      ? cleanFillers(sentence)
      : { cleaned: sentence, removedCount: 0 };
    fillersRemoved += removedCount;

    // Use cached query gzip size for NCD computation
    const ncdScore = opts.useNCD ? computeNCD(cleaned, query, undefined, cachedQueryGzipSize) : 0.5;
    const startsWithPronoun = PRONOUN_START.test(cleaned);
    const hasCausalConnective =
      CAUSAL_CONNECTIVES.test(cleaned) || CONTRASTIVE_CONNECTIVES.test(cleaned);

    return {
      index,
      original: sentence,
      cleaned,
      score: 0,
      ncdScore,
      startsWithPronoun,
      hasCausalConnective,
      repeatSimilarity: 0,
      requiredBy: null,
    };
  });

  // Compute repetition similarity and mark dependencies
  for (let i = 1; i < metadata.length; i++) {
    const current = metadata[i];
    const previous = metadata[i - 1];
    if (current && previous) {
      const sim = jaccardSimilarity(current.cleaned, previous.cleaned);
      current.repeatSimilarity = sim;
      if (sim > opts.repeatThreshold) repetitionsPenalized++;
      if (current.startsWithPronoun) previous.requiredBy = i;
      if (current.hasCausalConnective) previous.requiredBy = i;
    }
  }

  return { metadata, fillersRemoved, repetitionsPenalized };
}

/** Compute relevance scores for sentences */
function computeSentenceScores(
  metadata: SentenceMetadata[],
  query: string,
  opts: Required<CompressionOptions>,
): void {
  const totalSentences = metadata.filter((m) => m.cleaned.length > 0).length;

  for (const m of metadata) {
    if (m.cleaned.length === 0) continue;

    let score = relevanceScore(m.cleaned, query, m.index, totalSentences, opts.boost_reasoning);
    if (opts.useNCD) score += (1 - m.ncdScore) * 0.5;
    if (m.repeatSimilarity > opts.repeatThreshold) score *= 0.3;
    if (m.requiredBy !== null) score *= 1.2;
    m.score = score;
  }
}

/** Select top sentences by score */
function selectTopSentences(metadata: SentenceMetadata[], keepCount: number): Set<number> {
  const validMetadata = metadata.filter((m) => m.cleaned.length > 0);
  const sorted = [...validMetadata].sort((a, b) => b.score - a.score);
  return new Set(sorted.slice(0, keepCount).map((m) => m.index));
}

/** Enforce coreference and causal chain constraints */
function enforceConstraints(
  metadata: SentenceMetadata[],
  selected: Set<number>,
  opts: Required<CompressionOptions>,
): { coref: number; causal: number } {
  let corefConstraints = 0;
  let causalConstraints = 0;

  if (!opts.enforceCoref && !opts.enforceCausalChains) {
    return { coref: 0, causal: 0 };
  }

  let changed = true;
  let iterations = 0;
  const maxIterations = 10;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const m of metadata) {
      if (!selected.has(m.index)) continue;

      if (opts.enforceCoref && m.startsWithPronoun && m.index > 0 && !selected.has(m.index - 1)) {
        selected.add(m.index - 1);
        corefConstraints++;
        changed = true;
      }

      if (
        opts.enforceCausalChains &&
        m.hasCausalConnective &&
        m.index > 0 &&
        !selected.has(m.index - 1)
      ) {
        selected.add(m.index - 1);
        causalConstraints++;
        changed = true;
      }
    }
  }

  return { coref: corefConstraints, causal: causalConstraints };
}

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
    const queryTerms = tokenizeForTfIdf(query);
    const textTerms = new Set(tokenizeForTfIdf(text));
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

// ============================================================================
// Utility Exports
// ============================================================================

export { cleanFillers, isMetaSentence };
