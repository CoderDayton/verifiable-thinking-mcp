/**
 * Priming Latency Benchmark - Tests primeQuestion() performance across input sizes
 *
 * Validates O(n) complexity claim by measuring latency at various question lengths.
 * All operations should complete in <1ms for typical questions.
 *
 * Usage:
 *   bun run priming-latency.ts [--iterations N] [--verbose]
 */

import { primeQuestion } from "../../src/think/spot-check";

// ============================================================================
// CONFIG
// ============================================================================

interface BenchConfig {
  iterations: number;
  verbose: boolean;
  sizes: number[];
}

const DEFAULT_CONFIG: BenchConfig = {
  iterations: 1000,
  verbose: false,
  sizes: [100, 500, 1000, 5000, 10000],
};

// ============================================================================
// TEST QUESTIONS
// ============================================================================

// Base questions that trigger trap detection (will be padded to target length)
const TRAP_QUESTIONS = [
  // Additive system (bat-ball style)
  "A widget and a gadget cost $110 in total. The widget costs $100 more than the gadget. How much does the gadget cost?",
  // Exponential growth (lily pad style)
  "A bacteria colony doubles every hour. It fills a petri dish in 24 hours. How many hours to fill half the dish?",
  // Rate problem
  "If 5 machines take 5 minutes to make 5 widgets, how many minutes would it take 100 machines to make 100 widgets?",
  // Conditional probability
  "In a town, 1% of people have a disease. A test has 99% accuracy. If someone tests positive, what's the probability they have the disease?",
];

// Non-trap question for baseline
const PLAIN_QUESTION = "What is the capital of France? Please explain your reasoning.";

/**
 * Generate a question of approximately target length by padding with filler context
 */
function generateQuestion(baseQuestion: string, targetLength: number): string {
  if (baseQuestion.length >= targetLength) {
    return baseQuestion.slice(0, targetLength);
  }

  // Pad with realistic filler context
  const filler = " Consider this carefully and show your work step by step. Make sure to double-check your answer before providing it.";
  let result = baseQuestion;

  while (result.length < targetLength) {
    result += filler;
  }

  return result.slice(0, targetLength);
}

// ============================================================================
// BENCHMARK RUNNER
// ============================================================================

interface SizeResult {
  size: number;
  iterations: number;
  times_us: number[]; // microseconds
  avg_us: number;
  min_us: number;
  max_us: number;
  p50_us: number;
  p95_us: number;
  p99_us: number;
  detected_traps: number;
}

function runBenchmark(question: string, iterations: number): Omit<SizeResult, "size"> {
  const times: number[] = [];
  let detectedTraps = 0;

  // Warmup (5 iterations)
  for (let i = 0; i < 5; i++) {
    primeQuestion(question);
  }

  // Actual benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = primeQuestion(question);
    const end = performance.now();

    times.push((end - start) * 1000); // Convert ms to μs

    if (result.shouldPrime) {
      detectedTraps++;
    }
  }

  // Sort for percentiles
  times.sort((a, b) => a - b);

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];

  return {
    iterations,
    times_us: times,
    avg_us: avg,
    min_us: times[0],
    max_us: times[times.length - 1],
    p50_us: p50,
    p95_us: p95,
    p99_us: p99,
    detected_traps: detectedTraps,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const iterIdx = args.indexOf("--iterations");
  const iterations = iterIdx >= 0 ? parseInt(args[iterIdx + 1], 10) : DEFAULT_CONFIG.iterations;
  const verbose = args.includes("--verbose") || args.includes("-v");

  console.log("\n🔬 Priming Latency Benchmark");
  console.log("═".repeat(60));
  console.log(`   Iterations per size: ${iterations}`);
  console.log(`   Input sizes: ${DEFAULT_CONFIG.sizes.join(", ")} chars`);
  console.log(`   Test questions: ${TRAP_QUESTIONS.length} trap + 1 plain\n`);

  const results: {
    trap_results: SizeResult[];
    plain_results: SizeResult[];
  } = {
    trap_results: [],
    plain_results: [],
  };

  // Test trap questions at each size
  console.log("📊 Trap Questions (should trigger detection):");
  console.log("-".repeat(60));

  for (const size of DEFAULT_CONFIG.sizes) {
    // Use a different base question for variety
    const baseQuestion = TRAP_QUESTIONS[results.trap_results.length % TRAP_QUESTIONS.length];
    const question = generateQuestion(baseQuestion, size);

    const result = runBenchmark(question, iterations);
    const sizeResult: SizeResult = { size, ...result };
    results.trap_results.push(sizeResult);

    const status = result.avg_us < 1000 ? "✓" : "⚠️";
    console.log(
      `   ${size.toString().padStart(5)} chars: ${status} avg=${result.avg_us.toFixed(1)}μs ` +
        `p50=${result.p50_us.toFixed(1)}μs p95=${result.p95_us.toFixed(1)}μs p99=${result.p99_us.toFixed(1)}μs ` +
        `(${result.detected_traps}/${iterations} detected)`
    );

    if (verbose) {
      console.log(`           min=${result.min_us.toFixed(1)}μs max=${result.max_us.toFixed(1)}μs`);
    }
  }

  // Test plain question at each size
  console.log("\n📊 Plain Questions (should not trigger detection):");
  console.log("-".repeat(60));

  for (const size of DEFAULT_CONFIG.sizes) {
    const question = generateQuestion(PLAIN_QUESTION, size);

    const result = runBenchmark(question, iterations);
    const sizeResult: SizeResult = { size, ...result };
    results.plain_results.push(sizeResult);

    const status = result.avg_us < 1000 ? "✓" : "⚠️";
    console.log(
      `   ${size.toString().padStart(5)} chars: ${status} avg=${result.avg_us.toFixed(1)}μs ` +
        `p50=${result.p50_us.toFixed(1)}μs p95=${result.p95_us.toFixed(1)}μs p99=${result.p99_us.toFixed(1)}μs ` +
        `(${result.detected_traps}/${iterations} detected)`
    );

    if (verbose) {
      console.log(`           min=${result.min_us.toFixed(1)}μs max=${result.max_us.toFixed(1)}μs`);
    }
  }

  // Validate O(n) complexity - latency should scale roughly linearly
  console.log("\n📈 Complexity Analysis:");
  console.log("-".repeat(60));

  const trapAvgs = results.trap_results.map((r) => r.avg_us);
  const sizes = results.trap_results.map((r) => r.size);

  // Calculate scaling factor between first and last size
  const scaleFactor = sizes[sizes.length - 1] / sizes[0]; // e.g., 10000/100 = 100x
  const timeScaleFactor = trapAvgs[trapAvgs.length - 1] / trapAvgs[0];

  const isLinearish = timeScaleFactor < scaleFactor * 1.5; // Allow 50% overhead for O(n)
  const status = isLinearish ? "✓" : "⚠️";

  console.log(`   Size scale:    ${scaleFactor.toFixed(0)}x (${sizes[0]} → ${sizes[sizes.length - 1]})`);
  console.log(`   Time scale:    ${timeScaleFactor.toFixed(1)}x (${trapAvgs[0].toFixed(1)}μs → ${trapAvgs[trapAvgs.length - 1].toFixed(1)}μs)`);
  console.log(`   Complexity:    ${status} ${isLinearish ? "O(n) confirmed" : "Worse than O(n) - investigate!"}`);

  // Validate all under 1ms average
  console.log("\n✅ Assertions:");
  console.log("-".repeat(60));

  let allPassed = true;
  const maxAllowed = 1000; // 1ms = 1000μs

  for (const result of [...results.trap_results, ...results.plain_results]) {
    if (result.avg_us > maxAllowed) {
      console.log(`   ❌ FAIL: ${result.size} chars avg ${result.avg_us.toFixed(1)}μs > ${maxAllowed}μs`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log(`   ✓ All sizes under ${maxAllowed}μs (1ms) average`);
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  if (allPassed && isLinearish) {
    console.log("✅ PASSED - primeQuestion() meets latency requirements");
  } else {
    console.log("❌ FAILED - Performance regression detected");
    process.exit(1);
  }
  console.log("═".repeat(60) + "\n");
}

main().catch(console.error);
