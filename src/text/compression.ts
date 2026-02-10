/**
 * Enhanced Prompt Compression - CPC-style sentence-level compression
 *
 * Research basis:
 * - CPC: "Prompt Compression with Context-Aware Sentence Encoding" (arXiv:2409.01227)
 * - CompactPrompt (2025): N-gram abbreviation
 * - Selective Context (2023): Entropy-based pruning
 * - Information Bottleneck methods: Preserve task-relevant info
 */

import { gzipSync } from "node:zlib";
import { estimateTokensFast } from "./tokens-fast.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionResult {
  compressed: string;
  original_tokens: number;
  compressed_tokens: number;
  ratio: number;
  kept_sentences: number;
  dropped_sentences: string[];
  enhancements?: {
    fillers_removed: number;
    coref_constraints_applied: number;
    causal_constraints_applied: number;
    repetitions_penalized: number;
    ncd_boost_applied: boolean;
  };
}

export interface CompressionOptions {
  target_ratio?: number;
  min_sentences?: number;
  boost_reasoning?: boolean;
  useNCD?: boolean;
  enforceCoref?: boolean;
  enforceCausalChains?: boolean;
  removeFillers?: boolean;
  repeatThreshold?: number;
  adaptiveCompression?: boolean;
}

export interface CompressionAnalysis {
  shouldCompress: boolean;
  entropy: number;
  uniquenessRatio: number;
  estimatedRatio: number;
  tokens: number;
  reasons: string[];
}

interface SentenceMetadata {
  index: number;
  original: string;
  cleaned: string;
  score: number;
  ncdScore: number;
  startsWithPronoun: boolean;
  hasDependencyConnective: boolean; // P0: renamed from hasCausalConnective
  repeatSimilarity: number;
  requiredBy: number | null;
  isCodeHeavy: boolean;
  isFiller: boolean;
  fillerTier: 0 | 1 | 2;
  noiseScore: number;
  entities: Set<string> | null; // P3: cached entity set
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  target_ratio: 0.5,
  min_sentences: 1,
  boost_reasoning: true,
  useNCD: true,
  enforceCoref: true,
  enforceCausalChains: true,
  removeFillers: true,
  repeatThreshold: 0.5,
  adaptiveCompression: true,
};

const FILLER_CLEANUP_PATTERNS = [
  /^(let's see|let me (think|check|see)|i think that|i believe that|okay so|well,?)\s*/gi,
  /\b(basically|literally|actually|you know|i mean)\b/gi,
  /\b(really|very|quite|rather|somewhat)\b/gi,
];

const FILLER_TIER1_PATTERNS = [
  /^(let me (think|consider|check|verify|reconsider))\b/i,
  /^hmm+\b/i,
  /\b(yes,? (that|this) (checks out|is correct|works))\b/i,
  /\b(i'?m (quite )?(confident|certain|sure))\b/i,
  /^(the question (is|asks)|so the question)\b/i,
  /^(let me also|i should also)\b/i,
  /\b(i (can|will) (also|now) (mention|note|add))\b/i,
];

const FILLER_TIER2_PATTERNS = [
  /^(okay|ok|well|so|alright|right),?\s/i,
  /^(now|first|next)?,?\s*(i need to|we need to|let's)\b/i,
  /^(that said|having said that|with that in mind)\b/i,
  /^(let me explain|it'?s (also )?worth)\b/i,
];

const META_SENTENCE_PATTERNS = [
  /^(let me think about this|hmm+|okay|alright|so)[.!?]?$/i,
  /^(that's a good question|interesting question)[.!?]?$/i,
];

const PRONOUN_START = /^(he|she|it|they|this|that|these|those|such)\b/i;
const CAUSAL_CONNECTIVES = /^(therefore|thus|hence|consequently|as a result|so,|accordingly)/i;
const CONTRASTIVE_CONNECTIVES = /^(however|but|although|yet|nevertheless|on the other hand)/i;
const REASONING_KEYWORDS =
  /\b(therefore|because|thus|hence|consequently|result|conclude|implies|means|since|given|if|then|however|but|although|wait)\b/i;
const VALUE_STARTERS =
  /^(the key|importantly|note that|crucially|specifically|in summary|to summarize|finally|first|second|third)/i;

// P1: collapsed from 88 lines to 1
const STOP_WORDS = new Set(
  "the a an and or but in on at to for of with by from as is was are were been be have has had do does did will would could should may might must shall can need dare ought used this that these those i you he she it we they what which who whom whose where when why how all each every both few more most other some such no nor not only own same so than too very just also now here there then".split(
    " ",
  ),
);

// P1: collapsed from 32 lines to 1
const ABBREVIATIONS = new Set(
  "dr mr mrs ms prof sr jr st vs etc inc ltd co corp jan feb mar apr jun jul aug sep oct nov dec fig eq ref vol no approx".split(
    " ",
  ),
);

const DOTTED_ABBREV = /^(?:[a-z]\.){2,}$/i;

const COMPRESSION_THRESHOLDS = {
  MIN_TOKENS: 100,
  LOW_ENTROPY: 4.0,
  HIGH_ENTROPY: 6.5,
  LOW_UNIQUENESS: 0.3,
  MIN_SAVINGS: 0.2,
} as const;

const MIN_SCORE_THRESHOLD = 0.05;

// ---------------------------------------------------------------------------
// Text Processing
// ---------------------------------------------------------------------------

const CODE_FENCE = /^(`{3,}|~{3,})(\w*)\n([\s\S]*?)\n\1/gm;

function extractCodeBlocks(text: string): { prose: string; blocks: Map<string, string> } {
  const blocks = new Map<string, string>();
  let i = 0;
  const prose = text.replace(CODE_FENCE, (match) => {
    const key = `\x00CODE${i++}\x00`;
    blocks.set(key, match);
    return key;
  });
  return { prose, blocks };
}

function restoreCodeBlocks(text: string, blocks: Map<string, string>): string {
  let result = text;
  for (const [key, block] of blocks) {
    result = result.replace(key, block);
  }
  return result;
}

function isCodeHeavySentence(sentence: string): boolean {
  let inBacktick = 0;
  const backtickMatches = sentence.match(/`[^`]+`/g);
  if (backtickMatches) {
    for (const m of backtickMatches) inBacktick += m.length;
  }
  if (sentence.length > 0 && inBacktick / sentence.length > 0.4) return true;

  const symbols = sentence.replace(/[a-zA-Z0-9\s]/g, "").length;
  const total = sentence.length;
  if (total > 20 && symbols / total > 0.25) return true;

  return false;
}

export function splitSentences(text: string): string[] {
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (raw.length <= 1) return raw;

  const merged: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const segment = raw[i]!;
    if (merged.length === 0) {
      merged.push(segment);
      continue;
    }

    const prev = merged[merged.length - 1]!;
    const lastWord = prev.replace(/\.$/, "").split(/\s+/).pop()?.toLowerCase() ?? "";
    const endsWithDot = prev.endsWith(".");

    if (endsWithDot && (ABBREVIATIONS.has(lastWord) || DOTTED_ABBREV.test(`${lastWord}.`))) {
      merged[merged.length - 1] = `${prev} ${segment}`;
    } else {
      merged.push(segment);
    }
  }

  return merged;
}

// P3: fused tokenize + tokenizeForTfIdf into one function
function tokenize(text: string, filterStopWords = false): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return filterStopWords ? words.filter((w) => !STOP_WORDS.has(w)) : words;
}

// Keep backward-compatible name as alias
function tokenizeForTfIdf(text: string): string[] {
  return tokenize(text, true);
}

function getFillerTier(sentence: string): 0 | 1 | 2 {
  if (FILLER_TIER1_PATTERNS.some((p) => p.test(sentence))) return 1;
  if (FILLER_TIER2_PATTERNS.some((p) => p.test(sentence))) return 2;
  return 0;
}

// P0: isFillerSentence kept as export, delegates to getFillerTier
function isFillerSentence(sentence: string): boolean {
  return getFillerTier(sentence) > 0;
}

function cleanFillers(sentence: string): { cleaned: string; removedCount: number } {
  let cleaned = sentence;
  let removedCount = 0;

  for (const pattern of FILLER_CLEANUP_PATTERNS) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, " ");
    if (cleaned !== before) removedCount++;
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return { cleaned, removedCount };
}

function isMetaSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  return META_SENTENCE_PATTERNS.some((p) => p.test(trimmed));
}

// ---------------------------------------------------------------------------
// Scoring Pipeline
// ---------------------------------------------------------------------------

function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();
  for (const m of text.matchAll(/[$€£]\d[\d,.]*[KMBTkmbt]?\b/g)) entities.add(m[0]);
  for (const m of text.matchAll(/\d[\d,.]*(?:%|[KMBTkmbt]\b)?/g)) {
    const val = m[0].replace(/\.$/, "");
    if (val.length > 0) entities.add(val);
  }
  for (const m of text.matchAll(/\b[A-Z]\d+\b/g)) entities.add(m[0]);
  for (const m of text.matchAll(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g)) entities.add(m[0]);
  for (const m of text.matchAll(/[a-z]+[A-Z]\w+|\w+_\w+|[A-Z]{2,}\w*/g)) entities.add(m[0]);
  return entities;
}

function addsNewInformation(sentenceEntities: Set<string>, priorEntities: Set<string>): boolean {
  if (sentenceEntities.size === 0) return false;
  for (const e of sentenceEntities) {
    if (!priorEntities.has(e)) return true;
  }
  return false;
}

function rougeLScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const lcs = dp[a.length]![b.length]!;
  const precision = lcs / a.length;
  const recall = lcs / b.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function informationDensity(sentence: string): number {
  const tokens = tokenizeForTfIdf(sentence);
  if (tokens.length === 0) return 0;
  const entities = extractEntities(sentence);
  const uniqueTerms = new Set(tokens).size;
  return (uniqueTerms + entities.size) / tokens.length;
}

export function computeNCD(a: string, b: string, cachedCa?: number, cachedCb?: number): number {
  if (a.length === 0 || b.length === 0) return 1;

  try {
    const Ca = cachedCa ?? gzipSync(Buffer.from(a)).length;
    const Cb = cachedCb ?? gzipSync(Buffer.from(b)).length;
    const Cab = gzipSync(Buffer.from(`${a} ${b}`)).length;

    const ncd = (Cab - Math.min(Ca, Cb)) / Math.max(Ca, Cb);
    return Math.min(1, Math.max(0, ncd));
  } catch {
    return 0.5;
  }
}

export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;

  return intersection / union;
}

function relevanceScore(
  sentence: string,
  query: string,
  position: number,
  totalSentences: number,
  boostReasoning: boolean,
  idfMap?: Map<string, number>,
): number {
  // P2: restructured as multiplicative chain
  const queryTerms = tokenizeForTfIdf(query);
  const sentenceTerms = tokenizeForTfIdf(sentence);
  const sentenceTermSet = new Set(sentenceTerms);

  // Base: TF-IDF overlap
  let base = 0;
  for (const term of queryTerms) {
    if (sentenceTermSet.has(term)) {
      const termFreq = sentenceTerms.filter((t) => t === term).length;
      const tf = Math.log(1 + termFreq);
      const idf = idfMap?.get(term) ?? 1;
      base += tf * idf;
    }
  }

  // Position bias
  const positionBonus = position === 0 ? 0.3 : position === totalSentences - 1 ? 0.2 : 0;
  base += positionBonus;

  // Multiplicative modifiers
  const reasoningMult = boostReasoning && REASONING_KEYWORDS.test(sentence) ? 1.5 : 1;
  const valueMult = VALUE_STARTERS.test(sentence.trim()) ? 1.3 : 1;
  const lengthMult = sentence.length < 20 ? 0.5 : 1;
  // P0: removed duplicate filler penalty (already handled by fillerTier in computeSentenceScores)

  return base * reasoningMult * valueMult * lengthMult;
}

function buildIdfMap(metadata: SentenceMetadata[]): Map<string, number> {
  const docCount = metadata.filter((m) => m.cleaned.length > 0).length;
  if (docCount === 0) return new Map();

  const termDocFreq = new Map<string, number>();
  for (const m of metadata) {
    if (m.cleaned.length === 0) continue;
    const terms = new Set(tokenizeForTfIdf(m.cleaned));
    for (const term of terms) {
      termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);
    }
  }

  const idfMap = new Map<string, number>();
  for (const [term, df] of termDocFreq) {
    idfMap.set(term, Math.log(docCount / df));
  }

  return idfMap;
}

// ---------------------------------------------------------------------------
// Sentence Selection
// ---------------------------------------------------------------------------

// P1: extracted factory for the 3 identical SentenceMetadata object literals
function makeSentenceMetadata(
  index: number,
  sentence: string,
  overrides: Partial<SentenceMetadata>,
): SentenceMetadata {
  return {
    index,
    original: sentence,
    cleaned: sentence,
    score: 0,
    ncdScore: 0.5,
    startsWithPronoun: false,
    hasDependencyConnective: false,
    repeatSimilarity: 0,
    requiredBy: null,
    isCodeHeavy: false,
    isFiller: false,
    fillerTier: 0,
    noiseScore: 0,
    entities: null,
    ...overrides,
  };
}

function buildSentenceMetadata(
  rawSentences: string[],
  query: string,
  opts: Required<CompressionOptions>,
): { metadata: SentenceMetadata[]; fillersRemoved: number; repetitionsPenalized: number } {
  let fillersRemoved = 0;
  let repetitionsPenalized = 0;

  let cachedQueryGzipSize: number | undefined;
  if (opts.useNCD && query.length > 0) {
    cachedQueryGzipSize = gzipSync(Buffer.from(query)).length;
  }

  const sentenceGzipCache = new Map<number, number>();

  const metadata: SentenceMetadata[] = rawSentences.map((sentence, index) => {
    // Auto-keep code-heavy sentences
    if (sentence.includes("\x00CODE") || isCodeHeavySentence(sentence)) {
      return makeSentenceMetadata(index, sentence, {
        score: 1000,
        ncdScore: 0,
        isCodeHeavy: true,
      });
    }

    if (opts.removeFillers && isMetaSentence(sentence)) {
      fillersRemoved++;
      return makeSentenceMetadata(index, sentence, {
        cleaned: "",
        score: -1000,
        ncdScore: 1,
        isFiller: true,
        fillerTier: 1,
        noiseScore: 1,
      });
    }

    const { cleaned, removedCount } = opts.removeFillers
      ? cleanFillers(sentence)
      : { cleaned: sentence, removedCount: 0 };
    fillersRemoved += removedCount;

    let cachedSentenceGzipSize: number | undefined;
    if (opts.useNCD && cleaned.length > 0) {
      cachedSentenceGzipSize = gzipSync(Buffer.from(cleaned)).length;
      sentenceGzipCache.set(index, cachedSentenceGzipSize);
    }

    const ncdScore = opts.useNCD
      ? computeNCD(cleaned, query, cachedSentenceGzipSize, cachedQueryGzipSize)
      : 0.5;
    const startsWithPronoun = PRONOUN_START.test(cleaned);
    const hasDependencyConnective =
      CAUSAL_CONNECTIVES.test(cleaned) || CONTRASTIVE_CONNECTIVES.test(cleaned);
    const fillerTier = getFillerTier(sentence);

    // P3: cache entities on metadata
    const entities = extractEntities(cleaned);

    return makeSentenceMetadata(index, sentence, {
      cleaned,
      score: 0,
      ncdScore,
      startsWithPronoun,
      hasDependencyConnective,
      isCodeHeavy: false,
      isFiller: fillerTier > 0, // P0: inline instead of calling isFillerSentence
      fillerTier,
      entities,
    });
  });

  // Repetition detection with cached entities
  // P3: accumulate prior entities incrementally instead of re-extracting
  const priorEntities = new Set<string>();
  for (let i = 1; i < metadata.length; i++) {
    const current = metadata[i];
    if (!current || current.cleaned.length === 0 || current.isCodeHeavy) {
      // Still accumulate prior entities from earlier sentences
      const prev = metadata[i - 1];
      if (prev?.entities) {
        for (const e of prev.entities) priorEntities.add(e);
      }
      continue;
    }

    // Accumulate entities from sentence i-1
    const prev = metadata[i - 1];
    if (prev?.entities) {
      for (const e of prev.entities) priorEntities.add(e);
    }

    let maxSim = 0;
    for (let j = 0; j < i; j++) {
      const earlier = metadata[j];
      if (!earlier || earlier.cleaned.length === 0) continue;

      const sim = jaccardSimilarity(current.cleaned, earlier.cleaned);
      if (sim > maxSim) maxSim = sim;

      if (sim >= 0.2 && sim < 0.5) {
        const tokensA = tokenize(current.cleaned);
        const tokensB = tokenize(earlier.cleaned);
        const rougeL = rougeLScore(tokensA, tokensB);
        if (rougeL > 0.45) {
          maxSim = Math.max(maxSim, rougeL);
        }
      }
    }

    // P3: use cached entities instead of re-extracting
    const currentEntities = current.entities ?? extractEntities(current.cleaned);
    if (maxSim > 0.25 && !addsNewInformation(currentEntities, priorEntities)) {
      current.repeatSimilarity = Math.max(maxSim, 0.81);
      repetitionsPenalized++;
    } else {
      current.repeatSimilarity = maxSim;
      if (maxSim > opts.repeatThreshold) repetitionsPenalized++;
    }

    // Mark coreference/causal dependencies (adjacent-only)
    const previous = metadata[i - 1];
    if (previous) {
      if (current.startsWithPronoun) previous.requiredBy = i;
      if (current.hasDependencyConnective) previous.requiredBy = i;
    }
  }

  return { metadata, fillersRemoved, repetitionsPenalized };
}

function computeSentenceScores(
  metadata: SentenceMetadata[],
  query: string,
  opts: Required<CompressionOptions>,
): void {
  const totalSentences = metadata.filter((m) => m.cleaned.length > 0).length;
  const idfMap = buildIdfMap(metadata);

  for (const m of metadata) {
    if (m.cleaned.length === 0) continue;
    if (m.isCodeHeavy) continue;

    let score = relevanceScore(
      m.cleaned,
      query,
      m.index,
      totalSentences,
      opts.boost_reasoning,
      idfMap,
    );
    if (opts.useNCD) score += (1 - m.ncdScore) * 0.5;

    if (!m.isFiller) {
      score += 0.15;
      // P3: use cached entities
      const entities = m.entities ?? extractEntities(m.cleaned);
      score += 0.05 * entities.size;
    }

    if (m.fillerTier === 1) score *= 0.01;
    else if (m.fillerTier === 2) score *= 0.2;

    if (m.repeatSimilarity > opts.repeatThreshold) score *= 0.3;

    const density = informationDensity(m.cleaned);
    score *= 0.8 + 0.4 * density;

    if (m.requiredBy !== null) score *= 1.2;
    m.score = score;

    const fillerNoise = m.fillerTier === 1 ? 1.0 : m.fillerTier === 2 ? 0.5 : 0;
    const repNoise = m.repeatSimilarity;
    const densityNoise = 1 - Math.min(1, density);
    m.noiseScore = 0.4 * fillerNoise + 0.3 * repNoise + 0.3 * densityNoise;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function selectTopSentences(metadata: SentenceMetadata[], keepCount: number): Set<number> {
  const valid = metadata.filter((m) => m.cleaned.length > 0 && m.score >= MIN_SCORE_THRESHOLD);

  if (valid.length <= keepCount) {
    return new Set(valid.map((m) => m.index));
  }

  const medianScore = median(valid.map((m) => m.score));
  const medianNoise = median(valid.map((m) => m.noiseScore));

  const p1: SentenceMetadata[] = [];
  const p2: SentenceMetadata[] = [];
  const p3: SentenceMetadata[] = [];
  const p4: SentenceMetadata[] = [];

  for (const m of valid) {
    const highRelevance = m.score >= medianScore;
    const lowNoise = m.noiseScore <= medianNoise;

    if (highRelevance && lowNoise) p1.push(m);
    else if (highRelevance && !lowNoise) p2.push(m);
    else if (!highRelevance && lowNoise) p3.push(m);
    else p4.push(m);
  }

  const selected = new Set<number>();
  for (const bucket of [p1, p2, p3, p4]) {
    bucket.sort((a, b) => b.score - a.score);
    for (const m of bucket) {
      if (selected.size >= keepCount) break;
      selected.add(m.index);
    }
    if (selected.size >= keepCount) break;
  }

  return selected;
}

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
        const prev = metadata[m.index - 1];
        if (prev && prev.score >= MIN_SCORE_THRESHOLD) {
          selected.add(m.index - 1);
          corefConstraints++;
          changed = true;
        }
      }

      if (
        opts.enforceCausalChains &&
        m.hasDependencyConnective &&
        m.index > 0 &&
        !selected.has(m.index - 1)
      ) {
        const prev = metadata[m.index - 1];
        if (prev && prev.score >= MIN_SCORE_THRESHOLD) {
          selected.add(m.index - 1);
          causalConstraints++;
          changed = true;
        }
      }
    }
  }
  // P5: removed console.warn — the limit is a safety bound, not an error

  return { coref: corefConstraints, causal: causalConstraints };
}

// ---------------------------------------------------------------------------
// Telegraphic Compression
// ---------------------------------------------------------------------------

const PHRASE_REPLACEMENTS: [RegExp, string][] = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bfor the purpose of\b/gi, "for"],
  [/\bin the event that\b/gi, "if"],
  [/\bat this point in time\b/gi, "now"],
  [/\bin the process of\b/gi, ""],
  [/\bon a regular basis\b/gi, "regularly"],
  [/\bwith regard to\b/gi, "about"],
  [/\bwith respect to\b/gi, "about"],
  [/\bin relation to\b/gi, "about"],
  [/\bas a result of\b/gi, "from"],
  [/\bin spite of\b/gi, "despite"],
  [/\bregardless of the fact that\b/gi, "although"],
  [/\bthe fact that\b/gi, "that"],
  [/\bit is important to note that\b/gi, ""],
  [/\bit should be noted that\b/gi, ""],
  [/\bit is worth mentioning that\b/gi, ""],
  [/\bneedless to say\b/gi, ""],
  [/\bas a matter of fact\b/gi, ""],
  [/\bmake sure to\b/gi, ""],
  [/\bplease note that\b/gi, ""],
  [/\bkeep in mind that\b/gi, ""],
  [/\bas mentioned (?:earlier|above|before|previously)\b/gi, ""],
  [/\bis able to\b/gi, "can"],
  [/\bare able to\b/gi, "can"],
  [/\bhas the ability to\b/gi, "can"],
  [/\bin the case of\b/gi, "for"],
  [/\bin cases where\b/gi, "when"],
  [/\bat the present time\b/gi, "now"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequent to\b/gi, "after"],
  [/\bin the near future\b/gi, "soon"],
  [/\bin the absence of\b/gi, "without"],
  [/\bin the presence of\b/gi, "with"],
  [/\bwith the exception of\b/gi, "except"],
  [/\bfor the reason that\b/gi, "because"],
  [/\bby means of\b/gi, "by"],
  [/\bin accordance with\b/gi, "per"],
  [/\btake into account\b/gi, "consider"],
  [/\btake into consideration\b/gi, "consider"],
  [/\bmake a decision\b/gi, "decide"],
  [/\bcome to a conclusion\b/gi, "conclude"],
  [/\b(ensure|verify|check|confirm|know|think|believe|assume|expect)\s+that\b/gi, "$1"],
  [/\byou can use\b/gi, "use"],
  [/\byou should use\b/gi, "use"],
  [/\bas well as\b/gi, "and"],
  [/\bin addition to\b/gi, "and"],
  [/\balong with\b/gi, "with"],
  [/\bcan be used to\b/gi, "for"],
  [/\bis used to\b/gi, "for"],
  [/\bthe process of (\w+ing)\b/gi, "$1"],
  [/\bthe ability to\b/gi, "can"],
  [/\bthe need to\b/gi, "must"],
  [/\ba large (?:number|amount|quantity) of\b/gi, "many"],
  [/\ba small (?:number|amount|quantity) of\b/gi, "few"],
  [/\ba (?:number|variety|range) of\b/gi, "several"],
  [/\bin order to be able to\b/gi, "to"],
  [/\bso as to\b/gi, "to"],
  [/\bwill be able to\b/gi, "can"],
  [/\bwould be able to\b/gi, "could"],
];

const TELEGRAPHIC_STRIP_WORDS = new Set([
  "a",
  "an",
  "the",
  "just",
  "really",
  "very",
  "quite",
  "rather",
  "somewhat",
  "simply",
  "basically",
  "actually",
  "literally",
  "definitely",
  "certainly",
  "probably",
  "possibly",
  "maybe",
  "perhaps",
  "essentially",
  "fundamentally",
  "generally",
  "typically",
  "usually",
  "often",
  "sometimes",
  "occasionally",
  "am",
  "is",
  "are",
  "was",
  "were",
  "been",
  "be",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
]);

const REASONING_KEEP = new Set([
  "because",
  "therefore",
  "thus",
  "hence",
  "since",
  "if",
  "then",
  "however",
  "but",
  "although",
  "yet",
  "so",
  "consequently",
  "while",
  "whereas",
  "unless",
  "until",
  "whether",
  "not",
  "no",
  "and",
  "or",
]);

const HEADER_PROTECT = /^#{1,6}\s+.+$/gm;
const LIST_MARKER_PROTECT = /^(\s*)([-*+]|\d+\.)\s+/gm;
const INLINE_CODE_PROTECT = /`[^`]+`/g;
const URL_PROTECT = /https?:\/\/[^\s<>[\]()]+/g;
const PATH_PROTECT = /(?:\/[\w.-]+)+(?:\/[\w.-]*)?/g;
const DATE_PROTECT = [
  /\d{4}-\d{2}-\d{2}/g,
  /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/gi,
];
const VERSION_PROTECT = /v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?/gi;
const MODEL_ID_PROTECT = [
  /\b(?:claude|gpt|gemini|llama|mistral|opus|sonnet|haiku)[-\w.]*\d+[-\w.]*/gi,
  /\b[\w-]+\/[\w-]+\b/g,
];
const NUMBER_UNIT_PROTECT = /\b\d+(?:\.\d+)?\s*(?:ms|s|m|h|d|KB|MB|GB|TB|%|px|em|rem)\b/gi;
const SLASH_TERM_PROTECT = /\b\w+\/\w+\b/g;

function findProtectedPositions(text: string): Set<number> {
  const positions = new Set<number>();

  const addMatches = (pattern: RegExp) => {
    for (const m of text.matchAll(pattern)) {
      if (m.index !== undefined) {
        for (let i = m.index; i < m.index + m[0].length; i++) {
          positions.add(i);
        }
      }
    }
  };

  addMatches(HEADER_PROTECT);
  addMatches(LIST_MARKER_PROTECT);
  addMatches(INLINE_CODE_PROTECT);
  addMatches(URL_PROTECT);
  addMatches(PATH_PROTECT);
  addMatches(VERSION_PROTECT);
  addMatches(NUMBER_UNIT_PROTECT);
  addMatches(SLASH_TERM_PROTECT);
  for (const p of DATE_PROTECT) addMatches(p);
  for (const p of MODEL_ID_PROTECT) addMatches(p);

  return positions;
}

function telegraphicCompress(text: string): string {
  // P3: apply phrase replacements first, then compute protection once
  let result = text;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }

  // Single protection pass on the transformed text
  const protectedPos = findProtectedPositions(result);

  const tokens: { text: string; start: number }[] = [];
  const wordRe = /(\s+|[^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(result)) !== null) {
    tokens.push({ text: match[1]!, start: match.index });
  }

  const compressed: string[] = [];

  for (const tok of tokens) {
    const word = tok.text;

    if (/^\s+$/.test(word)) {
      compressed.push(word);
      continue;
    }

    let isProtected = false;
    for (let i = tok.start; i < tok.start + word.length; i++) {
      if (protectedPos.has(i)) {
        isProtected = true;
        break;
      }
    }
    if (isProtected) {
      compressed.push(word);
      continue;
    }

    if (/^[^\w]+$/.test(word)) {
      compressed.push(word);
      continue;
    }

    const wordMatch = word.match(/^([^\w]*)(\w+)([^\w]*)$/);
    if (!wordMatch) {
      compressed.push(word);
      continue;
    }
    const [, prefix, core, suffix] = wordMatch;
    const lower = core!.toLowerCase();

    if (REASONING_KEEP.has(lower)) {
      compressed.push(word);
      continue;
    }

    if (
      /\d/.test(core!) ||
      /[A-Z][a-z]+[A-Z]/.test(core!) ||
      /_/.test(core!) ||
      /^[A-Z]{2,}/.test(core!)
    ) {
      compressed.push(word);
      continue;
    }

    if (TELEGRAPHIC_STRIP_WORDS.has(lower)) {
      const remaining = (prefix || "") + (suffix || "");
      if (remaining.length > 0) compressed.push(remaining);
      continue;
    }

    compressed.push(word);
  }

  return compressed
    .join("")
    .replace(/ {2,}/g, " ")
    .replace(/ ([,.:;!?])/g, "$1")
    .replace(/^ +| +$/gm, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// P2: lookup table for calculateAdaptiveRatio
const ENTROPY_RATIOS: [number, number][] = [
  [4.0, 0.35],
  [4.5, 0.45],
  [5.0, 0.55],
  [5.5, 0.65],
  [6.0, 0.75],
];
const ENTROPY_RATIO_CEIL = 0.85;

export function calculateAdaptiveRatio(context: string, query: string): number {
  const tokens = estimateTokensFast(context); // P0: inlined estimateTokens
  const entropy = calculateEntropy(context);

  // P2: lookup table replaces if/else chain
  let baseRatio = ENTROPY_RATIO_CEIL;
  for (const [threshold, ratio] of ENTROPY_RATIOS) {
    if (entropy < threshold) {
      baseRatio = ratio;
      break;
    }
  }

  // Length adjustment
  if (tokens > 1000) baseRatio *= 0.85;
  else if (tokens > 500) baseRatio *= 0.9;
  else if (tokens < 150) baseRatio *= 1.1;

  // Query relevance adjustment
  if (query.length < 20) baseRatio *= 1.05;

  return Math.max(0.25, Math.min(0.9, baseRatio));
}

export function calculateEntropy(text: string): number {
  if (text.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const char of text) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  const len = text.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

// P7: tightened compress() to eliminate redundant array iteration
export function compress(
  context: string,
  query: string,
  options: CompressionOptions = {},
): CompressionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let targetRatio = opts.target_ratio;
  if (opts.adaptiveCompression && options.target_ratio === undefined) {
    targetRatio = calculateAdaptiveRatio(context, query);
  }

  const { prose, blocks: codeBlocks } = extractCodeBlocks(context);
  const rawSentences = splitSentences(prose);

  // P1: inlined createShortTextResult (was only called once)
  if (rawSentences.length <= opts.min_sentences) {
    const restored = restoreCodeBlocks(context, codeBlocks);
    const tok = estimateTokensFast(restored); // P0: inlined
    return {
      compressed: restored,
      original_tokens: tok,
      compressed_tokens: tok,
      ratio: 1.0,
      kept_sentences: rawSentences.length,
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

  const { metadata, fillersRemoved, repetitionsPenalized } = buildSentenceMetadata(
    rawSentences,
    query,
    opts,
  );

  computeSentenceScores(metadata, query, opts);

  const keepCount = Math.max(opts.min_sentences, Math.ceil(rawSentences.length * targetRatio));
  const selected = selectTopSentences(metadata, keepCount);
  const constraints = enforceConstraints(metadata, selected, opts);

  // P7: single pass to build kept + dropped
  const kept: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < rawSentences.length; i++) {
    if (selected.has(i)) {
      kept.push(rawSentences[i]!);
    } else {
      dropped.push(rawSentences[i]!);
    }
  }

  const compressedProse = kept
    .map((s) => (s.includes("\x00CODE") ? s : telegraphicCompress(s)))
    .join(" ");

  const compressed = restoreCodeBlocks(compressedProse, codeBlocks);

  return {
    compressed,
    original_tokens: estimateTokensFast(context), // P0: inlined
    compressed_tokens: estimateTokensFast(compressed), // P0: inlined
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

export function quickCompress(context: string, query: string, maxTokens: number = 500): string {
  const currentTokens = estimateTokensFast(context); // P0: inlined

  if (currentTokens <= maxTokens) {
    return context;
  }

  const targetRatio = maxTokens / currentTokens;
  const result = compress(context, query, { target_ratio: targetRatio });
  return result.compressed;
}

export function needsCompression(text: string, query?: string): CompressionAnalysis {
  const tokens = estimateTokensFast(text); // P0: inlined
  const reasons: string[] = [];

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
  const uniqueChars = new Set(text).size;
  const uniquenessRatio = uniqueChars / text.length;

  const theoreticalRatio = entropy / 8;
  const estimatedRatio = Math.min(1, theoreticalRatio + 0.2);

  let shouldCompress = false;

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

  if (tokens > 500) {
    if (entropy < 5.5) {
      shouldCompress = true;
      reasons.push(`Long text (${tokens} tokens) with moderate entropy benefits from compression`);
    }
  }

  const estimatedSavings = 1 - estimatedRatio;
  if (estimatedSavings < COMPRESSION_THRESHOLDS.MIN_SAVINGS && shouldCompress) {
    if (tokens < 300) {
      shouldCompress = false;
      reasons.length = 0;
      reasons.push(
        `Estimated savings (${(estimatedSavings * 100).toFixed(1)}%) too small for text size`,
      );
    }
  }

  if (entropy > COMPRESSION_THRESHOLDS.HIGH_ENTROPY) {
    shouldCompress = false;
    reasons.length = 0;
    reasons.push(`High entropy (${entropy.toFixed(2)} bits/char) indicates already-dense content`);
  }

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

  return { shouldCompress, entropy, uniquenessRatio, estimatedRatio, tokens, reasons };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  cleanFillers,
  extractCodeBlocks,
  extractEntities,
  getFillerTier,
  informationDensity,
  isCodeHeavySentence,
  isFillerSentence,
  isMetaSentence,
  restoreCodeBlocks,
  rougeLScore,
  median,
  telegraphicCompress,
  tokenize,
  tokenizeForTfIdf,
};
