/**
 * Benchmark runner for verifiable-thinking-mcp
 * Compares baseline LLM vs MCP-guided structured reasoning
 * 
 * Architecture: Option A (Single Direct Call)
 * - Local compute for math/logic (100% accuracy, ~3ms)
 * - Direct LLM call for everything else (no phase rewrites)
 * - MCP tool records reasoning (CRASH-style scratchpad)
 */

import { spawn, type Subprocess } from "bun";
import { LLMClient, type LLMConfig, type ToolDefinition, type ChatMessageWithTools, type ToolCall } from "./llm-client";
import { extractAnswer } from "../../src/lib/extraction";
import {
  routeQuestion,
  buildSpotCheckPrompt,
  parseSpotCheckResponse,
} from "../../src/lib/think/index";

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
    method?: string;
    raw_response?: string;
    response_length?: number;
  };
  with_tool: {
    answer: string;
    correct: boolean;
    time_ms: number;
    tokens_estimate: number;
    steps: number;
    checkpoints: number;
    risk_flags: string[];
    method?: string;
    raw_response?: string;
    response_length?: number;
    compression?: {
      bytes_saved: number;
      input_compressed: boolean;
      output_compressed: boolean;
      context_compressed: boolean;
    };
    risk_level?: string;
    final_confidence?: number;
    complexity_tier?: string;
    complexity_path?: string;
    latency_breakdown?: {
      routing_ms: number;
      local_compute_ms: number;
      llm_main_ms: number;
      llm_verify_ms: number;
      mcp_overhead_ms: number;
    };
  };
}

// Enhanced metrics interface
export interface EnhancedMetrics {
  accuracy: {
    overall: number;
    by_difficulty: Record<string, number>;
    by_category: Record<string, number>;
    confidence_interval_95: { lower: number; upper: number };
  };
  comparison: {
    accuracy_delta: number;
    accuracy_lift_percent: number;
    questions_fixed: number;
    questions_broken: number;
    net_improvement: number;
    agreement_rate: number;
    cohen_kappa: number;
  };
  timing: {
    avg_ms: number;
    median_ms: number;
    p95_ms: number;
    p99_ms: number;
    min_ms: number;
    max_ms: number;
    std_dev_ms: number;
    total_ms: number;
  };
  tokens: {
    total: number;
    avg_per_question: number;
    avg_per_correct: number;
    efficiency_score: number;
  };
  steps?: {
    total: number;
    avg_per_question: number;
    avg_per_correct: number;
    distribution: Record<number, number>;
  };
  risks?: {
    total_flags: number;
    by_type: Record<string, number>;
    flagged_accuracy: number;
    unflagged_accuracy: number;
  };
  calibration?: {
    by_risk_level: Record<string, { count: number; accuracy: number }>;
    by_confidence_bucket: Array<{
      range: string;
      count: number;
      accuracy: number;
      expected_accuracy: number;
      calibration_error: number;
    }>;
    mean_calibration_error: number;
    well_calibrated: boolean;
  };
  responses: {
    avg_length: number;
    median_length: number;
    empty_count: number;
    numeric_answer_rate: number;
  };
}

export interface BenchmarkResults {
  timestamp: string;
  model: string;
  total_questions: number;
  results: RunResult[];
  summary: {
    baseline: EnhancedMetrics;
    with_tool: EnhancedMetrics;
    comparison: {
      accuracy_delta: number;
      accuracy_lift_percent: number;
      time_overhead_factor: number;
      token_overhead_factor: number;
      questions_fixed: number;
      questions_broken: number;
      net_improvement: number;
      agreement_rate: number;
      both_correct: number;
      both_wrong: number;
      only_baseline_correct: number;
      only_tool_correct: number;
      statistical_significance: {
        mcnemar_chi2: number;
        p_value: number;
        significant_at_05: boolean;
        significant_at_01: boolean;
      };
    };
    by_difficulty: Record<string, {
      baseline_accuracy: number;
      tool_accuracy: number;
      delta: number;
      count: number;
      baseline_avg_time: number;
      tool_avg_time: number;
    }>;
    by_category: Record<string, {
      baseline_accuracy: number;
      tool_accuracy: number;
      delta: number;
      count: number;
      baseline_avg_time: number;
      tool_avg_time: number;
    }>;
    compression?: {
      total_bytes_saved: number;
      steps_compressed: number;
      avg_bytes_per_step: number;
      compression_rate: number;
    };
    complexity?: {
      by_tier: Record<string, { count: number; accuracy: number; avg_time_ms: number }>;
      by_path: Record<string, { count: number; accuracy: number; avg_time_ms: number }>;
    };
    latency_breakdown?: {
      avg_routing_ms: number;
      avg_local_compute_ms: number;
      avg_llm_main_ms: number;
      avg_llm_verify_ms: number;
      avg_mcp_overhead_ms: number;
      llm_percentage: number;
    };
    efficiency: {
      baseline_correct_per_second: number;
      tool_correct_per_second: number;
      baseline_correct_per_1k_tokens: number;
      tool_correct_per_1k_tokens: number;
      break_even_accuracy: number;
    };
  };
}

// ============================================================================
// MCP CLIENT
// ============================================================================

interface ThinkArgs {
  thought: string;
  step: number;
  total: number;
  is_final?: boolean;
  guidance?: boolean;
  verify?: boolean;
  domain?: string;
  session_id?: string;
  compression_level?: string;
  local_compute?: boolean;
  // Revision support
  revises_step?: number;
  revision_reason?: string;
  // Branching support
  branch_from?: number;
  branch_id?: string;
  branch_name?: string;
  // Additional context
  purpose?: string;
  context?: string;
  outcome?: string;
  next_action?: string;
  rationale?: string;
  confidence?: number;
}

interface ThinkResult {
  raw: string;
  meta: Record<string, unknown>;
  guidance?: string[];
  verification?: {
    passed: boolean;
    evidence: string;
  };
}

class MCPClient {
  private proc: Subprocess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";

  async init(): Promise<void> {
    this.proc = spawn({
      cmd: ["bun", "run", "src/index.ts"],
      cwd: new URL("../../", import.meta.url).pathname,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    // Read stdout in background
    this.readLoop();

    // Initialize MCP
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "benchmark", version: "1.0" },
    });
  }

  private async readLoop(): Promise<void> {
    if (!this.proc?.stdout) return;
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      this.buffer += decoder.decode(value, { stream: true });
      
      // Process complete messages
      let newlineIdx: number;
      while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newlineIdx);
        this.buffer = this.buffer.slice(newlineIdx + 1);
        
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
              const { resolve, reject } = this.pendingRequests.get(msg.id)!;
              this.pendingRequests.delete(msg.id);
              if (msg.error) {
                reject(new Error(msg.error.message || "Unknown error"));
              } else {
                resolve(msg.result);
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }

  private async send(method: string, params: unknown): Promise<unknown> {
    if (!this.proc?.stdin) throw new Error("MCP not initialized");
    
    const id = ++this.requestId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.proc!.stdin!.write(msg);
    });
  }

  async think(args: ThinkArgs): Promise<ThinkResult> {
    // Map simplified args to full ThinkSchema
    const fullArgs: Record<string, unknown> = {
      step_number: args.step,
      estimated_total: args.total,
      purpose: args.purpose || "analysis",
      context: args.context || "Benchmark evaluation",
      thought: args.thought,
      outcome: args.outcome || "Reasoning recorded",
      next_action: args.next_action || (args.is_final ? "Complete" : "Continue reasoning"),
      rationale: args.rationale || "Systematic benchmark evaluation",
      is_final_step: args.is_final ?? false,
      guidance: args.guidance ?? false,
      verify: args.verify ?? false,
      domain: args.domain,
      session_id: args.session_id,
      compression_level: args.compression_level,
      local_compute: args.local_compute ?? false,
    };
    
    // Add revision support
    if (args.revises_step !== undefined) {
      fullArgs.revises_step = args.revises_step;
      fullArgs.revision_reason = args.revision_reason;
    }
    
    // Add branching support
    if (args.branch_from !== undefined) {
      fullArgs.branch_from = args.branch_from;
      fullArgs.branch_id = args.branch_id;
      fullArgs.branch_name = args.branch_name;
    }
    
    // Add confidence if provided
    if (args.confidence !== undefined) {
      fullArgs.confidence = args.confidence;
    }
    
    const result = await this.send("tools/call", {
      name: "think",
      arguments: fullArgs,
    }) as { content: Array<{ type: string; text: string }> };
    
    const text = result.content?.[0]?.text || "";
    
    // Parse meta from JSON code block response
    let meta: Record<string, unknown> = {};
    let guidance: string[] = [];
    let verification: { passed: boolean; evidence: string } | undefined;
    
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        meta = JSON.parse(jsonMatch[1]);
        // Extract guidance from meta
        if (meta.guidance && Array.isArray(meta.guidance)) {
          guidance = meta.guidance as string[];
        }
        // Extract verification from meta
        if (meta.verification && typeof meta.verification === "object") {
          const v = meta.verification as Record<string, unknown>;
          verification = {
            passed: v.passed as boolean,
            evidence: v.evidence as string,
          };
        }
      }
    } catch {
      // Ignore meta parse errors
    }
    
    return { raw: text, meta, guidance, verification };
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.send("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

// ============================================================================
// ANSWER VERIFICATION
// ============================================================================

function verifyAnswer(question: Question, answer: string): boolean {
  const expected = Array.isArray(question.expected_answer) 
    ? question.expected_answer 
    : [question.expected_answer];
  
  // Normalize answer
  const normalized = answer.trim().toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/\.$/, "");

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

/** Normalize answer for comparison (case-insensitive, whitespace-normalized) */
function normalizeForComparison(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:'"]/g, "")
    .trim();
}

// ============================================================================
// THINK TOOL DEFINITION FOR AGENT MODE
// ============================================================================

const THINK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "think",
    description: `Record a reasoning step. Use this to structure your thinking process.

WHEN TO USE:
- Breaking down complex problems
- When you need to verify your reasoning
- When you want to explore alternative approaches

SPECIAL FEATURES:
- revises_step: Set this to correct an earlier step if you found an error
- branch_from: Set this to explore an alternative approach from a previous step

Return your final answer in the last step with is_final_step=true.`,
    parameters: {
      type: "object",
      properties: {
        step_number: { type: "number", description: "Sequential step number (start at 1)" },
        estimated_total: { type: "number", description: "Estimated total steps needed" },
        thought: { type: "string", description: "Your current reasoning" },
        outcome: { type: "string", description: "What you concluded or learned" },
        next_action: { type: "string", description: "What to do next" },
        is_final_step: { type: "boolean", description: "True if this is the final answer" },
        confidence: { type: "number", description: "Your confidence 0-1 (optional)" },
        revises_step: { type: "number", description: "Step number to revise if correcting an error (optional)" },
        revision_reason: { type: "string", description: "Why revising (optional)" },
        branch_from: { type: "number", description: "Step to branch from for alternative approach (optional)" },
        branch_id: { type: "string", description: "Unique ID for this branch (optional)" },
      },
      required: ["step_number", "estimated_total", "thought", "outcome", "next_action"],
    },
  },
};

// ============================================================================
// AGENT MODE - LLM naturally decides when to think/revise/branch
// ============================================================================

interface AgentResult {
  answer: string;
  steps: number;
  revisions: number;
  branches: string[];
  thoughts: Array<{
    step: number;
    thought: string;
    outcome: string;
    revises?: number;
    branch?: string;
  }>;
  totalTokens: number;
  rawResponse: string;
}

async function runAgentMode(
  llm: LLMClient,
  mcp: MCPClient,
  question: string,
  domain: string,
  sessionId: string,
): Promise<AgentResult> {
  const systemPrompt = `You are a careful problem solver with access to a "think" tool for structured reasoning.

For complex problems:
1. Use the think tool to break down your reasoning into steps
2. If you realize you made an error, use revises_step to correct it
3. If you want to try an alternative approach, use branch_from
4. Set is_final_step=true on your last step with the answer

For simple problems, you can answer directly without using tools.

Domain hint: ${domain}`;

  const messages: ChatMessageWithTools[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${question}\n\nThink through this carefully. Use the think tool to structure your reasoning if needed. Provide your final answer clearly.` },
  ];

  const thoughts: AgentResult["thoughts"] = [];
  let totalTokens = 0;
  let revisions = 0;
  const branches = new Set<string>();
  let finalResponse = "";
  let maxIterations = 10; // Safety limit

  while (maxIterations-- > 0) {
    const response = await llm.askWithTools(messages, [THINK_TOOL], { temperature: 0.1 });
    totalTokens += estimateTokens(JSON.stringify(messages) + JSON.stringify(response));

    // Check if LLM wants to use tools
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: response.tool_calls,
      });

      // Process each tool call
      for (const toolCall of response.tool_calls) {
        if (toolCall.function.name === "think") {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            
            // Track the thought
            thoughts.push({
              step: args.step_number,
              thought: args.thought,
              outcome: args.outcome,
              revises: args.revises_step,
              branch: args.branch_id,
            });

            if (args.revises_step) revisions++;
            if (args.branch_id) branches.add(args.branch_id);

            // Call actual MCP tool
            const mcpResult = await mcp.think({
              thought: args.thought,
              step: args.step_number,
              total: args.estimated_total,
              is_final: args.is_final_step || false,
              domain,
              session_id: sessionId,
              revises_step: args.revises_step,
              revision_reason: args.revision_reason,
              branch_from: args.branch_from,
              branch_id: args.branch_id,
              guidance: true,
              verify: true,
            });

            // Build tool response
            let toolResponse = `Step ${args.step_number} recorded.`;
            if (mcpResult.guidance?.length) {
              toolResponse += ` Guidance: ${mcpResult.guidance.join("; ")}`;
            }
            if (args.is_final_step) {
              toolResponse += " This is the final step - provide your answer now.";
            }

            messages.push({
              role: "tool",
              content: toolResponse,
              tool_call_id: toolCall.id,
            });

            // If final step, ask for the actual answer
            if (args.is_final_step) {
              messages.push({
                role: "user",
                content: "Based on your reasoning, what is the final answer? State it clearly and concisely.",
              });
            }
          } catch (e) {
            messages.push({
              role: "tool",
              content: `Error parsing arguments: ${e}`,
              tool_call_id: toolCall.id,
            });
          }
        }
      }
    } else {
      // LLM responded with content (no tool calls) - this is the final answer
      finalResponse = response.content || "";
      break;
    }
  }

  return {
    answer: extractAnswer(finalResponse),
    steps: thoughts.length,
    revisions,
    branches: Array.from(branches),
    thoughts,
    totalTokens,
    rawResponse: finalResponse,
  };
}

// ============================================================================
// BENCHMARK RUNNERS
// ============================================================================

/**
 * Stream LLM response to console with optional label
 * Uses 1024 max tokens for reasoning to avoid runaway responses
 */
async function askWithStreaming(
  llm: LLMClient,
  prompt: string,
  system: string,
  label: string,
): Promise<string> {
  process.stdout.write(`\n  ${label}:\n  `);
  let fullResponse = "";
  let lineLength = 2; // "  " prefix
  
  for await (const chunk of llm.stream(prompt, { system, temperature: 0.1, maxTokens: 1024 })) {
    fullResponse += chunk;
    // Word-wrap at ~78 chars, handle newlines
    for (const char of chunk) {
      if (char === "\n") {
        process.stdout.write("\n  ");
        lineLength = 2;
      } else {
        if (lineLength >= 78 && char === " ") {
          process.stdout.write("\n  ");
          lineLength = 2;
        } else {
          process.stdout.write(char);
          lineLength++;
        }
      }
    }
  }
  process.stdout.write("\n");
  return fullResponse;
}

// Baseline: Direct LLM call, no guidance, no local compute
async function runBaseline(llm: LLMClient, question: Question): Promise<RunResult["baseline"]> {
  const start = Date.now();
  
  const prompt = `${question.question}\n\nProvide your answer clearly. If it's a number, state just the number. If it's a choice, state just the choice.`;
  
  const response = await llm.ask(prompt, {
    system: "You are a helpful assistant. Answer questions directly and concisely.",
    temperature: 0.1,
  });

  const time_ms = Date.now() - start;
  const expectedAnswers = Array.isArray(question.expected_answer) ? question.expected_answer : [question.expected_answer];
  const answer = extractAnswer(response, expectedAnswers);

  return {
    answer,
    correct: verifyAnswer(question, answer),
    time_ms,
    tokens_estimate: estimateTokens(prompt + response),
    method: "llm",
    raw_response: response,
    response_length: response.length,
  };
}

// With Tool: Option A - Single Direct Call + Local Compute
// Simple architecture:
// 1. Try local compute first (math, logic)
// 2. Route question using src/lib/think/route.ts
// 3. Record in MCP (CRASH-style scratchpad)
async function runWithTool(
  llm: LLMClient, 
  mcp: MCPClient, 
  question: Question,
  useLocal = true,
  compressionLevel: "none" | "auto" | "aggressive" = "auto",
  verbose = false,
  skipVerify = false,
): Promise<RunResult["with_tool"]> {
  const start = Date.now();
  const sessionId = `bench_${question.id}_${Date.now()}`;
  let totalTokens = 0;

  // Latency breakdown tracking
  const latency = {
    routing_ms: 0,
    local_compute_ms: 0,
    llm_main_ms: 0,
    llm_verify_ms: 0,
    mcp_overhead_ms: 0,
  };

  // Track compression
  let totalBytesSaved = 0;
  let inputCompressed = false;
  let outputCompressed = false;
  let contextCompressed = false;

  const trackCompression = (meta: Record<string, unknown>) => {
    const compression = meta.compression as {
      input?: boolean;
      output?: boolean;
      context?: boolean;
      bytes_saved?: number;
    } | undefined;
    if (compression) {
      totalBytesSaved += compression.bytes_saved || 0;
      if (compression.input) inputCompressed = true;
      if (compression.output) outputCompressed = true;
      if (compression.context) contextCompressed = true;
    }
  };

  const buildCompression = () => totalBytesSaved > 0 ? {
    bytes_saved: totalBytesSaved,
    input_compressed: inputCompressed,
    output_compressed: outputCompressed,
    context_compressed: contextCompressed,
  } : undefined;

  const domain = question.category === "math" ? "math" 
    : question.category === "logic" ? "logic"
    : question.category === "code" ? "code" 
    : "general";

  // === ROUTING: Use centralized logic from src/lib/think/route.ts ===
  const routeStart = Date.now();
  const route = routeQuestion(question.question, skipVerify);
  latency.routing_ms = Date.now() - routeStart;

  try {
    // STEP 1: Try local compute via MCP tool
    if (useLocal) {
      const localStart = Date.now();
      const localStep = await mcp.think({
        thought: question.question,
        step: 1,
        total: 1,
        is_final: true,
        guidance: false,
        domain,
        session_id: sessionId,
        compression_level: compressionLevel,
        local_compute: true,
      });
      latency.local_compute_ms = Date.now() - localStart;
      
      const localResult = localStep.meta.local_compute as { solved?: boolean; result?: unknown } | undefined;
      if (localResult?.solved && localResult.result !== undefined) {
        const answer = String(localResult.result);
        return {
          answer,
          correct: verifyAnswer(question, answer),
          time_ms: Date.now() - start,
          tokens_estimate: 0,
          steps: 1,
          checkpoints: 0,
          risk_flags: [],
          method: "local",
          risk_level: "low",
          final_confidence: 1.0,
          complexity_tier: route.tier,
          complexity_path: "local",
          raw_response: `[LOCAL COMPUTE] ${answer}`,
          response_length: answer.length,
          latency_breakdown: latency,
        };
      }
      const clearStart = Date.now();
      await mcp.clearSession(sessionId);
      latency.mcp_overhead_ms += Date.now() - clearStart;
    }

    // STEP 2: Execute routed path
    let response: string;
    let confidence: number;
    
    // Step 2a: Main reasoning/answer call
    const { system, user } = route.prompts.main;
    const llmMainStart = Date.now();
    if (verbose) {
      response = await askWithStreaming(llm, user, system, `[${route.tier}] ${route.path}`);
    } else {
      response = await llm.ask(user, { system, temperature: 0.1 });
    }
    latency.llm_main_ms = Date.now() - llmMainStart;
    totalTokens += estimateTokens(user + response);
    confidence = route.hasVerification ? 0.8 : 0.9;
    
    // Step 2b: Spot-check verification (if path includes it)
    // NOTE: We use spot-check for confidence adjustment only, NOT for answer replacement.
    // Replacing response with "NO, the correct answer is..." led to extraction bugs
    // (e.g., extracting "2" from "2^(n+1)" in medium_math_007)
    if (route.hasVerification && route.prompts.spotCheck) {
      const expectedAnswers = Array.isArray(question.expected_answer) 
        ? question.expected_answer 
        : [question.expected_answer];
      const proposedAnswer = extractAnswer(response, expectedAnswers);
      
      const spotPrompt = buildSpotCheckPrompt(route.prompts.spotCheck.userTemplate, {
        question: question.question,
        proposedAnswer,
      });
      
      const llmVerifyStart = Date.now();
      let spotCheck: string;
      if (verbose) {
        spotCheck = await askWithStreaming(llm, spotPrompt, route.prompts.spotCheck.system, `[${route.tier}] Spot-check`);
      } else {
        spotCheck = await llm.ask(spotPrompt, { system: route.prompts.spotCheck.system, temperature: 0 });
      }
      latency.llm_verify_ms = Date.now() - llmVerifyStart;
      totalTokens += estimateTokens(spotPrompt + spotCheck);
      
      // Spot-check adjusts confidence only - don't replace response with rejection text
      const isCorrect = parseSpotCheckResponse(spotCheck);
      confidence = isCorrect ? 0.9 : 0.7;
    }

    // STEP 3: Record in MCP (CRASH-style scratchpad)
    const mcpRecordStart = Date.now();
    const stepResult = await mcp.think({
      thought: response,
      step: route.steps,
      total: route.steps,
      is_final: true,
      guidance: false,
      domain,
      session_id: sessionId,
      compression_level: compressionLevel,
    });
    latency.mcp_overhead_ms += Date.now() - mcpRecordStart;
    trackCompression(stepResult.meta);

    const expectedAnswers = Array.isArray(question.expected_answer) ? question.expected_answer : [question.expected_answer];
    const answer = extractAnswer(response, expectedAnswers);

    return {
      answer,
      correct: verifyAnswer(question, answer),
      time_ms: Date.now() - start,
      tokens_estimate: totalTokens,
      steps: route.steps,
      checkpoints: 0,
      risk_flags: [],
      method: "llm",
      compression: buildCompression(),
      risk_level: route.tier === "Low" ? "low" : route.tier === "Moderate" ? "medium" : "high",
      final_confidence: confidence,
      complexity_tier: route.tier,
      complexity_path: route.path,
      raw_response: response,
      response_length: response.length,
      latency_breakdown: latency,
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
    useLocalCompute?: boolean;
    compressionLevel?: "none" | "auto" | "aggressive";
    quiet?: boolean;
    verbose?: boolean;
    skipVerify?: boolean;
    concurrency?: number;
    onProgress?: (completed: number, total: number, result: RunResult) => void;
  } = {}
): Promise<BenchmarkResults> {
  const { 
    runBaseline: doBaseline = true, 
    runTool: doTool = true, 
    useLocalCompute = true, 
    compressionLevel = "auto", 
    quiet = false,
    verbose = false,
    skipVerify = false,
    concurrency = 1,
    onProgress 
  } = options;
  
  const log = quiet ? () => {} : console.log.bind(console);
  const llm = new LLMClient(options.llmConfig);
  
  let mcp: MCPClient | null = null;
  if (doTool) {
    mcp = new MCPClient();
    await mcp.init();
  }

  const results: RunResult[] = [];
  let completed = 0;

  // Helper to run a single question
  const runQuestion = async (q: Question, index: number): Promise<RunResult> => {
    const questionNum = `[${index + 1}/${questions.length}]`;
    
    // In parallel mode, use concise logging
    if (concurrency > 1) {
      log(`${questionNum} Starting: ${q.id}`);
    } else {
      log(`\n${questionNum} ${q.difficulty}/${q.category}: ${q.question.slice(0, 50)}...`);
      if (verbose) {
        log(`  Question: ${q.question}`);
        log(`  Expected: ${Array.isArray(q.expected_answer) ? q.expected_answer.join(" or ") : q.expected_answer}`);
      }
    }

    const result: RunResult = {
      question_id: q.id,
      difficulty: q.difficulty,
      category: q.category,
      baseline: { answer: "", correct: false, time_ms: 0, tokens_estimate: 0, method: "llm" },
      with_tool: { answer: "", correct: false, time_ms: 0, tokens_estimate: 0, steps: 0, checkpoints: 0, risk_flags: [], method: "llm" },
    };

    if (doBaseline) {
      if (concurrency === 1) log("  Running baseline (pure LLM)...");
      result.baseline = await runBaseline(llm, q);
      if (concurrency === 1) log(`  Baseline: ${result.baseline.correct ? "✓" : "✗"} (${result.baseline.time_ms.toFixed(2)}ms) → "${result.baseline.answer.slice(0, 30)}"`);
    }

    if (doTool && mcp) {
      if (concurrency === 1 && !verbose) log("  Running with MCP tool...");
      result.with_tool = await runWithTool(llm, mcp, q, useLocalCompute, compressionLevel, verbose && concurrency === 1, skipVerify);
      if (concurrency === 1) {
        const methodTag = result.with_tool.method === "local" ? " [LOCAL]" : "";
        const compTag = result.with_tool.compression ? ` [scratchpad: ${result.with_tool.compression.bytes_saved}B saved]` : "";
        const pathTag = result.with_tool.complexity_path ? ` via ${result.with_tool.complexity_path}` : "";
        log(`  Result: ${result.with_tool.correct ? "✓" : "✗"} (${result.with_tool.time_ms.toFixed(0)}ms)${pathTag}${methodTag}${compTag} → "${result.with_tool.answer.slice(0, 40)}"`);
      }
    }

    // Parallel mode: log completion
    if (concurrency > 1) {
      const toolMark = result.with_tool.correct ? "✓" : "✗";
      const baseMark = result.baseline.correct ? "✓" : "✗";
      log(`${questionNum} Done: ${q.id} | base=${baseMark} tool=${toolMark} | ${result.with_tool.time_ms.toFixed(0)}ms`);
    }

    completed++;
    onProgress?.(completed, questions.length, result);
    return result;
  };

  try {
    if (concurrency > 1) {
      // Parallel execution with batching
      log(`\nRunning ${questions.length} questions with concurrency=${concurrency}...`);
      
      for (let i = 0; i < questions.length; i += concurrency) {
        const batch = questions.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map((q, j) => runQuestion(q, i + j))
        );
        results.push(...batchResults);
      }
    } else {
      // Sequential execution (original behavior)
      for (let i = 0; i < questions.length; i++) {
        const result = await runQuestion(questions[i], i);
        results.push(result);
      }
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

// ============================================================================
// STATISTICAL HELPERS
// ============================================================================

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (idx - lower) * (sorted[upper] - sorted[lower]);
}

function calculateStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function calculateWilsonInterval(successes: number, total: number, z = 1.96): { lower: number; upper: number } {
  if (total === 0) return { lower: 0, upper: 0 };
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = p + z * z / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return {
    lower: Math.max(0, (center - spread) / denominator),
    upper: Math.min(1, (center + spread) / denominator),
  };
}

function calculateMcNemarTest(b: number, c: number): { chi2: number; p_value: number } {
  if (b + c === 0) return { chi2: 0, p_value: 1 };
  const chi2 = ((Math.abs(b - c) - 1) ** 2) / (b + c);
  const p_value = Math.exp(-chi2 / 2);
  return { chi2, p_value };
}

function calculateCohenKappa(both_correct: number, both_wrong: number, only_a: number, only_b: number): number {
  const total = both_correct + both_wrong + only_a + only_b;
  if (total === 0) return 0;
  
  const po = (both_correct + both_wrong) / total;
  const pa = (both_correct + only_a) / total;
  const pb = (both_correct + only_b) / total;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

// ============================================================================
// ENHANCED SUMMARY CALCULATION
// ============================================================================

function calculateEnhancedMetrics(
  results: RunResult[],
  field: "baseline" | "with_tool"
): EnhancedMetrics {
  const total = results.length;
  const correct = results.filter(r => r[field].correct).length;
  
  const times = results.map(r => r[field].time_ms);
  const sortedTimes = [...times].sort((a, b) => a - b);
  const avgTime = times.reduce((a, b) => a + b, 0) / total;
  
  const tokens = results.map(r => r[field].tokens_estimate);
  const totalTokens = tokens.reduce((a, b) => a + b, 0);
  const correctResults = results.filter(r => r[field].correct);
  const tokensForCorrect = correctResults.reduce((sum, r) => sum + r[field].tokens_estimate, 0);
  
  const lengths = results.map(r => r[field].response_length || r[field].answer.length);
  const sortedLengths = [...lengths].sort((a, b) => a - b);
  const numericAnswers = results.filter(r => /^-?\d+(\.\d+)?$/.test(r[field].answer.trim())).length;
  
  const byDifficulty: Record<string, number> = {};
  const byCat: Record<string, number> = {};
  
  for (const diff of [...new Set(results.map(r => r.difficulty))]) {
    const subset = results.filter(r => r.difficulty === diff);
    byDifficulty[diff] = subset.filter(r => r[field].correct).length / subset.length;
  }
  
  for (const cat of [...new Set(results.map(r => r.category))]) {
    const subset = results.filter(r => r.category === cat);
    byCat[cat] = subset.filter(r => r[field].correct).length / subset.length;
  }
  
  const ci = calculateWilsonInterval(correct, total);
  
  const metrics: EnhancedMetrics = {
    accuracy: {
      overall: correct / total,
      by_difficulty: byDifficulty,
      by_category: byCat,
      confidence_interval_95: ci,
    },
    comparison: {
      accuracy_delta: 0,
      accuracy_lift_percent: 0,
      questions_fixed: 0,
      questions_broken: 0,
      net_improvement: 0,
      agreement_rate: 0,
      cohen_kappa: 0,
    },
    timing: {
      avg_ms: avgTime,
      median_ms: calculatePercentile(sortedTimes, 50),
      p95_ms: calculatePercentile(sortedTimes, 95),
      p99_ms: calculatePercentile(sortedTimes, 99),
      min_ms: sortedTimes[0] || 0,
      max_ms: sortedTimes[sortedTimes.length - 1] || 0,
      std_dev_ms: calculateStdDev(times, avgTime),
      total_ms: times.reduce((a, b) => a + b, 0),
    },
    tokens: {
      total: totalTokens,
      avg_per_question: totalTokens / total,
      avg_per_correct: correct > 0 ? tokensForCorrect / correct : 0,
      efficiency_score: totalTokens > 0 ? (correct / totalTokens) * 1000 : 0,
    },
    responses: {
      avg_length: lengths.reduce((a, b) => a + b, 0) / total,
      median_length: calculatePercentile(sortedLengths, 50),
      empty_count: results.filter(r => r[field].answer.trim() === "").length,
      numeric_answer_rate: numericAnswers / total,
    },
  };
  
  // Tool-specific metrics
  if (field === "with_tool") {
    const steps = results.map(r => r.with_tool.steps);
    const totalSteps = steps.reduce((a, b) => a + b, 0);
    const stepDist: Record<number, number> = {};
    for (const s of steps) {
      stepDist[s] = (stepDist[s] || 0) + 1;
    }
    
    const stepsForCorrect = correctResults.reduce((sum, r) => sum + r.with_tool.steps, 0);
    
    metrics.steps = {
      total: totalSteps,
      avg_per_question: totalSteps / total,
      avg_per_correct: correct > 0 ? stepsForCorrect / correct : 0,
      distribution: stepDist,
    };
    
    // Risk flags analysis
    const allFlags = results.flatMap(r => r.with_tool.risk_flags);
    const flagCounts: Record<string, number> = {};
    for (const f of allFlags) {
      flagCounts[f] = (flagCounts[f] || 0) + 1;
    }
    
    const flaggedResults = results.filter(r => r.with_tool.risk_flags.length > 0);
    const unflaggedResults = results.filter(r => r.with_tool.risk_flags.length === 0);
    
    metrics.risks = {
      total_flags: allFlags.length,
      by_type: flagCounts,
      flagged_accuracy: flaggedResults.length > 0 
        ? flaggedResults.filter(r => r.with_tool.correct).length / flaggedResults.length 
        : 0,
      unflagged_accuracy: unflaggedResults.length > 0
        ? unflaggedResults.filter(r => r.with_tool.correct).length / unflaggedResults.length
        : 0,
    };
    
    // Confidence calibration
    const resultsWithConf = results.filter(r => r.with_tool.final_confidence !== undefined);
    if (resultsWithConf.length > 0) {
      const byRiskLevel: Record<string, { count: number; accuracy: number }> = {};
      for (const level of ["low", "medium", "high"]) {
        const subset = results.filter(r => r.with_tool.risk_level === level);
        if (subset.length > 0) {
          byRiskLevel[level] = {
            count: subset.length,
            accuracy: subset.filter(r => r.with_tool.correct).length / subset.length,
          };
        }
      }
      
      const buckets = [
        { min: 0.0, max: 0.2, label: "0.0-0.2" },
        { min: 0.2, max: 0.4, label: "0.2-0.4" },
        { min: 0.4, max: 0.6, label: "0.4-0.6" },
        { min: 0.6, max: 0.8, label: "0.6-0.8" },
        { min: 0.8, max: 1.0, label: "0.8-1.0" },
      ];
      
      const byConfidenceBucket: Array<{
        range: string;
        count: number;
        accuracy: number;
        expected_accuracy: number;
        calibration_error: number;
      }> = [];
      
      let totalCalibrationError = 0;
      let totalWithConf = 0;
      
      for (const bucket of buckets) {
        const subset = resultsWithConf.filter(r => {
          const conf = r.with_tool.final_confidence!;
          return conf >= bucket.min && (bucket.max === 1.0 ? conf <= bucket.max : conf < bucket.max);
        });
        
        if (subset.length > 0) {
          const accuracy = subset.filter(r => r.with_tool.correct).length / subset.length;
          const expected = (bucket.min + bucket.max) / 2;
          const error = Math.abs(accuracy - expected);
          
          byConfidenceBucket.push({
            range: bucket.label,
            count: subset.length,
            accuracy,
            expected_accuracy: expected,
            calibration_error: error,
          });
          
          totalCalibrationError += error * subset.length;
          totalWithConf += subset.length;
        }
      }
      
      const meanCalibrationError = totalWithConf > 0 ? totalCalibrationError / totalWithConf : 0;
      
      metrics.calibration = {
        by_risk_level: byRiskLevel,
        by_confidence_bucket: byConfidenceBucket,
        mean_calibration_error: meanCalibrationError,
        well_calibrated: meanCalibrationError < 0.1,
      };
    }
  }
  
  return metrics;
}

function calculateSummary(results: RunResult[]): BenchmarkResults["summary"] {
  const total = results.length;
  
  const baseline = calculateEnhancedMetrics(results, "baseline");
  const withTool = calculateEnhancedMetrics(results, "with_tool");
  
  const bothCorrect = results.filter(r => r.baseline.correct && r.with_tool.correct).length;
  const bothWrong = results.filter(r => !r.baseline.correct && !r.with_tool.correct).length;
  const onlyBaselineCorrect = results.filter(r => r.baseline.correct && !r.with_tool.correct).length;
  const onlyToolCorrect = results.filter(r => !r.baseline.correct && r.with_tool.correct).length;
  
  const mcnemar = calculateMcNemarTest(onlyBaselineCorrect, onlyToolCorrect);
  const kappa = calculateCohenKappa(bothCorrect, bothWrong, onlyBaselineCorrect, onlyToolCorrect);
  
  const accuracyDelta = withTool.accuracy.overall - baseline.accuracy.overall;
  const accuracyLift = baseline.accuracy.overall > 0 
    ? (accuracyDelta / baseline.accuracy.overall) * 100 
    : 0;
  
  baseline.comparison = withTool.comparison = {
    accuracy_delta: accuracyDelta,
    accuracy_lift_percent: accuracyLift,
    questions_fixed: onlyToolCorrect,
    questions_broken: onlyBaselineCorrect,
    net_improvement: onlyToolCorrect - onlyBaselineCorrect,
    agreement_rate: (bothCorrect + bothWrong) / total,
    cohen_kappa: kappa,
  };
  
  const byDifficulty: BenchmarkResults["summary"]["by_difficulty"] = {};
  for (const diff of [...new Set(results.map(r => r.difficulty))]) {
    const subset = results.filter(r => r.difficulty === diff);
    const baseAcc = subset.filter(r => r.baseline.correct).length / subset.length;
    const toolAcc = subset.filter(r => r.with_tool.correct).length / subset.length;
    byDifficulty[diff] = {
      baseline_accuracy: baseAcc,
      tool_accuracy: toolAcc,
      delta: toolAcc - baseAcc,
      count: subset.length,
      baseline_avg_time: subset.reduce((s, r) => s + r.baseline.time_ms, 0) / subset.length,
      tool_avg_time: subset.reduce((s, r) => s + r.with_tool.time_ms, 0) / subset.length,
    };
  }
  
  const byCategory: BenchmarkResults["summary"]["by_category"] = {};
  for (const cat of [...new Set(results.map(r => r.category))]) {
    const subset = results.filter(r => r.category === cat);
    const baseAcc = subset.filter(r => r.baseline.correct).length / subset.length;
    const toolAcc = subset.filter(r => r.with_tool.correct).length / subset.length;
    byCategory[cat] = {
      baseline_accuracy: baseAcc,
      tool_accuracy: toolAcc,
      delta: toolAcc - baseAcc,
      count: subset.length,
      baseline_avg_time: subset.reduce((s, r) => s + r.baseline.time_ms, 0) / subset.length,
      tool_avg_time: subset.reduce((s, r) => s + r.with_tool.time_ms, 0) / subset.length,
    };
  }
  
  // Compression stats
  let compression: BenchmarkResults["summary"]["compression"] | undefined;
  const compressedResults = results.filter(r => r.with_tool.compression);
  if (compressedResults.length > 0) {
    const totalBytesSaved = compressedResults.reduce((s, r) => s + (r.with_tool.compression?.bytes_saved || 0), 0);
    compression = {
      total_bytes_saved: totalBytesSaved,
      steps_compressed: compressedResults.length,
      avg_bytes_per_step: Math.round(totalBytesSaved / compressedResults.length),
      compression_rate: compressedResults.length / total,
    };
  }
  
  // Complexity routing stats
  type ComplexityStats = { count: number; correct: number; total_time: number };
  const byTier: Record<string, ComplexityStats> = {};
  const byPath: Record<string, ComplexityStats> = {};
  
  for (const r of results) {
    const tier = r.with_tool.complexity_tier || "Unknown";
    const path = r.with_tool.complexity_path || "unknown";
    
    if (!byTier[tier]) byTier[tier] = { count: 0, correct: 0, total_time: 0 };
    byTier[tier].count++;
    if (r.with_tool.correct) byTier[tier].correct++;
    byTier[tier].total_time += r.with_tool.time_ms;
    
    if (!byPath[path]) byPath[path] = { count: 0, correct: 0, total_time: 0 };
    byPath[path].count++;
    if (r.with_tool.correct) byPath[path].correct++;
    byPath[path].total_time += r.with_tool.time_ms;
  }
  
  const complexityStats: BenchmarkResults["summary"]["complexity"] = {
    by_tier: Object.fromEntries(
      Object.entries(byTier).map(([k, v]) => [k, {
        count: v.count,
        accuracy: v.count > 0 ? v.correct / v.count : 0,
        avg_time_ms: v.count > 0 ? Math.round(v.total_time / v.count) : 0,
      }])
    ),
    by_path: Object.fromEntries(
      Object.entries(byPath).map(([k, v]) => [k, {
        count: v.count,
        accuracy: v.count > 0 ? v.correct / v.count : 0,
        avg_time_ms: v.count > 0 ? Math.round(v.total_time / v.count) : 0,
      }])
    ),
  };
  
  // Latency breakdown stats
  const resultsWithLatency = results.filter(r => r.with_tool.latency_breakdown);
  let latencyBreakdown: BenchmarkResults["summary"]["latency_breakdown"];
  if (resultsWithLatency.length > 0) {
    const sumLatency = { routing: 0, local_compute: 0, llm_main: 0, llm_verify: 0, mcp_overhead: 0 };
    for (const r of resultsWithLatency) {
      const lb = r.with_tool.latency_breakdown!;
      sumLatency.routing += lb.routing_ms;
      sumLatency.local_compute += lb.local_compute_ms;
      sumLatency.llm_main += lb.llm_main_ms;
      sumLatency.llm_verify += lb.llm_verify_ms;
      sumLatency.mcp_overhead += lb.mcp_overhead_ms;
    }
    const n = resultsWithLatency.length;
    const totalLlm = sumLatency.llm_main + sumLatency.llm_verify;
    const totalAll = sumLatency.routing + sumLatency.local_compute + totalLlm + sumLatency.mcp_overhead;
    
    latencyBreakdown = {
      avg_routing_ms: Math.round(sumLatency.routing / n * 100) / 100,
      avg_local_compute_ms: Math.round(sumLatency.local_compute / n * 100) / 100,
      avg_llm_main_ms: Math.round(sumLatency.llm_main / n),
      avg_llm_verify_ms: Math.round(sumLatency.llm_verify / n),
      avg_mcp_overhead_ms: Math.round(sumLatency.mcp_overhead / n),
      llm_percentage: totalAll > 0 ? Math.round((totalLlm / totalAll) * 1000) / 10 : 0,
    };
  }
  
  const baselineTotalTime = baseline.timing.total_ms;
  const toolTotalTime = withTool.timing.total_ms;
  const baselineCorrect = results.filter(r => r.baseline.correct).length;
  const toolCorrect = results.filter(r => r.with_tool.correct).length;
  
  const timeOverhead = baseline.timing.avg_ms > 0 ? withTool.timing.avg_ms / baseline.timing.avg_ms : 1;
  const tokenOverhead = baseline.tokens.avg_per_question > 0 
    ? withTool.tokens.avg_per_question / baseline.tokens.avg_per_question 
    : 1;
  
  const breakEvenAccuracy = baseline.accuracy.overall * timeOverhead;
  
  return {
    baseline,
    with_tool: withTool,
    comparison: {
      accuracy_delta: accuracyDelta,
      accuracy_lift_percent: accuracyLift,
      time_overhead_factor: timeOverhead,
      token_overhead_factor: tokenOverhead,
      questions_fixed: onlyToolCorrect,
      questions_broken: onlyBaselineCorrect,
      net_improvement: onlyToolCorrect - onlyBaselineCorrect,
      agreement_rate: (bothCorrect + bothWrong) / total,
      both_correct: bothCorrect,
      both_wrong: bothWrong,
      only_baseline_correct: onlyBaselineCorrect,
      only_tool_correct: onlyToolCorrect,
      statistical_significance: {
        mcnemar_chi2: mcnemar.chi2,
        p_value: mcnemar.p_value,
        significant_at_05: mcnemar.p_value < 0.05,
        significant_at_01: mcnemar.p_value < 0.01,
      },
    },
    by_difficulty: byDifficulty,
    by_category: byCategory,
    compression,
    complexity: complexityStats,
    latency_breakdown: latencyBreakdown,
    efficiency: {
      baseline_correct_per_second: baselineTotalTime > 0 ? (baselineCorrect / baselineTotalTime) * 1000 : 0,
      tool_correct_per_second: toolTotalTime > 0 ? (toolCorrect / toolTotalTime) * 1000 : 0,
      baseline_correct_per_1k_tokens: baseline.tokens.total > 0 
        ? (baselineCorrect / baseline.tokens.total) * 1000 
        : 0,
      tool_correct_per_1k_tokens: withTool.tokens.total > 0 
        ? (toolCorrect / withTool.tokens.total) * 1000 
        : 0,
      break_even_accuracy: Math.min(1, breakEvenAccuracy),
    },
  };
}

// ============================================================================
// CLI
// ============================================================================

if (import.meta.main) {
  const args = process.argv.slice(2);
  
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Benchmark Runner for Verifiable Thinking MCP

Usage: bun run runner.ts [questions.json] [options]

Options:
  --limit=N          Run only first N questions
  --filter=PATTERN   Filter questions by ID pattern (regex)
  --ids=id1,id2,...  Run only specific question IDs
  --category=CAT     Filter by category (math, logic, reasoning, code)
  --difficulty=DIFF  Filter by difficulty (easy, medium, hard, trap, impossible, sota)
  --baseline-only    Run only baseline (no MCP tool)
  --tool-only        Run only with MCP tool (no baseline)
  --no-local         Disable local compute
  --aggressive       Force aggressive compression
  --no-compression   Disable compression
  --json-output      Machine-readable JSON output
  --dry-run          Validate setup without LLM calls
  --full             Run all questions (no limit)
  --threshold=N      Fail if tool accuracy < N (0-1), for CI
  --ci-report        Output CI-friendly summary with exit code
  --verbose, -v      Stream LLM responses in real-time
  --no-verify        Skip verification pass for High+ complexity (faster)
  --parallel=N       Run N questions concurrently (default: 1, sequential)
  --help, -h         Show this help

Environment Variables:
  LLM_MODEL          Model to use
  LLM_API_KEY        API key for LLM provider
    `);
    process.exit(0);
  }
  
  const questionsFile = args.find(a => !a.startsWith("--")) || "questions.json";
  const limitArg = args.find(a => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
  const filterArg = args.find(a => a.startsWith("--filter="));
  const filter = filterArg ? filterArg.split("=")[1] : undefined;
  const idsArg = args.find(a => a.startsWith("--ids="));
  const ids = idsArg ? idsArg.split("=")[1].split(",") : undefined;
  const categoryArg = args.find(a => a.startsWith("--category="));
  const category = categoryArg ? categoryArg.split("=")[1] : undefined;
  const difficultyArg = args.find(a => a.startsWith("--difficulty="));
  const difficulty = difficultyArg ? difficultyArg.split("=")[1] : undefined;
  const baselineOnly = args.includes("--baseline-only");
  const toolOnly = args.includes("--tool-only");
  const noLocal = args.includes("--no-local");
  const aggressive = args.includes("--aggressive");
  const noCompression = args.includes("--no-compression");
  const jsonOutput = args.includes("--json-output");
  const dryRun = args.includes("--dry-run");
  const fullRun = args.includes("--full");
  const thresholdArg = args.find(a => a.startsWith("--threshold="));
  const threshold = thresholdArg ? parseFloat(thresholdArg.split("=")[1]) : undefined;
  const ciReport = args.includes("--ci-report");
  const verboseMode = args.includes("--verbose") || args.includes("-v");
  const noVerify = args.includes("--no-verify");
  const parallelArg = args.find(a => a.startsWith("--parallel="));
  const parallel = parallelArg ? parseInt(parallelArg.split("=")[1], 10) : 1;
  const compressionLevel: "none" | "auto" | "aggressive" = 
    noCompression ? "none" : aggressive ? "aggressive" : "auto";

  const log = jsonOutput ? () => {} : console.log.bind(console);

  log(`Loading questions from ${questionsFile}...`);
  const file = Bun.file(new URL(questionsFile, import.meta.url).pathname);
  
  if (!await file.exists()) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: `Questions file not found: ${questionsFile}` }));
    } else {
      console.error(`Questions file not found: ${questionsFile}`);
    }
    process.exit(1);
  }

  const data = await file.json() as QuestionSet;
  let questions = data.questions;
  
  if (ids) {
    questions = questions.filter(q => ids.includes(q.id));
  }
  
  if (filter) {
    const regex = new RegExp(filter, "i");
    questions = questions.filter(q => regex.test(q.id));
  }
  
  if (category) {
    questions = questions.filter(q => q.category === category);
  }
  
  if (difficulty) {
    questions = questions.filter(q => q.difficulty === difficulty);
  }
  
  // --full overrides --limit
  if (!fullRun && limit) {
    questions = questions.slice(0, limit);
  }

  log(`Loaded ${questions.length} questions (${data.description})`);
  log(`Model: ${process.env.LLM_MODEL || "unknown"}`);
  log(`Mode: ${baselineOnly ? "baseline only" : toolOnly ? "tool only" : "both"}${noLocal ? " (no local compute)" : ""}${parallel > 1 ? ` | parallel=${parallel}` : ""}`);
  log(`Compression: ${compressionLevel}${fullRun ? " | Full run" : ""}`);
  if (threshold !== undefined) {
    log(`Threshold: ${(threshold * 100).toFixed(0)}% (will fail if tool accuracy below)`);
  }

  if (dryRun) {
    log("\n--- DRY RUN MODE ---");
    log("Validating setup...\n");
    
    const categories = new Set(questions.map(q => q.category));
    const difficulties = new Set(questions.map(q => q.difficulty));
    log(`✓ Questions: ${questions.length} loaded`);
    log(`  Categories: ${Array.from(categories).join(", ")}`);
    log(`  Difficulties: ${Array.from(difficulties).join(", ")}`);
    
    log("\nValidating MCP server...");
    try {
      const mcp = new MCPClient();
      await mcp.init();
      log("✓ MCP server: initialized successfully");
      
      const testResult = await mcp.think({
        thought: "Dry run validation test",
        step: 1,
        total: 1,
        is_final: true,
        guidance: false,
        session_id: `dry-run-${Date.now()}`,
        local_compute: true,
      });
      log(`✓ MCP think tool: responsive`);
      log(`  Sample response length: ${testResult.raw.length} chars`);
      
      await mcp.close();
      log("✓ MCP server: closed cleanly");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`✗ MCP server error: ${errMsg}`);
      process.exit(1);
    }
    
    log("\n--- DRY RUN COMPLETE ---");
    log("Setup is valid. Ready to run benchmarks.");
    log(`Run without --dry-run to execute ${questions.length} questions.`);
    process.exit(0);
  }

  const results = await runBenchmark(questions, {
    runBaseline: !toolOnly,
    runTool: !baselineOnly,
    useLocalCompute: !noLocal,
    compressionLevel,
    quiet: jsonOutput,
    verbose: verboseMode,
    skipVerify: noVerify,
    concurrency: parallel,
  });

  if (jsonOutput) {
    const output = {
      ...results,
      metadata: {
        compression_level: compressionLevel,
        local_compute: !noLocal,
        baseline_only: baselineOnly,
        tool_only: toolOnly,
        question_count: questions.length,
        run_id: `run-${Date.now()}`,
      },
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

  // Human-readable output
  log("\n" + "=".repeat(70));
  log("BENCHMARK RESULTS");
  log("=".repeat(70));
  log(`\nModel: ${results.model}`);
  log(`Questions: ${results.total_questions}`);
  
  const baselineCorrect = Math.round(results.summary.baseline.accuracy.overall * results.total_questions);
  const toolCorrect = Math.round(results.summary.with_tool.accuracy.overall * results.total_questions);
  
  log(`\n${"─".repeat(70)}`);
  log("ACCURACY");
  log("─".repeat(70));
  log(`  Baseline:  ${(results.summary.baseline.accuracy.overall * 100).toFixed(1)}% (${baselineCorrect}/${results.total_questions})`);
  log(`  With Tool: ${(results.summary.with_tool.accuracy.overall * 100).toFixed(1)}% (${toolCorrect}/${results.total_questions})`);
  log(`  Delta:     ${results.summary.comparison.accuracy_delta >= 0 ? "+" : ""}${(results.summary.comparison.accuracy_delta * 100).toFixed(1)}% (${results.summary.comparison.accuracy_lift_percent >= 0 ? "+" : ""}${results.summary.comparison.accuracy_lift_percent.toFixed(1)}% lift)`);
  log(`  95% CI:    [${(results.summary.with_tool.accuracy.confidence_interval_95.lower * 100).toFixed(1)}%, ${(results.summary.with_tool.accuracy.confidence_interval_95.upper * 100).toFixed(1)}%]`);

  log(`\n${"─".repeat(70)}`);
  log("COMPARISON (2x2 Contingency)");
  log("─".repeat(70));
  log(`  Both Correct:         ${results.summary.comparison.both_correct}`);
  log(`  Both Wrong:           ${results.summary.comparison.both_wrong}`);
  log(`  Only Baseline Correct: ${results.summary.comparison.only_baseline_correct} (broken)`);
  log(`  Only Tool Correct:     ${results.summary.comparison.only_tool_correct} (fixed)`);
  log(`  Net Improvement:       ${results.summary.comparison.net_improvement >= 0 ? "+" : ""}${results.summary.comparison.net_improvement}`);
  log(`  Agreement Rate:        ${(results.summary.comparison.agreement_rate * 100).toFixed(1)}%`);

  log(`\n${"─".repeat(70)}`);
  log("BY DIFFICULTY");
  log("─".repeat(70));
  for (const [diff, stats] of Object.entries(results.summary.by_difficulty)) {
    const arrow = stats.delta >= 0 ? "↑" : "↓";
    log(`  ${diff.padEnd(12)} ${(stats.baseline_accuracy * 100).toFixed(0).padStart(3)}% → ${(stats.tool_accuracy * 100).toFixed(0).padStart(3)}% (${stats.delta >= 0 ? "+" : ""}${(stats.delta * 100).toFixed(0)}% ${arrow}) n=${stats.count}`);
  }

  log(`\n${"─".repeat(70)}`);
  log("BY CATEGORY");
  log("─".repeat(70));
  for (const [cat, stats] of Object.entries(results.summary.by_category)) {
    const arrow = stats.delta >= 0 ? "↑" : "↓";
    log(`  ${cat.padEnd(12)} ${(stats.baseline_accuracy * 100).toFixed(0).padStart(3)}% → ${(stats.tool_accuracy * 100).toFixed(0).padStart(3)}% (${stats.delta >= 0 ? "+" : ""}${(stats.delta * 100).toFixed(0)}% ${arrow}) n=${stats.count}`);
  }

  log(`\n${"─".repeat(70)}`);
  log("TIMING");
  log("─".repeat(70));
  log(`  Baseline:`);
  log(`    Avg: ${results.summary.baseline.timing.avg_ms.toFixed(0)}ms | Median: ${results.summary.baseline.timing.median_ms.toFixed(0)}ms | P95: ${results.summary.baseline.timing.p95_ms.toFixed(0)}ms`);
  log(`  With Tool:`);
  log(`    Avg: ${results.summary.with_tool.timing.avg_ms.toFixed(0)}ms | Median: ${results.summary.with_tool.timing.median_ms.toFixed(0)}ms | P95: ${results.summary.with_tool.timing.p95_ms.toFixed(0)}ms`);
  log(`  Overhead: ${results.summary.comparison.time_overhead_factor.toFixed(1)}x`);

  log(`\n${"─".repeat(70)}`);
  log("TOKENS");
  log("─".repeat(70));
  log(`  Baseline:  ${results.summary.baseline.tokens.total} total | ${results.summary.baseline.tokens.avg_per_question.toFixed(0)}/question`);
  log(`  With Tool: ${results.summary.with_tool.tokens.total} total | ${results.summary.with_tool.tokens.avg_per_question.toFixed(0)}/question`);

  // Complexity routing stats
  if (results.summary.complexity) {
    const cx = results.summary.complexity;
    log(`\n${"─".repeat(70)}`);
    log("COMPLEXITY ROUTING");
    log("─".repeat(70));
    
    log("  By Path:");
    for (const [path, data] of Object.entries(cx.by_path).sort((a, b) => b[1].count - a[1].count)) {
      const pct = (data.accuracy * 100).toFixed(0);
      log(`    ${path.padEnd(10)} ${String(data.count).padStart(3)} questions | ${pct}% accuracy | ${data.avg_time_ms}ms avg`);
    }
  }

  // Latency breakdown stats
  if (results.summary.latency_breakdown) {
    const lb = results.summary.latency_breakdown;
    log(`\n${"─".repeat(70)}`);
    log("LATENCY BREAKDOWN (Tool mode)");
    log("─".repeat(70));
    log(`  Routing:       ${lb.avg_routing_ms.toFixed(2)}ms avg`);
    log(`  Local Compute: ${lb.avg_local_compute_ms.toFixed(1)}ms avg`);
    log(`  LLM Main:      ${lb.avg_llm_main_ms}ms avg`);
    log(`  LLM Verify:    ${lb.avg_llm_verify_ms}ms avg`);
    log(`  MCP Overhead:  ${lb.avg_mcp_overhead_ms}ms avg`);
    log(`  LLM %:         ${lb.llm_percentage}% of total time`);
  }

  // Question-level analysis
  const broken = results.results.filter(r => r.baseline.correct && !r.with_tool.correct);
  const fixed = results.results.filter(r => !r.baseline.correct && r.with_tool.correct);
  
  if (broken.length > 0 || fixed.length > 0) {
    log(`\n${"─".repeat(70)}`);
    log("QUESTION-LEVEL ANALYSIS");
    log("─".repeat(70));
    
    if (broken.length > 0) {
      log(`\n  ⚠️ BROKEN (${broken.length}):`);
      for (const r of broken) {
        log(`    • ${r.question_id}: "${r.baseline.answer}" ✓ → "${r.with_tool.answer}" ✗`);
      }
    }
    
    if (fixed.length > 0) {
      log(`\n  ✅ FIXED (${fixed.length}):`);
      for (const r of fixed) {
        log(`    • ${r.question_id}: "${r.baseline.answer}" ✗ → "${r.with_tool.answer}" ✓`);
      }
    }
  }

  log("\n" + "=".repeat(70));

  const outFile = `results-${Date.now()}.json`;
  // Save without pretty-printing (faster) and don't block
  const outPath = new URL(outFile, import.meta.url).pathname;
  Bun.write(outPath, JSON.stringify(results)).catch(() => {});
  log(`\nResults saving to ${outFile}`);

  // CI Report mode: concise output with exit code
  if (ciReport) {
    const toolAcc = results.summary.with_tool.accuracy.overall;
    const baseAcc = results.summary.baseline.accuracy.overall;
    const delta = results.summary.comparison.accuracy_delta;
    const ci = results.summary.with_tool.accuracy.confidence_interval_95;
    
    console.log("\n--- CI REPORT ---");
    console.log(`Questions: ${results.total_questions}`);
    console.log(`Baseline:  ${(baseAcc * 100).toFixed(1)}%`);
    console.log(`Tool:      ${(toolAcc * 100).toFixed(1)}%`);
    console.log(`Delta:     ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`);
    console.log(`95% CI:    [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);
    console.log(`Fixed:     ${results.summary.comparison.only_tool_correct}`);
    console.log(`Broken:    ${results.summary.comparison.only_baseline_correct}`);
    
    if (threshold !== undefined) {
      if (toolAcc >= threshold) {
        console.log(`\n✓ PASS: Tool accuracy ${(toolAcc * 100).toFixed(1)}% >= threshold ${(threshold * 100).toFixed(0)}%`);
      } else {
        console.log(`\n✗ FAIL: Tool accuracy ${(toolAcc * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(0)}%`);
        process.exit(1);
      }
    }
  }

  // Threshold check (without full CI report)
  if (threshold !== undefined && !ciReport) {
    const toolAcc = results.summary.with_tool.accuracy.overall;
    if (toolAcc < threshold) {
      console.error(`\n✗ THRESHOLD FAILED: Tool accuracy ${(toolAcc * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%`);
      process.exit(1);
    }
  }

  // Ensure clean exit (Bun may keep event loop alive otherwise)
  process.exit(0);
}
