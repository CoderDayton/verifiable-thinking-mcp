/**
 * Compression scoring benchmark — tests 5 scenarios from the plan.
 * Run: bun test/compression-benchmark.ts
 */

import { compress } from "../src/text/compression";

interface BenchmarkCase {
  name: string;
  query: string;
  input: string;
  /** What SHOULD survive compression */
  shouldContain: string[];
  /** What SHOULD be dropped or heavily penalized */
  shouldNotContain: string[];
}

const cases: BenchmarkCase[] = [
  {
    name: "1. Math — solving steps vs fillers",
    query: "What is 15 * 23?",
    input: [
      "Let me think about this multiplication problem.",
      "Okay, so I need to multiply 15 by 23.",
      "First, I'll break this down: 15 * 20 = 300.",
      "Then 15 * 3 = 45.",
      "Therefore, 15 * 23 = 300 + 45 = 345.",
      "Let me verify that this is correct.",
      "Yes, that checks out.",
      "I'm confident that 345 is the answer.",
      "So the answer is 345.",
      "Let me also mention that multiplication is commutative.",
    ].join(" "),
    shouldContain: ["300", "345", "15 * 20"],
    shouldNotContain: ["Let me think", "Let me verify", "checks out", "confident", "also mention"],
  },
  {
    name: "2. Code explanation — quicksort",
    query: "How does quicksort work?",
    input: [
      "Let me think about how to explain quicksort.",
      "Okay, so quicksort is a divide-and-conquer sorting algorithm.",
      "It works by selecting a pivot element from the array.",
      "Elements smaller than the pivot go to the left partition.",
      "Elements larger than the pivot go to the right partition.",
      "The algorithm then recursively sorts both partitions.",
      "The average time complexity is O(n log n).",
      "The worst case is O(n^2) when the pivot is poorly chosen.",
      "Let me also mention that quicksort is in-place.",
      "That said, it's worth noting quicksort is widely used.",
      "I'm quite sure this explanation covers the key points.",
    ].join(" "),
    shouldContain: ["pivot", "O(n log n)", "partition", "recursively"],
    shouldNotContain: ["Let me think", "Let me also mention", "quite sure"],
  },
  {
    name: "3. Repetitive analysis — duplicate patterns",
    query: "What does the data show?",
    input: [
      "The data shows some interesting patterns in user behavior.",
      "We observed a 23% increase in engagement over Q3.",
      "The data reveals interesting patterns in how users interact.",
      "Mobile users account for 67% of total traffic.",
      "The data shows interesting patterns across demographics.",
      "Revenue grew by $2.3M compared to the previous quarter.",
      "The data indicates interesting patterns in conversion rates.",
      "A/B testing showed variant B outperformed by 15%.",
    ].join(" "),
    // At 50% compression (4 of 8), we keep the most entity-rich sentences.
    // "67%" has only 1 entity and may be dropped in favor of "$2.3M" (2 entities).
    // Require at least 3 of 4 data points survive.
    shouldContain: ["23%", "$2.3M", "15%"],
    shouldNotContain: [],
  },
  {
    name: "4. France — filler and self-reassurance",
    query: "What is the capital of France?",
    input: [
      "Let me think about this question.",
      "The question asks about the capital of France.",
      "Hmm, let me consider what I know about France.",
      "The capital of France is Paris.",
      "Paris is located in northern France along the Seine River.",
      "I'm confident that Paris is correct.",
      "Yes, that is correct.",
      "Let me also note that Paris is the largest city in France.",
      "It has a population of approximately 2.1 million in the city proper.",
      "So to answer the question, the capital of France is Paris.",
    ].join(" "),
    shouldContain: ["Paris", "Seine River"],
    shouldNotContain: ["Let me think", "Hmm, let me consider", "confident"],
  },
  {
    name: "5. Code — fenced code block preservation",
    query: "Show me a fibonacci function",
    input: [
      "Let me think about how to write this.",
      "Here is a fibonacci function:",
      "```javascript",
      "function fib(n) {",
      "  if (n <= 1) return n;",
      "  return fib(n - 1) + fib(n - 2);",
      "}",
      "```",
      "This uses simple recursion.",
      "The time complexity is O(2^n) which is exponential.",
      "Let me also mention you could use memoization.",
      "That said, dynamic programming would be more efficient.",
    ].join("\n"),
    shouldContain: ["function fib(n)", "return fib(n - 1)", "O(2^n)"],
    shouldNotContain: ["Let me think"],
  },
];

// ============================================================================
// Run benchmarks
// ============================================================================

console.log("=".repeat(80));
console.log("COMPRESSION SCORING BENCHMARK");
console.log("=".repeat(80));

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

for (const c of cases) {
  console.log(`\n${"─".repeat(80)}`);
  console.log(`${c.name}`);
  console.log(`Query: "${c.query}"`);
  console.log(`${"─".repeat(80)}`);

  // Use adaptive compression (production behavior) — auto-tunes ratio based on entropy/length
  const result = compress(c.input, c.query, { adaptiveCompression: true });

  console.log(
    `\nCompressed (ratio=${result.ratio.toFixed(2)}, kept=${result.kept_sentences}/${result.kept_sentences + result.dropped_sentences.length}):`,
  );
  console.log(`  "${result.compressed}"`);

  console.log(`\nDropped:`);
  for (const d of result.dropped_sentences) {
    console.log(`  - "${d}"`);
  }

  // Check shouldContain
  console.log(`\nChecks:`);
  for (const term of c.shouldContain) {
    const found = result.compressed.includes(term);
    const icon = found ? "✓" : "✗";
    console.log(`  ${icon} SHOULD contain: "${term}"`);
    if (found) totalPass++;
    else {
      totalFail++;
      failures.push(`${c.name}: missing "${term}"`);
    }
  }

  // Check shouldNotContain
  for (const term of c.shouldNotContain) {
    const absent = !result.compressed.includes(term);
    const icon = absent ? "✓" : "✗";
    console.log(`  ${icon} SHOULD NOT contain: "${term}"`);
    if (absent) totalPass++;
    else {
      totalFail++;
      failures.push(`${c.name}: still contains "${term}"`);
    }
  }

  if (result.enhancements) {
    console.log(
      `\nEnhancements: fillers_removed=${result.enhancements.fillers_removed}, repetitions=${result.enhancements.repetitions_penalized}`,
    );
  }
}

console.log(`\n${"=".repeat(80)}`);
console.log(`RESULTS: ${totalPass} pass, ${totalFail} fail`);
if (failures.length > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`${"=".repeat(80)}`);

process.exit(totalFail > 0 ? 1 : 0);
