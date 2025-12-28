/**
 * Benchmark runner for verifiable-thinking-mcp
 * Compares baseline LLM vs MCP-guided structured reasoning
 * 
 * Key insight: The tool should GUIDE reasoning, not replace it.
 * We test if guidance improves accuracy without excessive overhead.
 */

import { spawn, type Subprocess } from "bun";
import { LLMClient, type LLMConfig } from "./llm-client";

// Types
export interface Question {
  id: string;
  category: "math" | "logic" | "code" | "reasoning";
  difficulty: "easy" | "medium" | "hard" | "trap" | "impossible" | "sota";
  question: string;
  expected_answer: string | string[];
  verification_type: "exact" | "contains" | "regex" | "numeric" | "code_exec";
  tolerance?: number;
}

export interface QuestionSet {
  version: string;
  description: string;
  questions: Question[];
}

export interface RunResult {
  question_id: string;
  difficulty: string;
  category: string;
  baseline: {
    answer: string;
    correct: boolean;
    time_ms: number;
    tokens_estimate: number;
  };
  with_tool: {
    answer: string;
    correct: boolean;
    time_ms: number;
    tokens_estimate: number;
    steps: number;
    checkpoints: number;
    risk_flags: string[];
  };
}

export interface BenchmarkResults {
  timestamp: string;
  model: string;
  total_questions: number;
  results: RunResult[];
  summary: {
    baseline: { correct: number; total: number; accuracy: number; avg_time_ms: number };
    with_tool: { correct: number; total: number; accuracy: number; avg_time_ms: number };
    by_difficulty: Record<string, { baseline_accuracy: number; tool_accuracy: number; delta: number }>;
    by_category: Record<string, { baseline_accuracy: number; tool_accuracy: number; delta: number }>;
  };
}

// ============================================================================
// MCP CLIENT - JSON-RPC communication with the server
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class MCPClient {
  private proc: Subprocess<"pipe", "pipe", "inherit">;
  private buffer = "";
  private requestId = 0;
  private pending = new Map<number, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
  }>();
  private initialized = false;

  constructor() {
    this.proc = spawn({
      cmd: ["bun", "run", "../../src/index.ts"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      cwd: import.meta.dir,
    });
    this.readLoop();
  }

  private async readLoop() {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // Process ended
    }
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve(msg);
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = ++this.requestId;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (res) => { clearTimeout(timeout); resolve(res); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      this.proc.stdin.write(JSON.stringify(req) + "\n");
    });
  }

  async init() {
    if (this.initialized) return;
    await Bun.sleep(300); // Wait for server startup
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "benchmark", version: "1.0.0" },
    });
    this.initialized = true;
  }

  async think(args: {
    thought: string;
    step: number;
    total?: number;
    is_final?: boolean;
    guidance?: boolean;
    verify?: boolean;
    domain?: string;
    session_id: string;
  }): Promise<{ meta: Record<string, unknown>; raw: string }> {
    const response = await this.request("tools/call", {
      name: "think",
      arguments: args,
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    const result = response.result as { content: Array<{ text: string }> };
    const raw = result.content[0]?.text || "";
    
    // Extract JSON from code block
    const jsonMatch = raw.match(/```json\n([\s\S]*?)\n```/);
    const meta = jsonMatch ? JSON.parse(jsonMatch[1]) : {};
    
    return { meta, raw };
  }

  async clearSession(sessionId: string) {
    await this.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  }

  async close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

function verifyAnswer(question: Question, answer: string): boolean {
  const expected = Array.isArray(question.expected_answer) 
    ? question.expected_answer 
    : [question.expected_answer];
  
  const normalized = answer.trim().toLowerCase();

  switch (question.verification_type) {
    case "exact":
      return expected.some(e => normalized === e.toLowerCase());
    
    case "contains":
      return expected.some(e => normalized.includes(e.toLowerCase()));
    
    case "regex":
      return expected.some(e => new RegExp(e, "i").test(answer));
    
    case "numeric": {
      const num = parseFloat(answer.replace(/[^0-9.-]/g, ""));
      const tolerance = question.tolerance || 0.001;
      return expected.some(e => Math.abs(num - parseFloat(e)) <= tolerance);
    }
    
    case "code_exec":
      return expected.some(e => normalized.includes(e.toLowerCase()));
    
    default:
      return false;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractAnswer(response: string): string {
  // First, look for explicit answer markers
  const explicitPatterns = [
    /answer:\s*([^\n.]+)/i,
    /final answer:\s*([^\n.]+)/i,
    /the answer is\s*([^\n.]+)/i,
    /=\s*(\d+(?:\.\d+)?)\s*$/m, // Ends with = number
    /result:\s*([^\n.]+)/i,
  ];

  for (const pattern of explicitPatterns) {
    const match = response.match(pattern);
    if (match?.[1]) {
      // Clean up the answer
      let answer = match[1].trim();
      // Extract just the number if it starts with one
      const numMatch = answer.match(/^(-?\d+(?:\.\d+)?)/);
      if (numMatch) {
        return numMatch[1];
      }
      return answer;
    }
  }

  // Look for standalone numbers in the last few lines
  const lines = response.trim().split("\n").slice(-5);
  for (const line of lines.reverse()) {
    // Look for "= number" pattern
    const eqMatch = line.match(/=\s*(-?\d+(?:\.\d+)?)/);
    if (eqMatch) return eqMatch[1];
    
    // Look for "is number" pattern
    const isMatch = line.match(/is\s+(-?\d+(?:\.\d+)?)/);
    if (isMatch) return isMatch[1];
    
    // Look for bold number
    const boldMatch = line.match(/\*\*(-?\d+(?:\.\d+)?)\*\*/);
    if (boldMatch) return boldMatch[1];
  }

  // Last resort: find the last number in the response
  const allNumbers = response.match(/-?\d+(?:\.\d+)?/g);
  if (allNumbers && allNumbers.length > 0) {
    return allNumbers[allNumbers.length - 1];
  }

  // Fallback: last line
  const lastLine = response.trim().split("\n").pop() || "";
  return lastLine.slice(0, 50);
}

// ============================================================================
// BENCHMARK RUNNERS
// ============================================================================

// Baseline: Direct LLM call, no guidance
async function runBaseline(llm: LLMClient, question: Question): Promise<RunResult["baseline"]> {
  const start = Date.now();
  
  const prompt = `${question.question}\n\nProvide your answer clearly. If it's a number, state just the number. If it's a choice, state just the choice.`;
  
  const response = await llm.ask(prompt, {
    system: "You are a helpful assistant. Answer questions directly and concisely.",
    temperature: 0.1,
  });

  const time_ms = Date.now() - start;
  const answer = extractAnswer(response);

  return {
    answer,
    correct: verifyAnswer(question, answer),
    time_ms,
    tokens_estimate: estimateTokens(prompt + response),
  };
}

// With Tool: ADAPTIVE LLM + MCP guidance loop
// Key insight: Simple problems don't need multi-step reasoning.
// Only go deeper when guidance indicates risk.
async function runWithTool(
  llm: LLMClient, 
  mcp: MCPClient, 
  question: Question
): Promise<RunResult["with_tool"]> {
  const start = Date.now();
  const sessionId = `bench_${question.id}_${Date.now()}`;
  const risk_flags: string[] = [];
  let checkpoints = 0;
  let steps = 0;
  let totalTokens = 0;

  const domain = question.category === "math" ? "math" 
    : question.category === "logic" ? "logic"
    : question.category === "code" ? "code" 
    : "general";

  try {
    // PHASE 1: Initial attempt with guidance check
    const initialAttempt = await llm.ask(
      `${question.question}\n\nSolve this step by step. At the very end, write "Answer: " followed by just the answer (number, letter, or short phrase).`,
      { system: "You are a careful reasoning assistant. Show your reasoning, then give the final answer clearly.", temperature: 0.1 }
    );
    totalTokens += estimateTokens(initialAttempt);

    // Check guidance from MCP
    const step1 = await mcp.think({
      thought: initialAttempt,
      step: 1,
      total: 2, // Optimistic - may expand
      guidance: true,
      domain,
      session_id: sessionId,
    });
    steps++;

    const riskLevel = step1.meta.risk_level as string || "low";
    const hasCheckpoint = !!step1.meta.checkpoint;
    const patterns = (step1.meta.patterns as string[]) || [];
    
    if (hasCheckpoint) checkpoints++;
    risk_flags.push(...patterns);

    // DECISION: Do we need deeper reasoning?
    const needsDeeper = riskLevel !== "low" || hasCheckpoint || 
      patterns.some(p => ["premature_conclusion", "arithmetic_chain", "overconfident"].includes(p));

    if (!needsDeeper) {
      // Low risk - trust initial attempt
      await mcp.think({
        thought: "Confidence is high, returning initial answer.",
        step: 2,
        total: 2,
        is_final: true,
        guidance: false,
        domain,
        session_id: sessionId,
      });
      steps++;

      const answer = extractAnswer(initialAttempt);
      return {
        answer,
        correct: verifyAnswer(question, answer),
        time_ms: Date.now() - start,
        tokens_estimate: totalTokens,
        steps,
        checkpoints,
        risk_flags: [...new Set(risk_flags)],
      };
    }

    // PHASE 2: Risk detected - do verification step
    const verifyPrompt = `I need to verify my answer to: ${question.question}

My initial reasoning:
${initialAttempt}

Risk patterns detected: ${patterns.join(", ")}

Please:
1. Check for errors in the reasoning above
2. Verify the calculation/logic step by step
3. Provide the corrected answer if needed

Final Answer: [answer]`;

    const verification = await llm.ask(verifyPrompt, {
      system: "You are a verification assistant. Double-check reasoning carefully.",
      temperature: 0.1,
    });
    totalTokens += estimateTokens(verification);

    const step2 = await mcp.think({
      thought: verification,
      step: 2,
      total: 3,
      guidance: true,
      verify: true,
      domain,
      session_id: sessionId,
    });
    steps++;

    if (step2.meta.checkpoint) checkpoints++;
    if (step2.meta.patterns) {
      risk_flags.push(...(step2.meta.patterns as string[]));
    }

    // Check if still risky after verification
    const stillRisky = (step2.meta.risk_level as string) === "high";

    if (stillRisky) {
      // PHASE 3: High risk even after verification - final check
      const finalCheck = await llm.ask(
        `CRITICAL CHECK for: ${question.question}

Previous attempts flagged as high risk. 

Provide ONLY the numerical/factual answer, nothing else. Double-check before responding.

Answer:`,
        { system: "Give only the answer, nothing else.", temperature: 0.0 }
      );
      totalTokens += estimateTokens(finalCheck);

      await mcp.think({
        thought: finalCheck,
        step: 3,
        total: 3,
        is_final: true,
        domain,
        session_id: sessionId,
      });
      steps++;

      return {
        answer: extractAnswer(finalCheck),
        correct: verifyAnswer(question, extractAnswer(finalCheck)),
        time_ms: Date.now() - start,
        tokens_estimate: totalTokens,
        steps,
        checkpoints,
        risk_flags: [...new Set(risk_flags)],
      };
    }

    // Return verification result
    await mcp.think({
      thought: "Verification complete.",
      step: 3,
      total: 3,
      is_final: true,
      domain,
      session_id: sessionId,
    });
    steps++;

    const answer = extractAnswer(verification);
    return {
      answer,
      correct: verifyAnswer(question, answer),
      time_ms: Date.now() - start,
      tokens_estimate: totalTokens,
      steps,
      checkpoints,
      risk_flags: [...new Set(risk_flags)],
    };

  } finally {
    await mcp.clearSession(sessionId);
  }
}

// ============================================================================
// MAIN BENCHMARK
// ============================================================================

export async function runBenchmark(
  questions: Question[],
  options: { 
    llmConfig?: Partial<LLMConfig>;
    runBaseline?: boolean;
    runTool?: boolean;
    onProgress?: (completed: number, total: number, result: RunResult) => void;
  } = {}
): Promise<BenchmarkResults> {
  const { runBaseline: doBaseline = true, runTool: doTool = true, onProgress } = options;
  const llm = new LLMClient(options.llmConfig);
  
  let mcp: MCPClient | null = null;
  if (doTool) {
    mcp = new MCPClient();
    await mcp.init();
  }

  const results: RunResult[] = [];

  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      console.log(`\n[${i + 1}/${questions.length}] ${q.difficulty}/${q.category}: ${q.question.slice(0, 50)}...`);

      const result: RunResult = {
        question_id: q.id,
        difficulty: q.difficulty,
        category: q.category,
        baseline: { answer: "", correct: false, time_ms: 0, tokens_estimate: 0 },
        with_tool: { answer: "", correct: false, time_ms: 0, tokens_estimate: 0, steps: 0, checkpoints: 0, risk_flags: [] },
      };

      if (doBaseline) {
        console.log("  Running baseline...");
        result.baseline = await runBaseline(llm, q);
        console.log(`  Baseline: ${result.baseline.correct ? "✓" : "✗"} (${result.baseline.time_ms}ms) → "${result.baseline.answer.slice(0, 30)}"`);
      }

      if (doTool && mcp) {
        console.log("  Running with MCP tool...");
        result.with_tool = await runWithTool(llm, mcp, q);
        const flags = result.with_tool.risk_flags.length > 0 ? ` [${result.with_tool.risk_flags.join(",")}]` : "";
        console.log(`  With tool: ${result.with_tool.correct ? "✓" : "✗"} (${result.with_tool.time_ms}ms, ${result.with_tool.steps} steps, ${result.with_tool.checkpoints} checkpoints)${flags} → "${result.with_tool.answer.slice(0, 30)}"`);
      }

      results.push(result);
      onProgress?.(i + 1, questions.length, result);
    }
  } finally {
    if (mcp) {
      await mcp.close();
    }
  }

  const summary = calculateSummary(results);

  return {
    timestamp: new Date().toISOString(),
    model: process.env.LLM_MODEL || "unknown",
    total_questions: questions.length,
    results,
    summary,
  };
}

function calculateSummary(results: RunResult[]): BenchmarkResults["summary"] {
  const baselineCorrect = results.filter(r => r.baseline.correct).length;
  const toolCorrect = results.filter(r => r.with_tool.correct).length;
  const total = results.length;

  const byDifficulty: Record<string, { baseline_accuracy: number; tool_accuracy: number; delta: number }> = {};
  const byCategory: Record<string, { baseline_accuracy: number; tool_accuracy: number; delta: number }> = {};

  const difficulties = [...new Set(results.map(r => r.difficulty))];
  for (const diff of difficulties) {
    const subset = results.filter(r => r.difficulty === diff);
    const baseAcc = subset.filter(r => r.baseline.correct).length / subset.length;
    const toolAcc = subset.filter(r => r.with_tool.correct).length / subset.length;
    byDifficulty[diff] = { baseline_accuracy: baseAcc, tool_accuracy: toolAcc, delta: toolAcc - baseAcc };
  }

  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const subset = results.filter(r => r.category === cat);
    const baseAcc = subset.filter(r => r.baseline.correct).length / subset.length;
    const toolAcc = subset.filter(r => r.with_tool.correct).length / subset.length;
    byCategory[cat] = { baseline_accuracy: baseAcc, tool_accuracy: toolAcc, delta: toolAcc - baseAcc };
  }

  return {
    baseline: {
      correct: baselineCorrect,
      total,
      accuracy: baselineCorrect / total,
      avg_time_ms: results.reduce((sum, r) => sum + r.baseline.time_ms, 0) / total,
    },
    with_tool: {
      correct: toolCorrect,
      total,
      accuracy: toolCorrect / total,
      avg_time_ms: results.reduce((sum, r) => sum + r.with_tool.time_ms, 0) / total,
    },
    by_difficulty: byDifficulty,
    by_category: byCategory,
  };
}

// ============================================================================
// CLI
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  const questionsFile = args[0] || "questions.json";
  const limitArg = args.find(a => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  const baselineOnly = args.includes("--baseline-only");
  const toolOnly = args.includes("--tool-only");

  console.log(`Loading questions from ${questionsFile}...`);
  const file = Bun.file(new URL(questionsFile, import.meta.url).pathname);
  
  if (!await file.exists()) {
    console.error(`Questions file not found: ${questionsFile}`);
    process.exit(1);
  }

  const data = await file.json() as QuestionSet;
  let questions = data.questions;
  
  if (limit) {
    questions = questions.slice(0, limit);
  }

  console.log(`Loaded ${questions.length} questions (${data.description})`);
  console.log(`Model: ${process.env.LLM_MODEL || "unknown"}`);
  console.log(`Mode: ${baselineOnly ? "baseline only" : toolOnly ? "tool only" : "both"}`);

  const results = await runBenchmark(questions, {
    runBaseline: !toolOnly,
    runTool: !baselineOnly,
  });

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(60));
  console.log(`\nModel: ${results.model}`);
  console.log(`Questions: ${results.total_questions}`);
  console.log(`\nOverall Accuracy:`);
  console.log(`  Baseline:  ${(results.summary.baseline.accuracy * 100).toFixed(1)}% (${results.summary.baseline.correct}/${results.summary.baseline.total})`);
  console.log(`  With Tool: ${(results.summary.with_tool.accuracy * 100).toFixed(1)}% (${results.summary.with_tool.correct}/${results.summary.with_tool.total})`);
  console.log(`  Delta:     ${((results.summary.with_tool.accuracy - results.summary.baseline.accuracy) * 100).toFixed(1)}%`);

  console.log(`\nBy Difficulty:`);
  for (const [diff, stats] of Object.entries(results.summary.by_difficulty)) {
    console.log(`  ${diff}: ${(stats.baseline_accuracy * 100).toFixed(0)}% → ${(stats.tool_accuracy * 100).toFixed(0)}% (${stats.delta >= 0 ? "+" : ""}${(stats.delta * 100).toFixed(0)}%)`);
  }

  console.log(`\nBy Category:`);
  for (const [cat, stats] of Object.entries(results.summary.by_category)) {
    console.log(`  ${cat}: ${(stats.baseline_accuracy * 100).toFixed(0)}% → ${(stats.tool_accuracy * 100).toFixed(0)}% (${stats.delta >= 0 ? "+" : ""}${(stats.delta * 100).toFixed(0)}%)`);
  }

  console.log(`\nAvg Time:`);
  console.log(`  Baseline:  ${results.summary.baseline.avg_time_ms.toFixed(0)}ms`);
  console.log(`  With Tool: ${results.summary.with_tool.avg_time_ms.toFixed(0)}ms`);

  // Save results
  const outFile = `results-${Date.now()}.json`;
  await Bun.write(new URL(outFile, import.meta.url).pathname, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outFile}`);
}
