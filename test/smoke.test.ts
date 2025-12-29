/**
 * Smoke tests for verifiable-thinking-mcp
 * Spawns server via stdio and validates JSON-RPC responses for each tool
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Subprocess, spawn } from "bun";

const TIMEOUT_MS = 10_000;

/** Helper to create think tool args with new rich schema */
function thinkArgs(opts: {
  thought: string;
  step: number;
  total: number;
  session_id?: string;
  domain?: string;
  verify?: boolean;
  guidance?: boolean;
  is_final?: boolean;
  branch_id?: string;
  purpose?: string;
  context?: string;
  outcome?: string;
  next_action?: string;
  rationale?: string;
  baseline?: boolean;
  local_compute?: boolean;
}) {
  return {
    step_number: opts.step,
    estimated_total: opts.total,
    purpose: opts.purpose || "analysis",
    context: opts.context || "Testing reasoning",
    thought: opts.thought,
    outcome: opts.outcome || "Step completed",
    next_action: opts.next_action || "Continue",
    rationale: opts.rationale || "To progress the analysis",
    is_final_step: opts.is_final || false,
    verify: opts.verify,
    domain: opts.domain,
    guidance: opts.guidance,
    session_id: opts.session_id,
    branch_id: opts.branch_id,
    baseline: opts.baseline,
    local_compute: opts.local_compute,
  };
}

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
  error?: { code: number; message: string; data?: unknown };
}

class MCPClient {
  private proc: Subprocess<"pipe", "pipe", "inherit">;
  private buffer = "";
  private requestId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor() {
    this.proc = spawn({
      cmd: ["bun", "run", "src/index.ts"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
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
        reject(new Error(`Request ${method} timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.proc.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  async close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

// Helper to extract JSON from streamed response (may be in code block)
function extractJson(text: string): Record<string, unknown> | null {
  // Try to extract from code block first
  const codeBlockMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      /* fall through */
    }
  }
  // Try to parse directly
  try {
    return JSON.parse(text);
  } catch {
    // Try to find JSON object in text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

describe("MCP Server Smoke Tests", () => {
  let client: MCPClient;

  beforeAll(async () => {
    client = new MCPClient();
    await Bun.sleep(500); // Wait for server startup
  });

  afterAll(async () => {
    await client.close();
  });

  test("should initialize with correct server info", async () => {
    const response = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBeDefined();
    expect(result.serverInfo?.name).toBe("Verifiable Thinking MCP");
  });

  test("should list all 5 tools", async () => {
    const response = await client.request("tools/list");

    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);

    expect(names).toContain("think");
    expect(names).toContain("list_sessions");
    expect(names).toContain("get_session");
    expect(names).toContain("clear_session");
    expect(names).toContain("compress");
    expect(result.tools).toHaveLength(5);
  });

  test("should list 6 prompts", async () => {
    const response = await client.request("prompts/list");

    expect(response.error).toBeUndefined();
    const result = response.result as { prompts: Array<{ name: string }> };
    const names = result.prompts.map((p) => p.name);

    expect(names).toContain("mathematical-proof");
    expect(names).toContain("logical-deduction");
    expect(names).toContain("code-review");
    expect(names).toContain("debugging");
    expect(names).toContain("problem-decomposition");
    expect(names).toContain("comparative-analysis");
    expect(result.prompts).toHaveLength(6);
  });

  test("should execute think tool with verification", async () => {
    const response = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Testing: 2 + 2 = 4",
        step: 1,
        total: 1,
        verify: true,
        domain: "math",
        session_id: "smoke-test",
      }),
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  test("should list sessions including smoke-test", async () => {
    const response = await client.request("tools/call", {
      name: "list_sessions",
      arguments: {},
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(Array.isArray(result.content)).toBe(true);
    const text = result.content[0]?.text || "";
    expect(text).toContain("smoke-test");
  });

  test("should get session details", async () => {
    const response = await client.request("tools/call", {
      name: "get_session",
      arguments: {
        session_id: "smoke-test",
        format: "summary",
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(Array.isArray(result.content)).toBe(true);
  });

  test("should compress context with CPC", async () => {
    const response = await client.request("tools/call", {
      name: "compress",
      arguments: {
        context:
          "The quick brown fox jumps over the lazy dog. This is a test sentence. Another sentence here for compression testing. Final sentence.",
        query: "fox jumps",
        target_ratio: 0.5,
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(Array.isArray(result.content)).toBe(true);
    const text = result.content[0]?.text || "";
    expect(text).toMatch(/Compression|reduction/i);
  });

  test("should list resources", async () => {
    const response = await client.request("resources/list");

    expect(response.error).toBeUndefined();
    const result = response.result as { resources: Array<{ uri: string; name: string }> };
    expect(Array.isArray(result.resources)).toBe(true);
    // Should have at least the sessions list resource
    expect(result.resources.some((r) => r.uri === "session://list")).toBe(true);
  });

  test("should list resource templates", async () => {
    const response = await client.request("resources/templates/list");

    expect(response.error).toBeUndefined();
    const result = response.result as {
      resourceTemplates: Array<{ uriTemplate: string; name: string }>;
    };
    expect(Array.isArray(result.resourceTemplates)).toBe(true);
    expect(result.resourceTemplates.length).toBe(3);
  });

  test("should clear session", async () => {
    const response = await client.request("tools/call", {
      name: "clear_session",
      arguments: {
        session_id: "smoke-test",
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(Array.isArray(result.content)).toBe(true);
  });
});

describe("MCP Tools Integration Tests", () => {
  let client: MCPClient;

  beforeAll(async () => {
    client = new MCPClient();
    await Bun.sleep(500);
    // Initialize
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "1.0.0" },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  test("think tool: multi-step reasoning chain", async () => {
    const sessionId = "integration-chain-test";

    // Step 1: Define the problem
    const step1 = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Problem: Prove that the sum of first n natural numbers equals n(n+1)/2",
        step: 1,
        total: 3,
        verify: true,
        domain: "math",
        session_id: sessionId,
      }),
    });
    expect(step1.error).toBeUndefined();
    const step1Text = (step1.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const step1Data = extractJson(step1Text);
    expect(step1Data).not.toBeNull();
    expect(step1Data?.step).toBe("1/3");

    // Step 2: Base case
    const step2 = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought:
          "Base case: For n=1, sum = 1 and formula gives 1(1+1)/2 = 1. Therefore base case holds.",
        step: 2,
        total: 3,
        verify: true,
        domain: "math",
        session_id: sessionId,
      }),
    });
    expect(step2.error).toBeUndefined();
    const step2Data = extractJson(
      (step2.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(step2Data?.step).toBe("2/3");

    // Step 3: Inductive step
    const step3 = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought:
          "Inductive step: Assume true for k. Then sum(k+1) = k(k+1)/2 + (k+1) = (k+1)(k+2)/2. QED.",
        step: 3,
        total: 3,
        is_final: true,
        domain: "math",
        session_id: sessionId,
      }),
    });
    expect(step3.error).toBeUndefined();
    const step3Data = extractJson(
      (step3.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(step3Data?.step).toBe("3/3");
    expect(step3Data?.status).toBe("complete");

    // Verify session has all 3 thoughts
    const session = await client.request("tools/call", {
      name: "get_session",
      arguments: { session_id: sessionId, format: "summary" },
    });
    const summaryText =
      (session.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(summaryText).toContain("Thoughts: 3");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("think tool: branching exploration", async () => {
    const sessionId = "integration-branch-test";

    // Main branch thought
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Approach A: Use dynamic programming for optimal substructure",
        step: 1,
        total: 2,
        domain: "code",
        session_id: sessionId,
        branch_id: "main",
      }),
    });

    // Alternative branch
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Approach B: Use greedy algorithm for local optimization",
        step: 1,
        total: 2,
        domain: "code",
        session_id: sessionId,
        branch_id: "alternative",
      }),
    });

    // Check both branches exist
    const session = await client.request("tools/call", {
      name: "get_session",
      arguments: { session_id: sessionId, format: "full" },
    });
    const fullText =
      (session.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(fullText).toContain("main");
    expect(fullText).toContain("alternative");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("think tool: verification with different domains", async () => {
    const domains = [
      { domain: "math", thought: "Calculate: (3 + 5) * 2 = 16" },
      {
        domain: "logic",
        thought: "If A implies B, and A is true, then B must be true (modus ponens)",
      },
      {
        domain: "code",
        thought: "function factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); }",
      },
      {
        domain: "general",
        thought:
          "The hypothesis requires further empirical validation through controlled experiments.",
      },
    ];

    for (const { domain, thought } of domains) {
      const response = await client.request("tools/call", {
        name: "think",
        arguments: thinkArgs({
          thought,
          step: 1,
          total: 1,
          verify: true,
          domain,
          session_id: `domain-test-${domain}`,
        }),
      });

      expect(response.error).toBeUndefined();
      const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
      // Response contains JSON metadata (streamed thought goes separately to client)
      const data = extractJson(text);
      expect(data).not.toBeNull();
      expect(data?.session_id).toBe(`domain-test-${domain}`);

      // Cleanup
      await client.request("tools/call", {
        name: "clear_session",
        arguments: { session_id: `domain-test-${domain}` },
      });
    }
  });

  test("compress tool: preserves relevant content", async () => {
    const context = `
      Step 1: Initialize the cache with empty state.
      Step 2: For each request, check if result exists in cache.
      Step 3: If cache hit, return cached result immediately.
      Step 4: If cache miss, compute the result and store it.
      Step 5: Implement TTL-based eviction for memory management.
      Step 6: Add statistics tracking for cache performance.
    `.trim();

    const response = await client.request("tools/call", {
      name: "compress",
      arguments: {
        context,
        query: "cache hit return result",
        target_ratio: 0.4,
        boost_reasoning: true,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";

    // Should contain compression stats
    expect(text).toMatch(/\d+%/); // Has percentage

    // Most relevant sentence should be preserved
    expect(text.toLowerCase()).toContain("cache");
  });

  test("compress tool: handles edge cases", async () => {
    // Empty context
    const emptyResponse = await client.request("tools/call", {
      name: "compress",
      arguments: {
        context: "",
        query: "test",
        target_ratio: 0.5,
      },
    });
    expect(emptyResponse.error).toBeUndefined();

    // Single sentence (no compression needed)
    const singleResponse = await client.request("tools/call", {
      name: "compress",
      arguments: {
        context: "A single sentence about algorithms.",
        query: "algorithms",
        target_ratio: 0.5,
      },
    });
    expect(singleResponse.error).toBeUndefined();
    const singleText =
      (singleResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(singleText).toContain("algorithms");
  });

  test("get_session tool: different formats", async () => {
    const sessionId = "format-test";

    // Create a session with thoughts
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "First thought with detailed reasoning about the problem domain.",
        step: 1,
        total: 2,
        domain: "general",
        session_id: sessionId,
      }),
    });
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Second thought building on previous analysis.",
        step: 2,
        total: 2,
        is_final: true,
        domain: "general",
        session_id: sessionId,
      }),
    });

    // Test summary format
    const summary = await client.request("tools/call", {
      name: "get_session",
      arguments: { session_id: sessionId, format: "summary" },
    });
    const summaryText =
      (summary.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(summaryText).toContain("Thoughts: 2");

    // Test compressed format
    const compressed = await client.request("tools/call", {
      name: "get_session",
      arguments: { session_id: sessionId, format: "compressed" },
    });
    const compressedText =
      (compressed.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(compressedText.length).toBeGreaterThan(0);

    // Test full format
    const full = await client.request("tools/call", {
      name: "get_session",
      arguments: { session_id: sessionId, format: "full" },
    });
    const fullText = (full.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(fullText).toContain("First thought");
    expect(fullText).toContain("Second thought");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("get_session tool: branch filtering", async () => {
    const sessionId = "branch-filter-test";

    // Create thoughts on different branches
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Main branch thought about approach A",
        step: 1,
        total: 1,
        session_id: sessionId,
        branch_id: "main",
      }),
    });
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Experimental branch thought about approach B",
        step: 1,
        total: 1,
        session_id: sessionId,
        branch_id: "experimental",
      }),
    });

    // Get only experimental branch
    const branchOnly = await client.request("tools/call", {
      name: "get_session",
      arguments: { session_id: sessionId, branch_id: "experimental", format: "full" },
    });
    const branchText =
      (branchOnly.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(branchText).toContain("approach B");
    expect(branchText).not.toContain("approach A");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("list_sessions tool: reflects session state", async () => {
    // Create a unique session
    const uniqueId = `list-test-${Date.now()}`;
    await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Test thought for list verification",
        step: 1,
        total: 1,
        session_id: uniqueId,
      }),
    });

    // Verify it appears in list (may be truncated in display)
    const afterCreate = await client.request("tools/call", {
      name: "list_sessions",
      arguments: {},
    });
    const afterText =
      (afterCreate.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    // Session ID may be truncated, check for prefix
    expect(afterText).toContain("list-test-");

    // Clear and verify removal
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: uniqueId },
    });

    const afterClear = await client.request("tools/call", {
      name: "list_sessions",
      arguments: {},
    });
    const afterClearText =
      (afterClear.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    // After clearing, should not contain our prefix anymore (or fewer instances)
    const beforeCount = (afterText.match(/list-test-/g) || []).length;
    const afterCount = (afterClearText.match(/list-test-/g) || []).length;
    expect(afterCount).toBeLessThan(beforeCount);
  });

  test("think tool: guidance and pattern detection", async () => {
    const sessionId = "guidance-test";

    // Thought with premature conclusion pattern
    // NOTE: Must be >200 chars for premature_conclusion, >100 chars for overconfident_complex
    const response = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought:
          "Let me think about this problem carefully. We need to consider all the factors involved in this calculation. After much deliberation and consideration of the various approaches, the answer is obviously 42, so we're clearly done here. This is trivially correct.",
        step: 1,
        total: 1,
        guidance: true,
        domain: "math",
        session_id: sessionId,
      }),
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    // Should detect patterns
    expect(data).not.toBeNull();
    expect(data?.patterns).toBeDefined();
    expect(Array.isArray(data?.patterns)).toBe(true);
    // Should detect overconfident_complex or premature_conclusion
    const patterns = data?.patterns as string[];
    expect(
      patterns.some((p) => p === "overconfident_complex" || p === "premature_conclusion"),
    ).toBe(true);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("think tool: risk assessment", async () => {
    const sessionId = "risk-test";

    // High-risk thought with multiple patterns
    const response = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought:
          "Obviously, if we assume all values are never negative, then therefore the answer is clearly 100.",
        step: 1,
        total: 1,
        guidance: true,
        session_id: sessionId,
      }),
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    // Should have risk assessment
    expect(data).not.toBeNull();
    expect(data?.risk_level).toBeDefined();
    expect(["low", "medium", "high"]).toContain(data?.risk_level as string);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("think tool: baseline mode bypasses all features", async () => {
    const sessionId = "baseline-test";

    // Math problem that would trigger local compute if not baseline
    const response = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "Calculate: 2 + 2 = 4. Obviously this is trivially correct.",
        step: 1,
        total: 1,
        domain: "math",
        session_id: sessionId,
        baseline: true, // Should bypass everything
      }),
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    // Should have baseline flag
    expect(data).not.toBeNull();
    expect(data?.baseline).toBe(true);

    // Should NOT have any of these features
    expect(data?.local_compute).toBeUndefined();
    expect(data?.verified).toBeUndefined();
    expect(data?.patterns).toBeUndefined();
    expect(data?.risk_level).toBeUndefined();
    expect(data?.checkpoint).toBeUndefined();

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("think tool: local_compute requires explicit opt-in", async () => {
    const sessionId = "local-compute-test";

    // Math problem without local_compute flag
    const withoutFlag = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "What is 17 + 28?",
        step: 1,
        total: 1,
        domain: "math",
        session_id: sessionId,
        guidance: false,
      }),
    });

    const withoutText =
      (withoutFlag.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const withoutData = extractJson(withoutText);
    expect(withoutData?.local_compute).toBeUndefined();

    // Clear for next test
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });

    // Math problem WITH local_compute flag
    const withFlag = await client.request("tools/call", {
      name: "think",
      arguments: thinkArgs({
        thought: "What is 17 + 28?",
        step: 1,
        total: 1,
        domain: "math",
        session_id: `${sessionId}-with`,
        guidance: false,
        local_compute: true,
      }),
    });

    const withText =
      (withFlag.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const withData = extractJson(withText);
    expect(withData?.local_compute).toBeDefined();
    const localCompute = withData?.local_compute as {
      solved: boolean;
      result: number;
      method: string;
    };
    expect(localCompute.solved).toBe(true);
    expect(localCompute.result).toBe(45);
    expect(localCompute.method).toBe("arithmetic");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: `${sessionId}-with` },
    });
  });
});
