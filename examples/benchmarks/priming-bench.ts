/**
 * Priming Benchmark - Compares primed vs non-primed LLM responses on trap questions
 *
 * Tests the effectiveness of trap priming by running each question twice:
 * 1. Non-primed: Direct question to LLM
 * 2. Primed: Priming prompt prepended to question
 *
 * Usage:
 *   bun run priming-bench.ts [--limit N] [--verbose] [--model MODEL]
 */

import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
config({ path: resolve(projectRoot, ".env") });

import { LLMClient, type LLMConfig } from "./llm-client";
import { extractAnswer, stripThinkingTags } from "../../src/lib/extraction";
import { primeQuestion } from "../../src/lib/think/spot-check";

// ============================================================================
// TYPES
// ============================================================================

interface TrapQuestion {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  expected_answer: string;
  verification_type: string;
  tolerance?: number;
  trap_type: string;
  intuitive_wrong_answer: string;
}

interface QuestionSet {
  version: string;
  description: string;
  questions: TrapQuestion[];
}

interface PrimingResult {
  question_id: string;
  trap_type: string;
  expected_answer: string;
  intuitive_wrong: string;

  // Non-primed run
  non_primed: {
    answer: string;
    correct: boolean;
    time_ms: number;
    fell_for_trap: boolean;
  };

  // Primed run
  primed: {
    answer: string;
    correct: boolean;
    time_ms: number;
    fell_for_trap: boolean;
    priming_prompt: string | null;
    trap_types_detected: string[];
    trap_types_primed: string[];
    skipped_reason: string | null;
  };
}

interface PrimingSummary {
  timestamp: string;
  model: string;
  total_questions: number;
  results: PrimingResult[];
  summary: {
    non_primed: {
      accuracy: number;
      trap_rate: number;
      avg_time_ms: number;
    };
    primed: {
      accuracy: number;
      trap_rate: number;
      avg_time_ms: number;
    };
    comparison: {
      accuracy_delta: number;
      accuracy_lift_pct: number;
      trap_rate_reduction: number;
      trap_rate_reduction_pct: number;
      questions_fixed: number;
      questions_broken: number;
      net_improvement: number;
    };
    by_trap_type: Record<
      string,
      {
        count: number;
        non_primed_accuracy: number;
        primed_accuracy: number;
        delta: number;
        primed_detected: number;
      }
    >;
  };
}

// ============================================================================
// VERIFICATION
// ============================================================================

function verifyAnswer(question: TrapQuestion, answer: string): boolean {
  const normalized = answer
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/\.$/, "");

  const expected = question.expected_answer.toLowerCase();

  switch (question.verification_type) {
    case "exact":
      return normalized === expected;

    case "contains":
      return normalized.includes(expected);

    case "numeric": {
      const num = parseFloat(answer.replace(/[^0-9.-]/g, ""));
      const tolerance = question.tolerance || 0.001;
      return Math.abs(num - parseFloat(expected)) <= tolerance;
    }

    default:
      return normalized === expected;
  }
}

function fellForTrap(question: TrapQuestion, answer: string): boolean {
  const normalized = answer
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z.-]/g, "");

  const wrongAnswer = question.intuitive_wrong_answer.toLowerCase();

  // Check if answer matches the intuitive wrong answer
  if (question.verification_type === "numeric") {
    const num = parseFloat(normalized);
    const wrongNum = parseFloat(wrongAnswer);
    return Math.abs(num - wrongNum) < 0.5;
  }

  return normalized.includes(wrongAnswer) || wrongAnswer.includes(normalized);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// BENCHMARK RUNNERS
// ============================================================================

async function runNonPrimed(
  llm: LLMClient,
  question: TrapQuestion
): Promise<PrimingResult["non_primed"]> {
  const start = Date.now();

  const system =
    "You are a helpful assistant. Answer questions directly and concisely.";
  const userSuffix =
    "\n\nProvide your answer clearly. If it's a number, state just the number.";
  const prompt = `${question.question}${userSuffix}`;

  const response = await llm.ask(prompt, {
    system,
    temperature: 0.1,
  });

  const cleanResponse = stripThinkingTags(response);
  const answer = extractAnswer(cleanResponse, [question.expected_answer]);

  return {
    answer,
    correct: verifyAnswer(question, answer),
    time_ms: Date.now() - start,
    fell_for_trap: fellForTrap(question, answer),
  };
}

async function runPrimed(
  llm: LLMClient,
  question: TrapQuestion
): Promise<PrimingResult["primed"]> {
  const start = Date.now();

  // Get priming info
  const prime = primeQuestion(question.question);

  const system =
    "You are a helpful assistant. Answer questions directly and concisely.";
  const userSuffix =
    "\n\nProvide your answer clearly. If it's a number, state just the number.";

  // Prepend priming prompt if detected
  let prompt: string;
  if (prime.shouldPrime && prime.primingPrompt) {
    prompt = `${prime.primingPrompt}\n\n${question.question}${userSuffix}`;
  } else {
    prompt = `${question.question}${userSuffix}`;
  }

  const response = await llm.ask(prompt, {
    system,
    temperature: 0.1,
  });

  const cleanResponse = stripThinkingTags(response);
  const answer = extractAnswer(cleanResponse, [question.expected_answer]);

  return {
    answer,
    correct: verifyAnswer(question, answer),
    time_ms: Date.now() - start,
    fell_for_trap: fellForTrap(question, answer),
    priming_prompt: prime.primingPrompt,
    trap_types_detected: prime.trapTypes,
    trap_types_primed: prime.primedTypes,
    skipped_reason: prime.skippedReason,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const verbose = args.includes("--verbose") || args.includes("-v");
  const modelIdx = args.indexOf("--model");
  const modelOverride = modelIdx >= 0 ? args[modelIdx + 1] : undefined;

  // Load questions
  const questionsPath = resolve(__dirname, "questions-traps.json");
  const questionsFile = Bun.file(questionsPath);
  if (!(await questionsFile.exists())) {
    console.error("❌ questions-traps.json not found");
    process.exit(1);
  }
  const questionSet = (await questionsFile.json()) as QuestionSet;
  let questions = questionSet.questions as TrapQuestion[];

  if (limit) {
    questions = questions.slice(0, limit);
  }

  console.log(`\n🧪 Priming Benchmark`);
  console.log(`   Questions: ${questions.length} trap questions`);
  console.log(`   Comparing: non-primed vs primed LLM responses\n`);

  // Setup LLM client
  const llmConfig: LLMConfig = {
    model: modelOverride || process.env.LLM_MODEL || "gpt-4o-mini",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.LLM_API_KEY || "",
    timeout: 60000,
    maxTokens: 1024,
  };

  if (!llmConfig.apiKey) {
    console.error("❌ LLM_API_KEY not set in environment");
    process.exit(1);
  }

  const llm = new LLMClient(llmConfig);
  console.log(`   Model: ${llmConfig.model}\n`);

  // Run benchmark
  const results: PrimingResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(
      `\r[${i + 1}/${questions.length}] ${q.id} (${q.trap_type})...`
    );

    // Run non-primed first
    const nonPrimed = await runNonPrimed(llm, q);

    // Small delay to avoid rate limiting
    await Bun.sleep(100);

    // Run primed
    const primed = await runPrimed(llm, q);

    const result: PrimingResult = {
      question_id: q.id,
      trap_type: q.trap_type,
      expected_answer: q.expected_answer,
      intuitive_wrong: q.intuitive_wrong_answer,
      non_primed: nonPrimed,
      primed,
    };

    results.push(result);

    if (verbose) {
      const npStatus = nonPrimed.correct
        ? "✓"
        : nonPrimed.fell_for_trap
          ? "✗(trap)"
          : "✗";
      const pStatus = primed.correct
        ? "✓"
        : primed.fell_for_trap
          ? "✗(trap)"
          : "✗";
      console.log(
        `\n   Non-primed: ${npStatus} "${nonPrimed.answer}" | Primed: ${pStatus} "${primed.answer}"`
      );
      if (primed.priming_prompt) {
        console.log(`   Priming: ${primed.priming_prompt.slice(0, 60)}...`);
      }
    }
  }

  console.log(`\r✅ Completed ${questions.length} questions                    \n`);

  // Calculate summary
  const nonPrimedCorrect = results.filter((r) => r.non_primed.correct).length;
  const primedCorrect = results.filter((r) => r.primed.correct).length;
  const nonPrimedTrapped = results.filter((r) => r.non_primed.fell_for_trap).length;
  const primedTrapped = results.filter((r) => r.primed.fell_for_trap).length;

  const nonPrimedAvgTime =
    results.reduce((sum, r) => sum + r.non_primed.time_ms, 0) / results.length;
  const primedAvgTime =
    results.reduce((sum, r) => sum + r.primed.time_ms, 0) / results.length;

  const questionsFixed = results.filter(
    (r) => !r.non_primed.correct && r.primed.correct
  ).length;
  const questionsBroken = results.filter(
    (r) => r.non_primed.correct && !r.primed.correct
  ).length;

  // By trap type breakdown
  const byTrapType: Record<
    string,
    {
      count: number;
      non_primed_correct: number;
      primed_correct: number;
      primed_detected: number;
      actually_primed: number;
    }
  > = {};

  for (const r of results) {
    if (!byTrapType[r.trap_type]) {
      byTrapType[r.trap_type] = {
        count: 0,
        non_primed_correct: 0,
        primed_correct: 0,
        primed_detected: 0,
        actually_primed: 0,
      };
    }
    byTrapType[r.trap_type].count++;
    if (r.non_primed.correct) byTrapType[r.trap_type].non_primed_correct++;
    if (r.primed.correct) byTrapType[r.trap_type].primed_correct++;
    if (r.primed.trap_types_detected.includes(r.trap_type)) {
      byTrapType[r.trap_type].primed_detected++;
    }
    if (r.primed.trap_types_primed.includes(r.trap_type)) {
      byTrapType[r.trap_type].actually_primed++;
    }
  }

  const byTrapTypeSummary: PrimingSummary["summary"]["by_trap_type"] = {};
  for (const [trap, data] of Object.entries(byTrapType)) {
    byTrapTypeSummary[trap] = {
      count: data.count,
      non_primed_accuracy: data.non_primed_correct / data.count,
      primed_accuracy: data.primed_correct / data.count,
      delta: (data.primed_correct - data.non_primed_correct) / data.count,
      primed_detected: data.primed_detected,
    };
  }

  const summary: PrimingSummary = {
    timestamp: new Date().toISOString(),
    model: llmConfig.model,
    total_questions: results.length,
    results,
    summary: {
      non_primed: {
        accuracy: nonPrimedCorrect / results.length,
        trap_rate: nonPrimedTrapped / results.length,
        avg_time_ms: nonPrimedAvgTime,
      },
      primed: {
        accuracy: primedCorrect / results.length,
        trap_rate: primedTrapped / results.length,
        avg_time_ms: primedAvgTime,
      },
      comparison: {
        accuracy_delta: (primedCorrect - nonPrimedCorrect) / results.length,
        accuracy_lift_pct:
          nonPrimedCorrect > 0
            ? ((primedCorrect - nonPrimedCorrect) / nonPrimedCorrect) * 100
            : 0,
        trap_rate_reduction:
          (nonPrimedTrapped - primedTrapped) / results.length,
        trap_rate_reduction_pct:
          nonPrimedTrapped > 0
            ? ((nonPrimedTrapped - primedTrapped) / nonPrimedTrapped) * 100
            : 0,
        questions_fixed: questionsFixed,
        questions_broken: questionsBroken,
        net_improvement: questionsFixed - questionsBroken,
      },
      by_trap_type: byTrapTypeSummary,
    },
  };

  // Print summary
  console.log("═".repeat(60));
  console.log("PRIMING BENCHMARK RESULTS");
  console.log("═".repeat(60));

  console.log(`\n📊 Overall Results:`);
  console.log(
    `   Non-primed: ${nonPrimedCorrect}/${results.length} correct (${(summary.summary.non_primed.accuracy * 100).toFixed(1)}%)`
  );
  console.log(
    `   Primed:     ${primedCorrect}/${results.length} correct (${(summary.summary.primed.accuracy * 100).toFixed(1)}%)`
  );
  console.log(
    `   Delta:      ${summary.summary.comparison.accuracy_delta >= 0 ? "+" : ""}${(summary.summary.comparison.accuracy_delta * 100).toFixed(1)}% (${summary.summary.comparison.accuracy_lift_pct >= 0 ? "+" : ""}${summary.summary.comparison.accuracy_lift_pct.toFixed(1)}% lift)`
  );

  console.log(`\n🪤 Trap Rate:`);
  console.log(
    `   Non-primed: ${nonPrimedTrapped}/${results.length} fell for trap (${(summary.summary.non_primed.trap_rate * 100).toFixed(1)}%)`
  );
  console.log(
    `   Primed:     ${primedTrapped}/${results.length} fell for trap (${(summary.summary.primed.trap_rate * 100).toFixed(1)}%)`
  );
  console.log(
    `   Reduction:  ${summary.summary.comparison.trap_rate_reduction_pct.toFixed(1)}%`
  );

  console.log(`\n🔄 Question Changes:`);
  console.log(`   Fixed by priming:  ${questionsFixed}`);
  console.log(`   Broken by priming: ${questionsBroken}`);
  console.log(
    `   Net improvement:   ${summary.summary.comparison.net_improvement >= 0 ? "+" : ""}${summary.summary.comparison.net_improvement}`
  );

  console.log(`\n⏱️ Timing:`);
  console.log(`   Non-primed avg: ${nonPrimedAvgTime.toFixed(0)}ms`);
  console.log(`   Primed avg:     ${primedAvgTime.toFixed(0)}ms`);
  console.log(
    `   Overhead:       ${(primedAvgTime - nonPrimedAvgTime).toFixed(0)}ms (${(((primedAvgTime - nonPrimedAvgTime) / nonPrimedAvgTime) * 100).toFixed(1)}%)`
  );

  console.log(`\n📈 By Trap Type:`);
  const sortedTraps = Object.entries(byTrapTypeSummary).sort(
    (a, b) => b[1].delta - a[1].delta
  );
  for (const [trap, data] of sortedTraps) {
    const npAcc = (data.non_primed_accuracy * 100).toFixed(0);
    const pAcc = (data.primed_accuracy * 100).toFixed(0);
    const deltaNum = data.delta * 100;
    const delta = deltaNum.toFixed(0);
    const detected = data.primed_detected;
    const primed = byTrapType[trap]?.actually_primed ?? 0;
    console.log(
      `   ${trap.padEnd(22)} ${npAcc.padStart(3)}% → ${pAcc.padStart(3)}% (${deltaNum >= 0 ? "+" : ""}${delta}%) [det: ${detected}/${data.count}, primed: ${primed}/${data.count}]`
    );
  }

  // Save results
  const resultsPath = resolve(__dirname, "results", "priming-results.json");
  await Bun.write(resultsPath, JSON.stringify(summary, null, 2));
  console.log(`\n💾 Results saved to: ${resultsPath}\n`);
}

main().catch(console.error);
