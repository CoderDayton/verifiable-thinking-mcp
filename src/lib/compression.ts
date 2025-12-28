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
  target_ratio?: number;      // 0.1-1.0, default 0.5 (keep 50%)
  min_sentences?: number;     // Minimum sentences to keep, default 1
  boost_reasoning?: boolean;  // Boost logical connectives, default true
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  target_ratio: 0.5,
  min_sentences: 1,
  boost_reasoning: true,
};

// Reasoning keywords to boost (from Self-Correction Bench research)
const REASONING_KEYWORDS = /\b(therefore|because|thus|hence|consequently|result|conclude|implies|means|since|given|if|then|however|but|although|wait)\b/i;

// High-value sentence starters
const VALUE_STARTERS = /^(the key|importantly|note that|crucially|specifically|in summary|to summarize|finally|first|second|third)/i;

/**
 * Compress context by keeping sentences most relevant to the query
 */
export function compress(
  context: string,
  query: string,
  options: CompressionOptions = {}
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
  const keepCount = Math.max(
    opts.min_sentences,
    Math.ceil(sentences.length * opts.target_ratio)
  );
  
  // Sort by score, keep top N
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const keptIndices = new Set(sorted.slice(0, keepCount).map(s => s.index));
  
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
  boostReasoning: boolean
): number {
  let score = 0;
  
  // 1. Term overlap with query (TF-IDF-like)
  const queryTerms = tokenize(query);
  const sentenceTerms = tokenize(sentence);
  const sentenceTermSet = new Set(sentenceTerms);
  
  for (const term of queryTerms) {
    if (sentenceTermSet.has(term)) {
      // IDF-like: rarer terms in sentence = higher weight
      const termFreq = sentenceTerms.filter(t => t === term).length;
      score += 1 / Math.log(1 + termFreq);
    }
  }
  
  // 2. Position bias (first and last sentences often important)
  const positionScore = position === 0 ? 0.3 
    : position === totalSentences - 1 ? 0.2 
    : 0;
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
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Tokenize text for term comparison
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Estimate token count (rough: ~4 chars per token for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Common stop words to filter out
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
  "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare", "ought",
  "used", "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "what", "which", "who", "whom", "whose", "where", "when",
  "why", "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
  "than", "too", "very", "just", "also", "now", "here", "there", "then",
]);

/**
 * Quick compression for context before adding to prompt
 * Returns compressed text if compression is beneficial, otherwise original
 */
export function quickCompress(
  context: string,
  query: string,
  maxTokens: number = 500
): string {
  const currentTokens = estimateTokens(context);
  
  if (currentTokens <= maxTokens) {
    return context;
  }
  
  const targetRatio = maxTokens / currentTokens;
  const result = compress(context, query, { target_ratio: targetRatio });
  
  return result.compressed;
}
