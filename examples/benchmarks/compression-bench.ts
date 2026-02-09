/**
 * Compression Benchmark Runner
 *
 * Tests CPC-style sentence-level compression across diverse text types:
 * - Compression ratio vs target
 * - Key term retention (query relevance)
 * - Semantic preservation (LLM-judged)
 * - Processing speed
 * - Entropy analysis accuracy
 *
 * Usage:
 *   bun run compression-bench.ts [--corpus=<file>] [--target=0.5] [--judge]
 */

import {
  compress,
  needsCompression,
  calculateEntropy,
  type CompressionAnalysis,
  type CompressionResult,
} from "../../src/text/compression";
import { LLMClient } from "./llm-client";

// ============================================================================
// Types
// ============================================================================

export interface CompressionTestCase {
  id: string;
  category:
    | "technical"
    | "narrative"
    | "code"
    | "conversation"
    | "academic"
    | "mixed"
    | "repetitive"
    | "dense";
  name: string;
  context: string;
  query: string;
  /** Key terms that MUST be preserved after compression */
  required_terms?: string[];
  /** Expected compression behavior */
  expected?: {
    should_compress?: boolean;
    min_ratio?: number;
    max_ratio?: number;
  };
}

export interface CompressionBenchResult {
  test_id: string;
  category: string;
  name: string;

  // Input metrics
  input: {
    length: number;
    tokens: number;
    sentences: number;
    entropy: number;
  };

  // Compression metrics
  compression: {
    output_length: number;
    output_tokens: number;
    kept_sentences: number;
    dropped_sentences: number;
    ratio: number;
    target_ratio: number;
    ratio_error: number; // |actual - target|
    time_ms: number;
  };

  // Quality metrics
  quality: {
    required_terms_kept: number;
    required_terms_total: number;
    term_retention_rate: number;
    entropy_after: number;
    entropy_delta: number;
    /** LLM-judged semantic preservation (0-1) */
    semantic_score?: number;
    /** LLM-judged answer retrievability (0-1) */
    answer_retrievable?: number;
  };

  // Detection accuracy
  detection: {
    should_compress_predicted: boolean;
    should_compress_actual: boolean;
    detection_correct: boolean;
    analysis: CompressionAnalysis;
  };
}

export interface BenchmarkSummary {
  total_tests: number;
  by_category: Record<
    string,
    {
      count: number;
      avg_ratio: number;
      avg_ratio_error: number;
      avg_term_retention: number;
      avg_time_ms: number;
      avg_semantic_score?: number;
      detection_accuracy: number;
    }
  >;
  overall: {
    avg_ratio: number;
    avg_ratio_error: number;
    avg_term_retention: number;
    avg_time_ms: number;
    avg_semantic_score?: number;
    detection_accuracy: number;
    throughput_chars_per_ms: number;
  };
}

// ============================================================================
// Built-in Test Corpus
// ============================================================================

const DEFAULT_CORPUS: CompressionTestCase[] = [
  // Technical documentation
  {
    id: "tech_api_001",
    category: "technical",
    name: "API documentation with code examples",
    context: `The compress function takes a context string and a query string as input. It returns a CompressionResult object containing the compressed text, original token count, compressed token count, compression ratio, and lists of kept and dropped sentences. The function uses TF-IDF-like relevance scoring to rank sentences by their importance to the query. Sentences containing reasoning keywords like "therefore", "because", and "consequently" receive a 1.5x boost. First and last sentences get position bonuses of 0.3 and 0.2 respectively. Very short sentences under 20 characters are penalized with a 0.5x multiplier. Filler phrases at sentence starts are heavily penalized with 0.3x. The target_ratio parameter controls how much text to keep, defaulting to 0.5 (50%). The min_sentences parameter ensures at least one sentence is always kept. The boost_reasoning parameter can be disabled if you don't want reasoning keyword boosting.`,
    query: "How does the compress function score sentences?",
    required_terms: [
      "TF-IDF",
      "relevance",
      "reasoning",
      "boost",
      "position",
      "target_ratio",
    ],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Narrative text
  {
    id: "narrative_001",
    category: "narrative",
    name: "Story with dialogue",
    context: `The old lighthouse keeper climbed the spiral staircase for the thousandth time. His joints ached. The wind howled outside. "Storm's coming," he muttered to himself. He reached the top and checked the great lamp. It flickered uncertainly. "Not tonight," he said firmly, adjusting the wick. The lamp steadied. Below, ships would see his light and know they were safe. That was all that mattered. He'd been doing this for forty years. His father before him. His grandfather before that. Three generations of keepers, guiding sailors home. The storm hit at midnight. Waves crashed against the rocks. The tower shook but stood firm. And the light never wavered.`,
    query: "What is the lighthouse keeper's duty?",
    required_terms: ["lighthouse", "keeper", "light", "sailors", "storm"],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Code documentation
  {
    id: "code_001",
    category: "code",
    name: "Function documentation with examples",
    context: `The calculateEntropy function computes Shannon entropy of text in bits per character. Shannon entropy represents the theoretical lower bound for lossless compression. For English text, typical entropy is around 4.5 bits per character. Random data approaches 8 bits per byte, which is the maximum. The function first counts character frequencies using a Map. Then it calculates entropy using the formula H = -Σ p(x) * log2(p(x)), where p(x) is the probability of each character. Empty strings return 0 entropy. The function is O(n) where n is the text length. Example usage: calculateEntropy("hello") returns approximately 1.92 bits per character. Example usage: calculateEntropy("aaaa") returns 0 bits since there's no uncertainty. This function is useful for predicting compression effectiveness.`,
    query: "How is Shannon entropy calculated?",
    required_terms: ["entropy", "Shannon", "bits", "character", "frequency"],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Conversation/chat
  {
    id: "conversation_001",
    category: "conversation",
    name: "Technical support chat",
    context: `User: Hey, I'm having trouble with the compression function. Agent: Hi! I'd be happy to help. What issue are you experiencing? User: It's not compressing enough. I set target_ratio to 0.3 but I'm getting 0.7. Agent: That can happen if you have too few sentences. The min_sentences parameter ensures at least one sentence is kept. User: Oh, I only have 3 sentences. Agent: That explains it! With 3 sentences and min_sentences=1, the minimum ratio is 0.33. Try using longer input text or reducing min_sentences. User: Makes sense. Thanks! Agent: You're welcome! Let me know if you have other questions.`,
    query: "Why isn't compression reaching the target ratio?",
    required_terms: ["target_ratio", "min_sentences", "sentences"],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Academic/research
  {
    id: "academic_001",
    category: "academic",
    name: "Research paper abstract",
    context: `We present CPC (Context-aware Prompt Compression), a novel approach to reducing prompt length while preserving semantic content. Our method operates at the sentence level, using TF-IDF-inspired relevance scoring combined with position and reasoning keyword boosting. Unlike token-level compression methods, CPC achieves 10x faster processing by avoiding expensive tokenization. We evaluate CPC on three benchmarks: document QA, code generation, and multi-turn dialogue. Results show CPC achieves 50% compression with only 3% accuracy degradation, compared to 12% degradation for baseline methods at the same compression ratio. Furthermore, CPC's sentence-level approach better preserves logical flow and reasoning chains. Our ablation studies demonstrate that reasoning keyword boosting accounts for 40% of the quality improvement over naive truncation. We release our implementation as open source.`,
    query: "What are the key contributions of CPC?",
    required_terms: [
      "CPC",
      "sentence",
      "compression",
      "TF-IDF",
      "reasoning",
      "10x",
    ],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Mixed content
  {
    id: "mixed_001",
    category: "mixed",
    name: "Blog post with code snippets",
    context: `Today we're releasing v2.0 of our compression library! Here's what's new. First, we've added entropy-based compression detection. The needsCompression() function analyzes text to predict if compression would be beneficial. It considers Shannon entropy, character uniqueness, and text length. Second, we've improved relevance scoring. Sentences with reasoning keywords now get appropriate boosting. Third, performance is better than ever. Benchmarks show 50,000 characters per second on average hardware. Here's a quick example: const result = compress(longText, "my query", { target_ratio: 0.5 }). The result object contains compressed text and helpful metrics. Try it out and let us know what you think! We're on GitHub and Discord.`,
    query: "What's new in version 2.0?",
    required_terms: [
      "entropy",
      "needsCompression",
      "reasoning",
      "performance",
      "compress",
    ],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Highly repetitive (good for compression)
  {
    id: "repetitive_001",
    category: "repetitive",
    name: "Repetitive log-style text",
    context: `Processing item 1 of 100. Processing complete. Processing item 2 of 100. Processing complete. Processing item 3 of 100. Processing complete. Processing item 4 of 100. Processing complete. Processing item 5 of 100. Error encountered: timeout. Retrying item 5. Processing item 5 of 100. Processing complete. Processing item 6 of 100. Processing complete. Summary: 6 items processed, 1 retry, 0 failures. Total time: 12.5 seconds. Average time per item: 2.08 seconds.`,
    query: "What was the processing summary?",
    required_terms: ["Summary", "processed", "retry", "failures", "time"],
    expected: { should_compress: true, min_ratio: 0.2, max_ratio: 0.5 },
  },

  // Dense/information-rich (harder to compress)
  {
    id: "dense_001",
    category: "dense",
    name: "Dense technical specifications",
    context: `Specifications: CPU i9-13900K 5.8GHz 24-core, RAM 128GB DDR5-5600, GPU RTX 4090 24GB GDDR6X, Storage 4TB NVMe Gen5, PSU 1200W 80+ Platinum, Cooling 360mm AIO, Case Full Tower ATX. Benchmarks: Cinebench R23 multi 38,000, single 2,200. 3DMark TimeSpy 28,500. PCMark 10 extended 12,800. Power consumption: idle 85W, load 650W. Thermals: CPU 78°C, GPU 72°C under load. Noise: 32dBA idle, 45dBA load.`,
    query: "What are the CPU and GPU specs?",
    required_terms: ["i9-13900K", "RTX 4090", "24GB", "5.8GHz"],
    expected: { should_compress: false, min_ratio: 0.7, max_ratio: 1.0 },
  },

  // Short text (should not compress)
  {
    id: "short_001",
    category: "dense",
    name: "Short factual text",
    context: `The compress function returns a CompressionResult. It includes the compressed text and metrics.`,
    query: "What does compress return?",
    required_terms: ["CompressionResult", "compressed", "metrics"],
    expected: { should_compress: false },
  },

  // Math/reasoning heavy
  {
    id: "reasoning_001",
    category: "technical",
    name: "Mathematical reasoning",
    context: `To solve this problem, we first need to understand the constraints. We have n items and a budget of B. Each item has a value v_i and cost c_i. We want to maximize total value while staying within budget. This is the classic 0/1 knapsack problem. Therefore, we can use dynamic programming. Let dp[i][j] represent the maximum value using items 1..i with budget j. The recurrence is: dp[i][j] = max(dp[i-1][j], dp[i-1][j-c_i] + v_i) if c_i <= j, otherwise dp[i][j] = dp[i-1][j]. Because we only need the previous row, we can optimize space to O(B). The time complexity is O(nB). Consequently, for n=1000 and B=10000, this runs in about 10 million operations.`,
    query: "How do we solve the knapsack problem?",
    required_terms: [
      "knapsack",
      "dynamic programming",
      "dp",
      "recurrence",
      "O(nB)",
    ],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Long technical document
  {
    id: "long_tech_001",
    category: "technical",
    name: "Extended API documentation",
    context: `The compression module provides several functions for reducing text size while preserving meaning. The main function is compress(), which takes context, query, and optional configuration. Configuration options include target_ratio (default 0.5), min_sentences (default 1), and boost_reasoning (default true). The target_ratio controls how much text to keep as a fraction from 0.1 to 1.0. Setting it to 0.3 means keeping approximately 30% of the original text. The min_sentences parameter ensures coherent output by always keeping at least the specified number of sentences. The boost_reasoning parameter enables a 1.5x score multiplier for sentences containing logical connectives like "therefore", "because", "thus", "hence", and "consequently". This is important because reasoning chains are often critical for understanding. The quickCompress() function is a convenience wrapper that compresses to a target token count instead of a ratio. It automatically calculates the needed ratio based on current and target token counts. The needsCompression() function analyzes text to predict if compression would be beneficial. It returns a CompressionAnalysis object with shouldCompress, entropy, uniquenessRatio, estimatedRatio, tokens, and reasons. Low entropy (below 4.0) indicates high redundancy and good compression potential. High entropy (above 6.5) indicates dense content that won't compress well. The calculateEntropy() function computes Shannon entropy directly if you need just that metric. All functions are designed to be fast, with O(n) complexity where n is the text length. Typical throughput is 50,000+ characters per second.`,
    query:
      "What configuration options are available and what do they control?",
    required_terms: [
      "target_ratio",
      "min_sentences",
      "boost_reasoning",
      "0.5",
      "1.5x",
    ],
    expected: { should_compress: true, min_ratio: 0.4, max_ratio: 0.6 },
  },

  // Edge case: all filler
  {
    id: "filler_001",
    category: "conversation",
    name: "Filler-heavy conversation",
    context: `Um, so basically I was thinking about this. Well, you know how it is. Like, the thing is really important. Actually, I meant to say something else. Okay so the main point is that we need better compression. Basically that's what I wanted to tell you.`,
    query: "What is the main point?",
    required_terms: ["compression", "main point"],
    expected: { should_compress: true, min_ratio: 0.3, max_ratio: 0.5 },
  },
];

// ============================================================================
// Benchmark Runner
// ============================================================================

function countSentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0).length;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function checkTermRetention(
  compressed: string,
  requiredTerms: string[],
): { kept: number; total: number } {
  const lowerCompressed = compressed.toLowerCase();
  let kept = 0;
  for (const term of requiredTerms) {
    if (lowerCompressed.includes(term.toLowerCase())) {
      kept++;
    }
  }
  return { kept, total: requiredTerms.length };
}

async function runSingleTest(
  test: CompressionTestCase,
  targetRatio: number,
  llmClient?: LLMClient,
): Promise<CompressionBenchResult> {
  const startTime = performance.now();

  // Run compression
  const result = compress(test.context, test.query, {
    target_ratio: targetRatio,
    boost_reasoning: true,
  });

  const endTime = performance.now();
  const timeMs = endTime - startTime;

  // Calculate input metrics
  const inputEntropy = calculateEntropy(test.context);
  const inputSentences = countSentences(test.context);

  // Calculate output metrics
  const outputEntropy = calculateEntropy(result.compressed);

  // Check term retention
  const termCheck = test.required_terms
    ? checkTermRetention(result.compressed, test.required_terms)
    : { kept: 0, total: 0 };

  // Run detection
  const analysis = needsCompression(test.context, test.query);
  const actualShouldCompress = test.context.length > 200 && result.ratio < 0.95;

  // LLM-based semantic evaluation (if client provided)
  let semanticScore: number | undefined;
  let answerRetrievable: number | undefined;

  if (llmClient) {
    try {
      const evalPrompt = `You are evaluating compression quality. 

ORIGINAL TEXT:
${test.context}

COMPRESSED TEXT:
${result.compressed}

QUERY: ${test.query}

Rate the following on a scale of 0-10:
1. SEMANTIC_PRESERVATION: How well does the compressed text preserve the key information from the original? (0=completely lost, 10=perfect preservation)
2. ANSWER_RETRIEVABLE: Can the query still be answered from the compressed text? (0=impossible, 10=easily answered)

Respond in exactly this format:
SEMANTIC_PRESERVATION: <number>
ANSWER_RETRIEVABLE: <number>`;

      const evalResponse = await llmClient.ask(evalPrompt);

      const semanticMatch = evalResponse.match(
        /SEMANTIC_PRESERVATION:\s*(\d+)/,
      );
      const answerMatch = evalResponse.match(
        /ANSWER_RETRIEVABLE:\s*(\d+)/,
      );

      if (semanticMatch) semanticScore = Number.parseInt(semanticMatch[1]) / 10;
      if (answerMatch)
        answerRetrievable = Number.parseInt(answerMatch[1]) / 10;
    } catch {
      // LLM evaluation failed, continue without it
    }
  }

  return {
    test_id: test.id,
    category: test.category,
    name: test.name,

    input: {
      length: test.context.length,
      tokens: estimateTokens(test.context),
      sentences: inputSentences,
      entropy: inputEntropy,
    },

    compression: {
      output_length: result.compressed.length,
      output_tokens: result.compressed_tokens,
      kept_sentences: result.kept_sentences,
      dropped_sentences: result.dropped_sentences.length,
      ratio: result.ratio,
      target_ratio: targetRatio,
      ratio_error: Math.abs(result.ratio - targetRatio),
      time_ms: timeMs,
    },

    quality: {
      required_terms_kept: termCheck.kept,
      required_terms_total: termCheck.total,
      term_retention_rate:
        termCheck.total > 0 ? termCheck.kept / termCheck.total : 1,
      entropy_after: outputEntropy,
      entropy_delta: outputEntropy - inputEntropy,
      semantic_score: semanticScore,
      answer_retrievable: answerRetrievable,
    },

    detection: {
      should_compress_predicted: analysis.shouldCompress,
      should_compress_actual: actualShouldCompress,
      detection_correct: analysis.shouldCompress === actualShouldCompress,
      analysis,
    },
  };
}

function computeSummary(results: CompressionBenchResult[]): BenchmarkSummary {
  const byCategory: BenchmarkSummary["by_category"] = {};

  // Group by category
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = {
        count: 0,
        avg_ratio: 0,
        avg_ratio_error: 0,
        avg_term_retention: 0,
        avg_time_ms: 0,
        avg_semantic_score: undefined,
        detection_accuracy: 0,
      };
    }
    const cat = byCategory[r.category];
    cat.count++;
    cat.avg_ratio += r.compression.ratio;
    cat.avg_ratio_error += r.compression.ratio_error;
    cat.avg_term_retention += r.quality.term_retention_rate;
    cat.avg_time_ms += r.compression.time_ms;
    cat.detection_accuracy += r.detection.detection_correct ? 1 : 0;
    if (r.quality.semantic_score !== undefined) {
      cat.avg_semantic_score =
        (cat.avg_semantic_score ?? 0) + r.quality.semantic_score;
    }
  }

  // Compute averages
  for (const cat of Object.values(byCategory)) {
    cat.avg_ratio /= cat.count;
    cat.avg_ratio_error /= cat.count;
    cat.avg_term_retention /= cat.count;
    cat.avg_time_ms /= cat.count;
    cat.detection_accuracy /= cat.count;
    if (cat.avg_semantic_score !== undefined) {
      cat.avg_semantic_score /= cat.count;
    }
  }

  // Overall metrics
  const totalChars = results.reduce((sum, r) => sum + r.input.length, 0);
  const totalTimeMs = results.reduce(
    (sum, r) => sum + r.compression.time_ms,
    0,
  );

  const overall = {
    avg_ratio:
      results.reduce((sum, r) => sum + r.compression.ratio, 0) / results.length,
    avg_ratio_error:
      results.reduce((sum, r) => sum + r.compression.ratio_error, 0) /
      results.length,
    avg_term_retention:
      results.reduce((sum, r) => sum + r.quality.term_retention_rate, 0) /
      results.length,
    avg_time_ms: totalTimeMs / results.length,
    avg_semantic_score: undefined as number | undefined,
    detection_accuracy:
      results.filter((r) => r.detection.detection_correct).length /
      results.length,
    throughput_chars_per_ms: totalChars / totalTimeMs,
  };

  const semanticResults = results.filter(
    (r) => r.quality.semantic_score !== undefined,
  );
  if (semanticResults.length > 0) {
    overall.avg_semantic_score =
      semanticResults.reduce((sum, r) => sum + (r.quality.semantic_score ?? 0), 0) /
      semanticResults.length;
  }

  return {
    total_tests: results.length,
    by_category: byCategory,
    overall,
  };
}

function printResults(
  results: CompressionBenchResult[],
  summary: BenchmarkSummary,
): void {
  console.log("\n" + "=".repeat(70));
  console.log("COMPRESSION BENCHMARK RESULTS");
  console.log("=".repeat(70));

  console.log(`\nTotal tests: ${summary.total_tests}`);
  console.log(`Target ratio: 0.5 (50%)\n`);

  // Per-test results
  console.log("─".repeat(70));
  console.log("INDIVIDUAL RESULTS");
  console.log("─".repeat(70));

  for (const r of results) {
    const ratioStr = `${(r.compression.ratio * 100).toFixed(1)}%`;
    const errorStr =
      r.compression.ratio_error < 0.1
        ? "✓"
        : `±${(r.compression.ratio_error * 100).toFixed(1)}%`;
    const termStr =
      r.quality.required_terms_total > 0
        ? `${r.quality.required_terms_kept}/${r.quality.required_terms_total}`
        : "n/a";
    const detectStr = r.detection.detection_correct ? "✓" : "✗";
    const semanticStr =
      r.quality.semantic_score !== undefined
        ? (r.quality.semantic_score * 10).toFixed(1)
        : "-";

    console.log(
      `  ${r.test_id.padEnd(20)} | ratio=${ratioStr.padStart(6)} ${errorStr.padStart(5)} | terms=${termStr.padStart(5)} | detect=${detectStr} | semantic=${semanticStr} | ${r.compression.time_ms.toFixed(2)}ms`,
    );
  }

  // By category
  console.log("\n" + "─".repeat(70));
  console.log("BY CATEGORY");
  console.log("─".repeat(70));

  for (const [category, stats] of Object.entries(summary.by_category)) {
    const semanticStr =
      stats.avg_semantic_score !== undefined
        ? (stats.avg_semantic_score * 10).toFixed(1)
        : "-";
    console.log(
      `  ${category.padEnd(15)} | n=${String(stats.count).padStart(2)} | ratio=${(stats.avg_ratio * 100).toFixed(1)}% | error=${(stats.avg_ratio_error * 100).toFixed(1)}% | terms=${(stats.avg_term_retention * 100).toFixed(0)}% | detect=${(stats.detection_accuracy * 100).toFixed(0)}% | semantic=${semanticStr}`,
    );
  }

  // Overall summary
  console.log("\n" + "─".repeat(70));
  console.log("OVERALL SUMMARY");
  console.log("─".repeat(70));

  console.log(
    `  Average compression ratio:    ${(summary.overall.avg_ratio * 100).toFixed(1)}%`,
  );
  console.log(
    `  Average ratio error:          ${(summary.overall.avg_ratio_error * 100).toFixed(1)}%`,
  );
  console.log(
    `  Term retention rate:          ${(summary.overall.avg_term_retention * 100).toFixed(1)}%`,
  );
  console.log(
    `  Detection accuracy:           ${(summary.overall.detection_accuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `  Average time per test:        ${summary.overall.avg_time_ms.toFixed(2)}ms`,
  );
  console.log(
    `  Throughput:                   ${summary.overall.throughput_chars_per_ms.toFixed(0)} chars/ms`,
  );

  if (summary.overall.avg_semantic_score !== undefined) {
    console.log(
      `  LLM semantic score:           ${(summary.overall.avg_semantic_score * 10).toFixed(1)}/10`,
    );
  }

  console.log("\n" + "=".repeat(70));
}

// ============================================================================
// Comparison Mode - Run both baseline and enhanced compression
// ============================================================================

interface ComparisonResult {
  test_id: string;
  category: string;
  baseline: {
    ratio: number;
    term_retention: number;
    time_ms: number;
  };
  enhanced: {
    ratio: number;
    term_retention: number;
    time_ms: number;
    enhancements: NonNullable<CompressionResult["enhancements"]>;
  };
  improvement: {
    ratio_delta: number;
    term_retention_delta: number;
    time_overhead_ms: number;
  };
}

async function runComparison(
  test: CompressionTestCase,
  targetRatio: number,
): Promise<ComparisonResult> {
  // Run baseline (without NCD, coref, causal, fillers)
  const baselineStart = performance.now();
  const baselineResult = compress(test.context, test.query, {
    target_ratio: targetRatio,
    boost_reasoning: true,
    useNCD: false,
    enforceCoref: false,
    enforceCausalChains: false,
    removeFillers: false,
  });
  const baselineTime = performance.now() - baselineStart;

  // Run enhanced (full features)
  const enhancedStart = performance.now();
  const enhancedResult = compress(test.context, test.query, {
    target_ratio: targetRatio,
    boost_reasoning: true,
    useNCD: true,
    enforceCoref: true,
    enforceCausalChains: true,
    removeFillers: true,
  });
  const enhancedTime = performance.now() - enhancedStart;

  // Check term retention
  const baselineTerms = test.required_terms
    ? checkTermRetention(baselineResult.compressed, test.required_terms)
    : { kept: 0, total: 0 };
  const enhancedTerms = test.required_terms
    ? checkTermRetention(enhancedResult.compressed, test.required_terms)
    : { kept: 0, total: 0 };

  const baselineRetention = baselineTerms.total > 0 ? baselineTerms.kept / baselineTerms.total : 1;
  const enhancedRetention = enhancedTerms.total > 0 ? enhancedTerms.kept / enhancedTerms.total : 1;

  return {
    test_id: test.id,
    category: test.category,
    baseline: {
      ratio: baselineResult.ratio,
      term_retention: baselineRetention,
      time_ms: baselineTime,
    },
    enhanced: {
      ratio: enhancedResult.ratio,
      term_retention: enhancedRetention,
      time_ms: enhancedTime,
      enhancements: enhancedResult.enhancements!,
    },
    improvement: {
      ratio_delta: baselineResult.ratio - enhancedResult.ratio, // Positive = better compression
      term_retention_delta: enhancedRetention - baselineRetention, // Positive = better retention
      time_overhead_ms: enhancedTime - baselineTime,
    },
  };
}

function printComparisonResults(results: ComparisonResult[]): void {
  console.log("\n" + "=".repeat(70));
  console.log("COMPRESSION COMPARISON: BASELINE vs ENHANCED");
  console.log("=".repeat(70));

  console.log("\n─".repeat(70));
  console.log("INDIVIDUAL RESULTS");
  console.log("─".repeat(70));

  for (const r of results) {
    const baseRatio = (r.baseline.ratio * 100).toFixed(1);
    const enhRatio = (r.enhanced.ratio * 100).toFixed(1);
    const baseTerm = (r.baseline.term_retention * 100).toFixed(0);
    const enhTerm = (r.enhanced.term_retention * 100).toFixed(0);
    const deltaRatio = r.improvement.ratio_delta > 0 ? "↓" : r.improvement.ratio_delta < 0 ? "↑" : "=";
    const deltaTerm = r.improvement.term_retention_delta > 0 ? "↑" : r.improvement.term_retention_delta < 0 ? "↓" : "=";

    console.log(
      `  ${r.test_id.padEnd(20)} | base=${baseRatio.padStart(5)}% → enh=${enhRatio.padStart(5)}% ${deltaRatio} | terms=${baseTerm.padStart(3)}% → ${enhTerm.padStart(3)}% ${deltaTerm} | +${r.improvement.time_overhead_ms.toFixed(1)}ms`,
    );

    // Show enhancement breakdown if any
    const enh = r.enhanced.enhancements;
    if (enh.fillers_removed > 0 || enh.coref_constraints_applied > 0 || enh.causal_constraints_applied > 0) {
      const parts: string[] = [];
      if (enh.fillers_removed > 0) parts.push(`fillers=${enh.fillers_removed}`);
      if (enh.coref_constraints_applied > 0) parts.push(`coref=${enh.coref_constraints_applied}`);
      if (enh.causal_constraints_applied > 0) parts.push(`causal=${enh.causal_constraints_applied}`);
      if (enh.repetitions_penalized > 0) parts.push(`repeat=${enh.repetitions_penalized}`);
      console.log(`    └─ enhancements: ${parts.join(", ")}`);
    }
  }

  // Summary statistics
  console.log("\n─".repeat(70));
  console.log("SUMMARY");
  console.log("─".repeat(70));

  const avgBaseRatio = results.reduce((sum, r) => sum + r.baseline.ratio, 0) / results.length;
  const avgEnhRatio = results.reduce((sum, r) => sum + r.enhanced.ratio, 0) / results.length;
  const avgBaseTerm = results.reduce((sum, r) => sum + r.baseline.term_retention, 0) / results.length;
  const avgEnhTerm = results.reduce((sum, r) => sum + r.enhanced.term_retention, 0) / results.length;
  const avgBaseTime = results.reduce((sum, r) => sum + r.baseline.time_ms, 0) / results.length;
  const avgEnhTime = results.reduce((sum, r) => sum + r.enhanced.time_ms, 0) / results.length;

  console.log(`  Compression ratio:   ${(avgBaseRatio * 100).toFixed(1)}% → ${(avgEnhRatio * 100).toFixed(1)}% (${((avgBaseRatio - avgEnhRatio) * 100).toFixed(1)}% better)`);
  console.log(`  Term retention:      ${(avgBaseTerm * 100).toFixed(1)}% → ${(avgEnhTerm * 100).toFixed(1)}% (${((avgEnhTerm - avgBaseTerm) * 100).toFixed(1)}% better)`);
  console.log(`  Avg time:            ${avgBaseTime.toFixed(2)}ms → ${avgEnhTime.toFixed(2)}ms (+${(avgEnhTime - avgBaseTime).toFixed(2)}ms overhead)`);

  // Count wins
  const ratioWins = results.filter((r) => r.improvement.ratio_delta > 0.01).length;
  const termWins = results.filter((r) => r.improvement.term_retention_delta > 0).length;
  console.log(`\n  Ratio improvement:   ${ratioWins}/${results.length} tests (enhanced was better)`);
  console.log(`  Term retention wins: ${termWins}/${results.length} tests (enhanced kept more terms)`);

  console.log("\n" + "=".repeat(70));
}

// ============================================================================
// CLI
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  let targetRatio = 0.5;
  let useJudge = false;
  let corpusFile: string | undefined;
  let compareMode = false;

  for (const arg of args) {
    if (arg.startsWith("--target=")) {
      targetRatio = Number.parseFloat(arg.split("=")[1]);
    } else if (arg === "--judge") {
      useJudge = true;
    } else if (arg.startsWith("--corpus=")) {
      corpusFile = arg.split("=")[1];
    } else if (arg === "--compare") {
      compareMode = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Compression Benchmark Runner

Usage:
  bun run compression-bench.ts [options]

Options:
  --target=<ratio>   Target compression ratio (default: 0.5)
  --judge            Use LLM to judge semantic preservation
  --corpus=<file>    Load custom corpus from JSON file
  --compare          Compare baseline vs enhanced compression
  --help             Show this help

Examples:
  bun run compression-bench.ts --target=0.3 --judge
  bun run compression-bench.ts --compare
`);
      process.exit(0);
    }
  }

  console.log("Compression Benchmark");
  console.log("=".repeat(40));
  console.log(`Target ratio: ${targetRatio}`);
  console.log(`Mode: ${compareMode ? "comparison (baseline vs enhanced)" : "baseline only"}`);
  console.log(`LLM judge: ${useJudge ? "enabled" : "disabled"}`);

  // Load corpus
  let corpus: CompressionTestCase[] = DEFAULT_CORPUS;
  if (corpusFile) {
    const file = Bun.file(corpusFile);
    const customCorpus = await file.json();
    corpus = customCorpus.tests ?? customCorpus;
    console.log(`Loaded ${corpus.length} tests from ${corpusFile}`);
  } else {
    console.log(`Using built-in corpus (${corpus.length} tests)`);
  }

  // Comparison mode
  if (compareMode) {
    console.log("\nRunning comparison...\n");
    const compResults: ComparisonResult[] = [];

    for (let i = 0; i < corpus.length; i++) {
      const test = corpus[i];
      process.stdout.write(`[${i + 1}/${corpus.length}] ${test.id}...`);
      const result = await runComparison(test, targetRatio);
      compResults.push(result);
      console.log(" done");
    }

    printComparisonResults(compResults);

    const timestamp = Date.now();
    const outputFile = `compression-comparison-${timestamp}.json`;
    await Bun.write(outputFile, JSON.stringify({ results: compResults }, null, 2));
    console.log(`\nResults saved to ${outputFile}`);
    process.exit(0);
  }

  // Standard mode (baseline only)
  let llmClient: LLMClient | undefined;
  if (useJudge) {
    llmClient = new LLMClient({
      model: process.env.LLM_MODEL ?? "devstral-small-2505",
      apiKey: process.env.LLM_API_KEY ?? "",
      baseUrl:
        process.env.LLM_BASE_URL ?? "https://codestral.us.gaianet.network/v1",
    });
    console.log(`LLM judge: ${process.env.LLM_MODEL ?? "devstral-small-2505"}`);
  }

  console.log("\nRunning tests...\n");
  const results: CompressionBenchResult[] = [];

  for (let i = 0; i < corpus.length; i++) {
    const test = corpus[i];
    process.stdout.write(`[${i + 1}/${corpus.length}] ${test.id}...`);

    const result = await runSingleTest(test, targetRatio, llmClient);
    results.push(result);

    const status = result.detection.detection_correct ? "✓" : "✗";
    console.log(
      ` ${status} ratio=${(result.compression.ratio * 100).toFixed(1)}% time=${result.compression.time_ms.toFixed(2)}ms`,
    );
  }

  // Compute and print summary
  const summary = computeSummary(results);
  printResults(results, summary);

  // Save results
  const timestamp = Date.now();
  const outputFile = `compression-results-${timestamp}.json`;
  await Bun.write(outputFile, JSON.stringify({ results, summary }, null, 2));
  console.log(`\nResults saved to ${outputFile}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
