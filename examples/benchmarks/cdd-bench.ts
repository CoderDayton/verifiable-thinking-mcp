#!/usr/bin/env bun
/**
 * CDD Benchmark - Analyze Confidence Drift Detection on trap questions
 *
 * This script simulates different confidence trajectories for trap questions
 * and measures how well CDD predicts incorrect answers.
 *
 * Usage: bun run examples/benchmarks/cdd-bench.ts
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeConfidenceDrift, type DriftAnalysis, type DriftPattern } from "../../src/lib/think/confidence-drift";
import type { ThoughtRecord } from "../../src/lib/session";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// TYPES
// ============================================================================

interface TrapQuestion {
  id: string;
  question: string;
  expected_answer: string;
  common_wrong_answer: string;
  trap_type: string;
}

interface SimulatedReasoning {
  question_id: string;
  trajectory: number[]; // confidence values per step
  answer: string;
  is_correct: boolean;
  has_revision: boolean;
  revision_step?: number;
}

interface CDDBenchResult {
  question_id: string;
  trap_type: string;
  is_correct: boolean;
  drift_analysis: DriftAnalysis;
  cdd_flagged: boolean; // CDD flagged as unresolved
  true_positive: boolean; // Wrong answer + CDD flagged
  true_negative: boolean; // Correct answer + CDD not flagged
  false_positive: boolean; // Correct answer + CDD flagged
  false_negative: boolean; // Wrong answer + CDD not flagged
}

interface BenchmarkSummary {
  total_questions: number;
  correct_answers: number;
  wrong_answers: number;
  cdd_flagged: number;
  true_positives: number;
  true_negatives: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  accuracy: number;
  by_trap_type: Record<string, {
    total: number;
    correct: number;
    cdd_flagged: number;
    cdd_accuracy: number;
  }>;
  by_pattern: Record<DriftPattern, {
    count: number;
    correct_rate: number;
    flagged_rate: number;
  }>;
}

// ============================================================================
// TRAP QUESTIONS
// ============================================================================

const TRAP_QUESTIONS: TrapQuestion[] = [
  {
    id: "bat_ball",
    question: "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?",
    expected_answer: "5",
    common_wrong_answer: "10",
    trap_type: "additive_intuition",
  },
  {
    id: "lily_pad",
    question: "A lily pad doubles in size every day. If it takes 48 days to cover the entire lake, how many days does it take to cover half the lake?",
    expected_answer: "47",
    common_wrong_answer: "24",
    trap_type: "exponential_thinking",
  },
  {
    id: "widget_machine",
    question: "If 5 machines take 5 minutes to make 5 widgets, how many minutes would it take 100 machines to make 100 widgets?",
    expected_answer: "5",
    common_wrong_answer: "100",
    trap_type: "rate_confusion",
  },
  {
    id: "socks",
    question: "A drawer contains 10 black socks and 10 white socks. In complete darkness, what is the minimum number of socks you must draw to guarantee a matching pair?",
    expected_answer: "3",
    common_wrong_answer: "11",
    trap_type: "pigeonhole_principle",
  },
  {
    id: "harmonic_avg",
    question: "Train goes A→B at 60 mph, returns at 40 mph. Average speed for round trip?",
    expected_answer: "48",
    common_wrong_answer: "50",
    trap_type: "harmonic_mean",
  },
  {
    id: "sunk_cost",
    question: "You paid $100 for concert ticket. Day of concert, you feel sick. Should the $100 factor into your decision to go?",
    expected_answer: "NO",
    common_wrong_answer: "YES",
    trap_type: "sunk_cost_fallacy",
  },
  {
    id: "gamblers",
    question: "A fair coin has landed heads 10 times in a row. What's the probability the next flip is heads?",
    expected_answer: "50",
    common_wrong_answer: "less than 50",
    trap_type: "gamblers_fallacy",
  },
  {
    id: "monty_hall",
    question: "You pick door 1. Host opens door 3 (goat). Should you switch to door 2? What are your chances if you switch?",
    expected_answer: "67",
    common_wrong_answer: "50",
    trap_type: "conditional_probability",
  },
];

// ============================================================================
// SIMULATION
// ============================================================================

/**
 * Simulate different reasoning trajectories for a trap question.
 * Returns both correct and incorrect reasoning paths.
 */
function simulateReasoningTrajectories(question: TrapQuestion): SimulatedReasoning[] {
  const trajectories: SimulatedReasoning[] = [];

  // Pattern 1: V-shaped → wrong answer (classic trap pattern)
  // Model starts confident, doubts when hitting the trap, recovers with wrong intuitive answer
  trajectories.push({
    question_id: question.id,
    trajectory: [0.85, 0.7, 0.5, 0.65, 0.8],
    answer: question.common_wrong_answer,
    is_correct: false,
    has_revision: false,
  });

  // Pattern 2: V-shaped with revision → correct answer
  // Model doubts, then properly revises and gets correct answer
  trajectories.push({
    question_id: question.id,
    trajectory: [0.85, 0.5, 0.6, 0.85],
    answer: question.expected_answer,
    is_correct: true,
    has_revision: true,
    revision_step: 3,
  });

  // Pattern 3: Improving → correct answer
  // Careful step-by-step reasoning with increasing confidence
  trajectories.push({
    question_id: question.id,
    trajectory: [0.5, 0.6, 0.7, 0.8, 0.9],
    answer: question.expected_answer,
    is_correct: true,
    has_revision: false,
  });

  // Pattern 4: Stable high → could be either (overconfident)
  // Model doesn't recognize the trap
  trajectories.push({
    question_id: question.id,
    trajectory: [0.9, 0.88, 0.9, 0.92],
    answer: question.common_wrong_answer,
    is_correct: false,
    has_revision: false,
  });

  // Pattern 5: Declining → often wrong (increasing doubt)
  trajectories.push({
    question_id: question.id,
    trajectory: [0.8, 0.7, 0.6, 0.5, 0.45],
    answer: question.common_wrong_answer,
    is_correct: false,
    has_revision: false,
  });

  // Pattern 6: Deep V-shaped with strong recovery → correct (worked through doubt)
  trajectories.push({
    question_id: question.id,
    trajectory: [0.8, 0.4, 0.3, 0.6, 0.9],
    answer: question.expected_answer,
    is_correct: true,
    has_revision: true,
    revision_step: 4,
  });

  return trajectories;
}

/**
 * Convert simulation to ThoughtRecords for CDD analysis
 */
function simulationToThoughts(sim: SimulatedReasoning): ThoughtRecord[] {
  return sim.trajectory.map((conf, i) => ({
    id: `${sim.question_id}:main:${i + 1}`,
    step_number: i + 1,
    thought: `Step ${i + 1} reasoning`,
    timestamp: Date.now(),
    branch_id: "main",
    verification: {
      passed: true,
      confidence: conf,
      domain: "math",
    },
    revises_step: sim.has_revision && sim.revision_step === i + 1 ? i : undefined,
  }));
}

// ============================================================================
// BENCHMARK
// ============================================================================

function runBenchmark(): BenchmarkSummary {
  const results: CDDBenchResult[] = [];

  for (const question of TRAP_QUESTIONS) {
    const trajectories = simulateReasoningTrajectories(question);

    for (const sim of trajectories) {
      const thoughts = simulationToThoughts(sim);
      const drift = analyzeConfidenceDrift(thoughts);

      const cdd_flagged = drift.unresolved;

      results.push({
        question_id: question.id,
        trap_type: question.trap_type,
        is_correct: sim.is_correct,
        drift_analysis: drift,
        cdd_flagged,
        true_positive: !sim.is_correct && cdd_flagged,
        true_negative: sim.is_correct && !cdd_flagged,
        false_positive: sim.is_correct && cdd_flagged,
        false_negative: !sim.is_correct && !cdd_flagged,
      });
    }
  }

  // Calculate summary statistics
  const total = results.length;
  const correct = results.filter(r => r.is_correct).length;
  const wrong = total - correct;
  const flagged = results.filter(r => r.cdd_flagged).length;
  const tp = results.filter(r => r.true_positive).length;
  const tn = results.filter(r => r.true_negative).length;
  const fp = results.filter(r => r.false_positive).length;
  const fn = results.filter(r => r.false_negative).length;

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = 2 * precision * recall / (precision + recall) || 0;
  const accuracy = (tp + tn) / total;

  // By trap type
  const byTrapType: BenchmarkSummary["by_trap_type"] = {};
  for (const r of results) {
    if (!byTrapType[r.trap_type]) {
      byTrapType[r.trap_type] = { total: 0, correct: 0, cdd_flagged: 0, cdd_accuracy: 0 };
    }
    byTrapType[r.trap_type].total++;
    if (r.is_correct) byTrapType[r.trap_type].correct++;
    if (r.cdd_flagged) byTrapType[r.trap_type].cdd_flagged++;
  }
  for (const type of Object.keys(byTrapType)) {
    const t = byTrapType[type];
    // CDD accuracy = correctly predicted wrong answers as flagged
    const typeResults = results.filter(r => r.trap_type === type);
    const typeTP = typeResults.filter(r => r.true_positive).length;
    const typeTN = typeResults.filter(r => r.true_negative).length;
    t.cdd_accuracy = (typeTP + typeTN) / t.total;
  }

  // By pattern
  const byPattern: BenchmarkSummary["by_pattern"] = {} as BenchmarkSummary["by_pattern"];
  for (const r of results) {
    const pattern = r.drift_analysis.pattern;
    if (!byPattern[pattern]) {
      byPattern[pattern] = { count: 0, correct_rate: 0, flagged_rate: 0 };
    }
    byPattern[pattern].count++;
  }
  for (const pattern of Object.keys(byPattern) as DriftPattern[]) {
    const patternResults = results.filter(r => r.drift_analysis.pattern === pattern);
    byPattern[pattern].correct_rate = patternResults.filter(r => r.is_correct).length / patternResults.length;
    byPattern[pattern].flagged_rate = patternResults.filter(r => r.cdd_flagged).length / patternResults.length;
  }

  return {
    total_questions: total,
    correct_answers: correct,
    wrong_answers: wrong,
    cdd_flagged: flagged,
    true_positives: tp,
    true_negatives: tn,
    false_positives: fp,
    false_negatives: fn,
    precision,
    recall,
    f1_score: f1,
    accuracy,
    by_trap_type: byTrapType,
    by_pattern: byPattern,
  };
}

// ============================================================================
// OUTPUT
// ============================================================================

function printResults(summary: BenchmarkSummary): void {
  console.log("\n" + "=".repeat(70));
  console.log("CONFIDENCE DRIFT DETECTION (CDD) BENCHMARK RESULTS");
  console.log("=".repeat(70));

  console.log("\n📊 OVERALL METRICS");
  console.log("-".repeat(40));
  console.log(`Total simulations:     ${summary.total_questions}`);
  console.log(`Correct answers:       ${summary.correct_answers} (${(summary.correct_answers / summary.total_questions * 100).toFixed(1)}%)`);
  console.log(`Wrong answers:         ${summary.wrong_answers} (${(summary.wrong_answers / summary.total_questions * 100).toFixed(1)}%)`);
  console.log(`CDD flagged:           ${summary.cdd_flagged} (${(summary.cdd_flagged / summary.total_questions * 100).toFixed(1)}%)`);

  console.log("\n🎯 CLASSIFICATION PERFORMANCE");
  console.log("-".repeat(40));
  console.log(`True Positives:        ${summary.true_positives} (wrong answer, correctly flagged)`);
  console.log(`True Negatives:        ${summary.true_negatives} (correct answer, not flagged)`);
  console.log(`False Positives:       ${summary.false_positives} (correct answer, incorrectly flagged)`);
  console.log(`False Negatives:       ${summary.false_negatives} (wrong answer, not flagged)`);
  console.log(`Precision:             ${(summary.precision * 100).toFixed(1)}%`);
  console.log(`Recall:                ${(summary.recall * 100).toFixed(1)}%`);
  console.log(`F1 Score:              ${(summary.f1_score * 100).toFixed(1)}%`);
  console.log(`Accuracy:              ${(summary.accuracy * 100).toFixed(1)}%`);

  console.log("\n📈 BY CONFIDENCE PATTERN");
  console.log("-".repeat(40));
  console.log("Pattern          Count  Correct%  Flagged%");
  for (const [pattern, data] of Object.entries(summary.by_pattern)) {
    console.log(`${pattern.padEnd(16)} ${String(data.count).padStart(5)}  ${(data.correct_rate * 100).toFixed(0).padStart(7)}%  ${(data.flagged_rate * 100).toFixed(0).padStart(7)}%`);
  }

  console.log("\n🪤 BY TRAP TYPE");
  console.log("-".repeat(40));
  console.log("Trap Type                Total  Correct  Flagged  CDD Acc");
  for (const [type, data] of Object.entries(summary.by_trap_type)) {
    console.log(`${type.padEnd(24)} ${String(data.total).padStart(5)}  ${String(data.correct).padStart(7)}  ${String(data.cdd_flagged).padStart(7)}  ${(data.cdd_accuracy * 100).toFixed(0).padStart(6)}%`);
  }

  console.log("\n" + "=".repeat(70));
}

function generateChart(summary: BenchmarkSummary): string {
  const patterns = Object.entries(summary.by_pattern)
    .sort((a, b) => b[1].count - a[1].count);

  let chart = `
┌────────────────────────────────────────────────────────────────────────┐
│                    CDD PATTERN vs CORRECTNESS                          │
├────────────────────────────────────────────────────────────────────────┤
│  Pattern        │ Correct │ Wrong │ Flagged │ Flag Rate │             │
├─────────────────┼─────────┼───────┼─────────┼───────────┼─────────────┤
`;

  for (const [pattern, data] of patterns) {
    const correctCount = Math.round(data.count * data.correct_rate);
    const wrongCount = data.count - correctCount;
    const flaggedCount = Math.round(data.count * data.flagged_rate);
    const bar = "█".repeat(Math.round(data.flagged_rate * 20));
    chart += `│ ${pattern.padEnd(15)} │ ${String(correctCount).padStart(7)} │ ${String(wrongCount).padStart(5)} │ ${String(flaggedCount).padStart(7)} │ ${(data.flagged_rate * 100).toFixed(0).padStart(8)}% │ ${bar.padEnd(11)} │\n`;
  }

  chart += `├─────────────────┴─────────┴───────┴─────────┴───────────┴─────────────┤
│  TP=${summary.true_positives}  TN=${summary.true_negatives}  FP=${summary.false_positives}  FN=${summary.false_negatives}  │  Precision: ${(summary.precision * 100).toFixed(1)}%  Recall: ${(summary.recall * 100).toFixed(1)}%  │
└────────────────────────────────────────────────────────────────────────┘`;

  return chart;
}

function generateSVGChart(summary: BenchmarkSummary): string {
  const width = 800;
  const height = 500;
  const margin = { top: 40, right: 30, bottom: 80, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  const patterns = Object.entries(summary.by_pattern)
    .filter(([p]) => p !== "insufficient")
    .sort((a, b) => b[1].count - a[1].count);

  const barWidth = chartWidth / patterns.length - 20;
  const maxCount = Math.max(...patterns.map(([, d]) => d.count));

  let bars = "";
  let labels = "";
  let legend = "";

  patterns.forEach(([pattern, data], i) => {
    const x = margin.left + i * (barWidth + 20) + 10;
    const correctCount = Math.round(data.count * data.correct_rate);
    const wrongCount = data.count - correctCount;
    const flaggedCount = Math.round(data.count * data.flagged_rate);

    // Correct answers bar (green)
    const correctHeight = (correctCount / maxCount) * chartHeight;
    bars += `<rect x="${x}" y="${margin.top + chartHeight - correctHeight}" width="${barWidth / 2 - 2}" height="${correctHeight}" fill="#4ade80" />`;

    // Wrong answers bar (red)
    const wrongHeight = (wrongCount / maxCount) * chartHeight;
    bars += `<rect x="${x + barWidth / 2}" y="${margin.top + chartHeight - wrongHeight}" width="${barWidth / 2 - 2}" height="${wrongHeight}" fill="#f87171" />`;

    // Flagged marker line
    const flaggedY = margin.top + chartHeight - (flaggedCount / maxCount) * chartHeight;
    bars += `<line x1="${x}" y1="${flaggedY}" x2="${x + barWidth}" y2="${flaggedY}" stroke="#fbbf24" stroke-width="3" stroke-dasharray="5,3" />`;

    // Pattern label
    labels += `<text x="${x + barWidth / 2}" y="${height - margin.bottom + 20}" text-anchor="middle" font-size="11" transform="rotate(-30, ${x + barWidth / 2}, ${height - margin.bottom + 20})">${pattern}</text>`;

    // Value labels
    bars += `<text x="${x + barWidth / 4}" y="${margin.top + chartHeight - correctHeight - 5}" text-anchor="middle" font-size="10">${correctCount}</text>`;
    bars += `<text x="${x + barWidth * 3 / 4}" y="${margin.top + chartHeight - wrongHeight - 5}" text-anchor="middle" font-size="10">${wrongCount}</text>`;
  });

  // Y-axis
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + (chartHeight / 5) * i;
    const value = Math.round(maxCount - (maxCount / 5) * i);
    bars += `<line x1="${margin.left - 5}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5e7eb" />`;
    bars += `<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="10">${value}</text>`;
  }

  // Legend
  legend = `
    <rect x="${width - 150}" y="${margin.top}" width="12" height="12" fill="#4ade80" />
    <text x="${width - 133}" y="${margin.top + 11}" font-size="11">Correct</text>
    <rect x="${width - 150}" y="${margin.top + 18}" width="12" height="12" fill="#f87171" />
    <text x="${width - 133}" y="${margin.top + 29}" font-size="11">Wrong</text>
    <line x1="${width - 150}" y1="${margin.top + 42}" x2="${width - 138}" y2="${margin.top + 42}" stroke="#fbbf24" stroke-width="3" stroke-dasharray="5,3" />
    <text x="${width - 133}" y="${margin.top + 47}" font-size="11">CDD Flagged</text>
  `;

  // Summary box
  const summaryBox = `
    <rect x="${margin.left}" y="${height - 35}" width="${chartWidth}" height="30" fill="#f3f4f6" rx="4" />
    <text x="${margin.left + 10}" y="${height - 15}" font-size="12">
      Precision: ${(summary.precision * 100).toFixed(1)}%  |  Recall: ${(summary.recall * 100).toFixed(1)}%  |  F1: ${(summary.f1_score * 100).toFixed(1)}%  |  Accuracy: ${(summary.accuracy * 100).toFixed(1)}%
    </text>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: system-ui, -apple-system, sans-serif; }
  </style>
  <rect width="100%" height="100%" fill="white" />
  <text x="${width / 2}" y="25" text-anchor="middle" font-size="16" font-weight="bold">CDD Pattern Analysis: Confidence Trajectory vs Answer Correctness</text>
  ${bars}
  ${labels}
  ${legend}
  ${summaryBox}
</svg>`;
}

// ============================================================================
// MAIN
// ============================================================================

const summary = runBenchmark();
printResults(summary);

console.log("\n📊 ASCII CHART:");
console.log(generateChart(summary));

// Save SVG chart
const svgChart = generateSVGChart(summary);
const svgPath = resolve(__dirname, "results/cdd-benchmark.svg");
await Bun.write(svgPath, svgChart);
console.log(`\n✅ SVG chart saved to: ${svgPath}`);

// Save JSON results
const jsonPath = resolve(__dirname, "results/cdd-benchmark.json");
await Bun.write(jsonPath, JSON.stringify(summary, null, 2));
console.log(`✅ JSON results saved to: ${jsonPath}`);
