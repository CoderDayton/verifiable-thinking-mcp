/**
 * Fast Token Estimator — dependency-free, calibrated against o200k_base
 *
 * Avoids tiktoken in compression hot paths. Uses content-type detection
 * and empirically calibrated chars-per-token ratios.
 *
 * Calibration data (o200k_base):
 * - English prose: ~5.2 chars/token
 * - Code (JS/TS/Python): ~3.0 chars/token
 * - Short text (<50 chars): ~2.4 chars/token
 * - URLs: ~4.1 chars/token
 * - Numbers only: ~3.0 chars/token
 * - Mixed content: ~4.0 chars/token
 *
 * Accuracy: ±10% on text >100 chars, ±20% on short text
 * Speed: ~100x faster than tiktoken, sub-μs on cache hits
 */

// ── Cache ──────────────────────────────────────────────────────────────────────
// Size-gated flush cache: faster than LRU (no linked-list pointer updates).
// Compression hot paths re-score the same sentences repeatedly within a job,
// so a simple Map with bulk eviction is optimal.
const MAX_CACHE = 4096;
const estimateCache = new Map<string, number>();

// Content detection patterns
const CODE_INDICATORS = /[{}();[\]=>]|function |const |let |var |import |class |def |return /;
const URL_RE = /https?:\/\/\S+/g;
const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g;

/**
 * Calibrated chars-per-token ratios by content type.
 * Derived from empirical testing against tiktoken o200k_base.
 */
const RATIO = {
  prose: 5.0,
  code: 3.0,
  url: 4.1,
  number: 3.0,
  cjk: 1.5,
  mixed: 3.8,
} as const;

/**
 * Detect the dominant content type of text.
 *
 * Uses symbol density, keyword detection, and character class analysis
 * to classify text. Falls back to "mixed" for ambiguous content.
 */
function detectContentType(text: string): keyof typeof RATIO {
  // Check for code indicators (keyword + bracket density)
  const brackets = text.match(/[{}();]/g);
  if (brackets && brackets.length > text.length * 0.03 && CODE_INDICATORS.test(text)) {
    return "code";
  }

  // Check for CJK dominance
  const cjkMatches = text.match(CJK_RE);
  if (cjkMatches && cjkMatches.length > text.length * 0.3) {
    return "cjk";
  }

  // Check for URL dominance
  const urls = text.match(URL_RE);
  if (urls) {
    const urlChars = urls.reduce((s, u) => s + u.length, 0);
    if (urlChars > text.length * 0.5) return "url";
  }

  // Check for number dominance
  const digitCount = (text.match(/\d/g) ?? []).length;
  if (digitCount > text.length * 0.5) return "number";

  // Check for code (secondary: high symbol density without code keywords)
  const symbolCount = (text.match(/[+\-*/%=<>&|^~@#$\\{}()[\];:]/g) ?? []).length;
  if (symbolCount > text.length * 0.08) return "code";

  // Check if it's mostly alphabetic (prose) vs mixed
  const alphaCount = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (alphaCount > text.length * 0.6) return "prose";

  return "mixed";
}

/**
 * Estimate token count without running a BPE tokenizer.
 *
 * Uses content-type detection to select the appropriate chars-per-token
 * ratio, then applies adjustments for mixed content (URLs, numbers, etc.)
 *
 * @param text - Input text
 * @returns Estimated token count (slight overestimate bias for safety)
 */
export function estimateTokensFast(text: string): number {
  if (!text) return 0;

  const cached = estimateCache.get(text);
  if (cached !== undefined) return cached;

  const contentType = detectContentType(text);
  const baseRatio = RATIO[contentType];

  // Hybrid approach: max of (chars/ratio) and (word-count based estimate).
  // Each whitespace-delimited "word" maps to at least 1 BPE token.
  // Punctuation and operators attached to words may add extra tokens.
  const charEstimate = text.length / baseRatio;

  // Word-count estimate: split on whitespace, each chunk maps to 1+ BPE tokens.
  // Punctuation attached to words (e.g., "hello." → 2 tokens: "hello" + ".") adds tokens.
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordEstimate = words.reduce((sum, word) => {
    // Strip trailing/leading punctuation — those are usually separate tokens
    const stripped = word.replace(/^[^\w]+|[^\w]+$/g, "");
    const punctCount = word.length - stripped.length;
    const len = stripped.length;

    let wordTokens: number;
    if (len === 0) {
      // Pure punctuation chunk
      wordTokens = Math.max(1, punctCount);
    } else if (len <= 5) {
      wordTokens = 1;
    } else if (len <= 10) {
      wordTokens = 1.3;
    } else {
      wordTokens = Math.ceil(len / 5);
    }

    // Punctuation: ~0.7 tokens each (some merge, some don't)
    return sum + wordTokens + punctCount * 0.7;
  }, 0);

  // Blend estimates: weighted average favoring word-count for prose,
  // char-based for code (where symbol density matters more).
  let tokens: number;
  if (contentType === "prose") {
    // Prose: word estimate is more reliable (BPE merges whole words)
    tokens = wordEstimate * 0.65 + charEstimate * 0.35;
  } else if (contentType === "code") {
    // Code: char estimate is more reliable (symbols = 1 token each)
    tokens = wordEstimate * 0.35 + charEstimate * 0.65;
  } else {
    // Default: equal blend
    tokens = (charEstimate + wordEstimate) / 2;
  }

  // Adjust for embedded URLs in non-URL-dominant text
  if (contentType !== "url") {
    const urls = text.match(URL_RE);
    if (urls) {
      const urlChars = urls.reduce((s, u) => s + u.length, 0);
      tokens += urlChars * (1 / RATIO.url - 1 / baseRatio);
    }
  }

  // Adjust for CJK in non-CJK-dominant text
  if (contentType !== "cjk") {
    const cjkMatches = text.match(CJK_RE);
    if (cjkMatches) {
      tokens += cjkMatches.length * (1 / RATIO.cjk - 1 / baseRatio);
    }
  }

  // Safety margin: +3% overestimate to prevent token budget underruns
  tokens *= 1.03;

  const result = Math.max(1, Math.ceil(tokens));

  // Cache result; flush when full (amortized O(1))
  if (estimateCache.size >= MAX_CACHE) estimateCache.clear();
  estimateCache.set(text, result);

  return result;
}

/** Clear the estimate cache (useful for testing or memory pressure). */
export function clearEstimateCache(): void {
  estimateCache.clear();
}

export { detectContentType };
