/**
 * Math Module Benchmark Runner
 *
 * Tests performance of math operations:
 * - Tokenization speed
 * - AST parsing speed
 * - Expression evaluation
 * - Expression comparison
 * - Simplification
 *
 * Target: <1ms for typical expressions
 *
 * Usage:
 *   bun run math-bench.ts [--iterations=1000] [--warmup=100]
 */

import {
  type ASTNode,
  buildAST,
  compareExpressions,
  evaluateExpression,
  formatAST,
  simplifyAST,
  tokenizeMathExpression,
} from "../../src/lib/math";

// ============================================================================
// Types
// ============================================================================

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

interface ExpressionTestCase {
  id: string;
  category: "simple" | "polynomial" | "nested" | "complex" | "edge";
  expression: string;
  /** Expected evaluation result (if applicable) */
  expected?: number;
  /** Variables for evaluation */
  vars?: Record<string, number>;
}

// ============================================================================
// Test Cases
// ============================================================================

const TEST_EXPRESSIONS: ExpressionTestCase[] = [
  // Simple arithmetic
  { id: "add", category: "simple", expression: "2 + 3", expected: 5 },
  { id: "mul", category: "simple", expression: "4 * 5", expected: 20 },
  { id: "div", category: "simple", expression: "10 / 2", expected: 5 },
  { id: "sub", category: "simple", expression: "7 - 3", expected: 4 },
  { id: "pow", category: "simple", expression: "2^3", expected: 8 },

  // Polynomials
  { id: "poly1", category: "polynomial", expression: "x^2 + 2x + 1" },
  { id: "poly2", category: "polynomial", expression: "3x^3 - 2x^2 + x - 5" },
  { id: "poly3", category: "polynomial", expression: "x^4 + 2x^3 + 3x^2 + 4x + 5" },

  // Nested expressions
  { id: "nest1", category: "nested", expression: "((2 + 3) * 4)", expected: 20 },
  { id: "nest2", category: "nested", expression: "(1 + (2 * (3 + 4)))", expected: 15 },
  { id: "nest3", category: "nested", expression: "((a + b) * (c + d))" },

  // Complex expressions
  { id: "complex1", category: "complex", expression: "(x + 1)(x - 1)" },
  { id: "complex2", category: "complex", expression: "x^2 + 2xy + y^2" },
  { id: "complex3", category: "complex", expression: "(a + b)^2 - (a - b)^2" },
  { id: "complex4", category: "complex", expression: "sin(x)^2 + cos(x)^2" },

  // Edge cases
  { id: "edge1", category: "edge", expression: "-x", vars: { x: 5 }, expected: -5 },
  { id: "edge2", category: "edge", expression: "--x", vars: { x: 5 }, expected: 5 },
  { id: "edge3", category: "edge", expression: "0", expected: 0 },
  { id: "edge4", category: "edge", expression: "1", expected: 1 },
  { id: "edge5", category: "edge", expression: "x", vars: { x: 42 }, expected: 42 },
];

const COMPARISON_PAIRS: Array<{ a: string; b: string; shouldMatch: boolean }> = [
  { a: "x + y", b: "y + x", shouldMatch: true },
  { a: "2x", b: "x * 2", shouldMatch: true },
  { a: "x^2", b: "x * x", shouldMatch: true },
  { a: "(x + 1)^2", b: "x^2 + 2x + 1", shouldMatch: true },
  { a: "x + 1", b: "x + 2", shouldMatch: false },
  { a: "2x + 3x", b: "5x", shouldMatch: true },
  { a: "x/2", b: "0.5x", shouldMatch: true },
  { a: "a + b + c", b: "c + a + b", shouldMatch: true },
];

// ============================================================================
// Benchmark Utilities
// ============================================================================

function benchmark(
  name: string,
  fn: () => void,
  iterations: number,
  warmup: number
): BenchmarkResult {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  // Collect timing samples
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSec = 1000 / avgMs;

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSec,
  };
}

function formatResult(result: BenchmarkResult): string {
  const status = result.avgMs < 1 ? "✓" : result.avgMs < 5 ? "⚠" : "✗";
  return `${status} ${result.name.padEnd(25)} avg: ${result.avgMs.toFixed(4)}ms  min: ${result.minMs.toFixed(4)}ms  max: ${result.maxMs.toFixed(4)}ms  ops/s: ${result.opsPerSec.toFixed(0)}`;
}

// ============================================================================
// Benchmark Suites
// ============================================================================

function benchmarkTokenization(iterations: number, warmup: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (const testCase of TEST_EXPRESSIONS) {
    const result = benchmark(
      `tokenize:${testCase.id}`,
      () => tokenizeMathExpression(testCase.expression),
      iterations,
      warmup
    );
    results.push(result);
  }

  return results;
}

function benchmarkParsing(iterations: number, warmup: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (const testCase of TEST_EXPRESSIONS) {
    const { tokens, errors } = tokenizeMathExpression(testCase.expression);
    if (errors.length > 0) continue;

    const result = benchmark(
      `parse:${testCase.id}`,
      () => buildAST(tokens),
      iterations,
      warmup
    );
    results.push(result);
  }

  return results;
}

function benchmarkEvaluation(iterations: number, warmup: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (const testCase of TEST_EXPRESSIONS.filter((t) => t.expected !== undefined)) {
    const result = benchmark(
      `eval:${testCase.id}`,
      () => evaluateExpression(testCase.expression, testCase.vars || {}),
      iterations,
      warmup
    );
    results.push(result);
  }

  return results;
}

function benchmarkComparison(iterations: number, warmup: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < COMPARISON_PAIRS.length; i++) {
    const pair = COMPARISON_PAIRS[i];
    const result = benchmark(
      `compare:pair${i + 1}`,
      () => compareExpressions(pair.a, pair.b),
      iterations,
      warmup
    );
    results.push(result);
  }

  return results;
}

function benchmarkSimplification(iterations: number, warmup: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (const testCase of TEST_EXPRESSIONS) {
    const { tokens, errors } = tokenizeMathExpression(testCase.expression);
    if (errors.length > 0) continue;
    const { ast } = buildAST(tokens);
    if (!ast) continue;

    const result = benchmark(
      `simplify:${testCase.id}`,
      () => simplifyAST(ast),
      iterations,
      warmup
    );
    results.push(result);
  }

  return results;
}

function benchmarkFormat(iterations: number, warmup: number): BenchmarkResult[] {
  const results: BenchmarkResult[] = [];

  for (const testCase of TEST_EXPRESSIONS) {
    const { tokens, errors } = tokenizeMathExpression(testCase.expression);
    if (errors.length > 0) continue;
    const { ast } = buildAST(tokens);
    if (!ast) continue;

    const result = benchmark(
      `format:${testCase.id}`,
      () => formatAST(ast),
      iterations,
      warmup
    );
    results.push(result);
  }

  return results;
}

// ============================================================================
// Aggregate Benchmarks
// ============================================================================

function benchmarkEndToEnd(iterations: number, warmup: number): BenchmarkResult {
  // Pre-parse expressions that can be parsed
  const parsedExprs: Array<{ testCase: ExpressionTestCase; ast: ASTNode }> = [];
  for (const testCase of TEST_EXPRESSIONS) {
    const { tokens, errors } = tokenizeMathExpression(testCase.expression);
    if (errors.length > 0) continue;
    const { ast } = buildAST(tokens);
    if (ast) parsedExprs.push({ testCase, ast });
  }

  return benchmark(
    "end-to-end:all",
    () => {
      for (const { testCase, ast } of parsedExprs) {
        simplifyAST(ast);
        formatAST(ast);
        if (testCase.expected !== undefined) {
          evaluateExpression(testCase.expression, testCase.vars || {});
        }
      }
    },
    iterations,
    warmup
  );
}

function benchmarkComparisonSuite(iterations: number, warmup: number): BenchmarkResult {
  return benchmark(
    "comparison:all",
    () => {
      for (const pair of COMPARISON_PAIRS) {
        compareExpressions(pair.a, pair.b);
      }
    },
    iterations,
    warmup
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const iterations = Number.parseInt(
    args.find((a) => a.startsWith("--iterations="))?.split("=")[1] || "1000"
  );
  const warmup = Number.parseInt(
    args.find((a) => a.startsWith("--warmup="))?.split("=")[1] || "100"
  );
  const detailed = args.includes("--detailed");

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    Math Module Benchmark                       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`Iterations: ${iterations}, Warmup: ${warmup}\n`);

  // Aggregate benchmarks (always run)
  console.log("─── Aggregate Benchmarks ───────────────────────────────────────");
  const endToEnd = benchmarkEndToEnd(iterations, warmup);
  console.log(formatResult(endToEnd));

  const comparisonAll = benchmarkComparisonSuite(iterations, warmup);
  console.log(formatResult(comparisonAll));

  // Per-expression benchmarks (if --detailed)
  if (detailed) {
    console.log("\n─── Tokenization ───────────────────────────────────────────────");
    for (const r of benchmarkTokenization(iterations, warmup)) {
      console.log(formatResult(r));
    }

    console.log("\n─── Parsing ────────────────────────────────────────────────────");
    for (const r of benchmarkParsing(iterations, warmup)) {
      console.log(formatResult(r));
    }

    console.log("\n─── Evaluation ─────────────────────────────────────────────────");
    for (const r of benchmarkEvaluation(iterations, warmup)) {
      console.log(formatResult(r));
    }

    console.log("\n─── Comparison ─────────────────────────────────────────────────");
    for (const r of benchmarkComparison(iterations, warmup)) {
      console.log(formatResult(r));
    }

    console.log("\n─── Simplification ─────────────────────────────────────────────");
    for (const r of benchmarkSimplification(iterations, warmup)) {
      console.log(formatResult(r));
    }

    console.log("\n─── Formatting ─────────────────────────────────────────────────");
    for (const r of benchmarkFormat(iterations, warmup)) {
      console.log(formatResult(r));
    }
  }

  // Summary
  console.log("\n─── Summary ────────────────────────────────────────────────────");
  const avgPerExpr = endToEnd.avgMs / TEST_EXPRESSIONS.length;
  const avgPerComparison = comparisonAll.avgMs / COMPARISON_PAIRS.length;

  console.log(`Average per expression (full pipeline): ${avgPerExpr.toFixed(4)}ms`);
  console.log(`Average per comparison: ${avgPerComparison.toFixed(4)}ms`);
  console.log(
    `Target (<1ms): ${avgPerExpr < 1 && avgPerComparison < 1 ? "✓ PASS" : "✗ FAIL"}`
  );
}

main().catch(console.error);
