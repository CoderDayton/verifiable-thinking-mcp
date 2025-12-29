#!/usr/bin/env bun
/**
 * Judge Comparison Script
 * 
 * Compares baseline vs tool responses using LLM-as-Judge.
 * Run after benchmark to evaluate quality on open-ended responses.
 * 
 * Usage:
 *   bun run judge.ts                    # Use latest results file
 *   bun run judge.ts results-XXX.json   # Use specific results file
 *   bun run judge.ts --open-ended-only  # Only judge non-exact-match questions
 */

import { LLMClient } from "./llm-client";
import {
  judgeResponses,
  summarizeJudgments,
  type JudgeInput,
  type JudgeResult,
} from "../../src/lib/judge";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface BenchmarkResult {
  question_id: string;
  difficulty: string;
  category: string;
  baseline: {
    answer: string;
    correct: boolean;
    raw_response?: string;
  };
  with_tool: {
    answer: string;
    correct: boolean;
    raw_response?: string;
    complexity_path?: string;
  };
}

interface BenchmarkFile {
  model: string;
  results: BenchmarkResult[];
  questions?: Array<{
    id: string;
    question: string;
    expected_answer: string;
    verification_type: string;
  }>;
}

async function findLatestResults(): Promise<string> {
  const files = await readdir(".");
  const resultFiles = files
    .filter(f => f.startsWith("results-") && f.endsWith(".json"))
    .sort()
    .reverse();
  
  if (resultFiles.length === 0) {
    throw new Error("No results files found. Run benchmark first.");
  }
  
  return resultFiles[0];
}

async function loadQuestions(): Promise<Map<string, { question: string; expected: string; type: string }>> {
  const content = await readFile("questions.json", "utf-8");
  const data = JSON.parse(content);
  const map = new Map();
  
  for (const q of data.questions) {
    map.set(q.id, {
      question: q.question,
      expected: Array.isArray(q.expected_answer) ? q.expected_answer[0] : q.expected_answer,
      type: q.verification_type,
    });
  }
  
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const openEndedOnly = args.includes("--open-ended-only");
  const resultsFile = args.find(a => a.endsWith(".json")) || await findLatestResults();
  
  console.log(`Loading results from: ${resultsFile}`);
  const content = await readFile(resultsFile, "utf-8");
  const benchmark: BenchmarkFile = JSON.parse(content);
  
  console.log(`Loading questions...`);
  const questions = await loadQuestions();
  
  // Filter results that have raw responses
  let judgeable = benchmark.results.filter(r => 
    r.baseline.raw_response && r.with_tool.raw_response
  );
  
  if (openEndedOnly) {
    judgeable = judgeable.filter(r => {
      const q = questions.get(r.question_id);
      return q && q.type !== "exact" && q.type !== "numeric";
    });
  }
  
  console.log(`\nFound ${judgeable.length} results with raw responses to judge`);
  
  if (judgeable.length === 0) {
    console.log("\nNo judgeable results. Make sure to run benchmark with raw response capture.");
    console.log("The benchmark runner needs to be updated to capture raw_response fields.");
    return;
  }
  
  // Initialize LLM for judging
  const llm = new LLMClient();
  const llmCall = async (prompt: string, system: string) => {
    return llm.ask(prompt, { system, temperature: 0.0 });
  };
  
  // Build judge inputs
  const inputs: JudgeInput[] = judgeable.map(r => {
    const q = questions.get(r.question_id);
    return {
      question: q?.question || r.question_id,
      response_a: r.baseline.raw_response!,
      response_b: r.with_tool.raw_response!,
      reference_answer: q?.expected,
      category: r.category,
    };
  });
  
  console.log(`\nJudging ${inputs.length} response pairs...`);
  console.log("(A = baseline, B = with tool)\n");
  
  const results: JudgeResult[] = [];
  
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const benchResult = judgeable[i];
    
    process.stdout.write(`[${i + 1}/${inputs.length}] ${benchResult.question_id}... `);
    
    try {
      const result = await judgeResponses(input, llmCall);
      results.push(result);
      
      const winnerEmoji = result.winner === "A" ? "🔴" : result.winner === "B" ? "🟢" : "⚪";
      console.log(`${winnerEmoji} ${result.winner} (conf: ${result.confidence.toFixed(2)})`);
      
      // Show brief reasoning for interesting cases
      if (result.winner !== "tie" && result.confidence >= 0.7) {
        console.log(`   └─ ${result.reasoning.slice(0, 100)}...`);
      }
    } catch (err) {
      console.log(`❌ Error: ${err}`);
      results.push({
        winner: "tie",
        confidence: 0,
        scores: {
          A: { accuracy: 3, reasoning_quality: 3, completeness: 3, clarity: 3, overall: 3 },
          B: { accuracy: 3, reasoning_quality: 3, completeness: 3, clarity: 3, overall: 3 },
        },
        reasoning: `Error: ${err}`,
      });
    }
  }
  
  // Summarize results
  const summary = summarizeJudgments(results);
  
  console.log("\n" + "═".repeat(70));
  console.log("JUDGE SUMMARY");
  console.log("═".repeat(70));
  console.log(`\nTotal comparisons: ${summary.total}`);
  console.log(`\n  🔴 Baseline wins:  ${summary.wins_a} (${(summary.win_rate_a * 100).toFixed(1)}%)`);
  console.log(`  🟢 Tool wins:      ${summary.wins_b} (${(summary.win_rate_b * 100).toFixed(1)}%)`);
  console.log(`  ⚪ Ties:           ${summary.ties}`);
  console.log(`\n  Average confidence: ${(summary.avg_confidence * 100).toFixed(1)}%`);
  
  console.log("\n─".repeat(70));
  console.log("DIMENSION SCORES (1-5 scale)");
  console.log("─".repeat(70));
  
  const dims: Array<[string, keyof typeof summary.avg_scores_a]> = [
    ["Accuracy", "accuracy"],
    ["Reasoning", "reasoning_quality"],
    ["Completeness", "completeness"],
    ["Clarity", "clarity"],
    ["Overall", "overall"],
  ];
  
  console.log("\n           Baseline    Tool       Delta");
  for (const [name, key] of dims) {
    const a = summary.avg_scores_a[key];
    const b = summary.avg_scores_b[key];
    const delta = b - a;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
    const deltaEmoji = delta > 0.1 ? "↑" : delta < -0.1 ? "↓" : "─";
    console.log(`  ${name.padEnd(12)} ${a.toFixed(2)}       ${b.toFixed(2)}       ${deltaStr} ${deltaEmoji}`);
  }
  
  // Breakdown by category
  console.log("\n─".repeat(70));
  console.log("BY CATEGORY");
  console.log("─".repeat(70));
  
  const byCategory = new Map<string, JudgeResult[]>();
  for (let i = 0; i < results.length; i++) {
    const cat = judgeable[i].category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(results[i]);
  }
  
  for (const [cat, catResults] of byCategory) {
    const catSummary = summarizeJudgments(catResults);
    const toolAdvantage = catSummary.win_rate_b - catSummary.win_rate_a;
    const emoji = toolAdvantage > 0.1 ? "🟢" : toolAdvantage < -0.1 ? "🔴" : "⚪";
    console.log(`\n  ${cat}:`);
    console.log(`    ${emoji} Baseline: ${catSummary.wins_a} | Tool: ${catSummary.wins_b} | Tie: ${catSummary.ties}`);
    console.log(`    Avg scores: B=${catSummary.avg_scores_a.overall.toFixed(2)} T=${catSummary.avg_scores_b.overall.toFixed(2)}`);
  }
  
  // Breakdown by complexity path (local vs phased vs trivial)
  console.log("\n─".repeat(70));
  console.log("BY COMPLEXITY PATH");
  console.log("─".repeat(70));
  
  const byPath = new Map<string, JudgeResult[]>();
  for (let i = 0; i < results.length; i++) {
    const path = judgeable[i].with_tool.complexity_path || "unknown";
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path)!.push(results[i]);
  }
  
  for (const [path, pathResults] of byPath) {
    const pathSummary = summarizeJudgments(pathResults);
    const toolAdvantage = pathSummary.win_rate_b - pathSummary.win_rate_a;
    const emoji = toolAdvantage > 0.1 ? "🟢" : toolAdvantage < -0.1 ? "🔴" : "⚪";
    console.log(`\n  ${path}:`);
    console.log(`    ${emoji} Baseline: ${pathSummary.wins_a} | Tool: ${pathSummary.wins_b} | Tie: ${pathSummary.ties}`);
  }
  
  // Save detailed results
  const outputFile = resultsFile.replace("results-", "judge-");
  await Bun.write(outputFile, JSON.stringify({
    source: resultsFile,
    summary,
    results: results.map((r, i) => ({
      question_id: judgeable[i].question_id,
      ...r,
    })),
  }, null, 2));
  
  console.log(`\n\nDetailed results saved to: ${outputFile}`);
}

main().catch(console.error);
