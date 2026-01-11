/**
 * Smoke tests for verifiable-thinking-mcp
 * Spawns server via stdio and validates JSON-RPC responses for each tool
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Subprocess, spawn } from "bun";

const TIMEOUT_MS = 10_000;

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

    expect(names).toContain("scratchpad");
    expect(names).toContain("list_sessions");
    expect(names).toContain("get_session");
    expect(names).toContain("clear_session");
    expect(names).toContain("compress");
    expect(result.tools).toHaveLength(5);
  });

  // NOTE: Prompts disabled in index.ts until opencode supports prompts/get
  // FastMCP doesn't register prompts/list when no prompts are added
  test.skip("should list prompts (disabled until opencode supports them)", async () => {
    const response = await client.request("prompts/list");

    expect(response.error).toBeUndefined();
    const result = response.result as { prompts: Array<{ name: string }> };
    expect(result.prompts).toHaveLength(0);
  });

  test("should execute scratchpad step operation", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Testing: 2 + 2 = 4",
        purpose: "analysis",
        verify: true,
        domain: "math",
        session_id: "smoke-test",
      },
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

describe("Scratchpad Tool Integration Tests", () => {
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

  test("scratchpad: multi-step reasoning chain with auto-increment", async () => {
    const sessionId = "integration-chain-test";

    // Step 1: Define the problem (auto-incremented to step 1)
    const step1 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Problem: Prove that the sum of first n natural numbers equals n(n+1)/2",
        purpose: "analysis",
        verify: true,
        domain: "math",
        session_id: sessionId,
        confidence: 0.7,
      },
    });
    expect(step1.error).toBeUndefined();
    const step1Text = (step1.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const step1Data = extractJson(step1Text);
    expect(step1Data).not.toBeNull();
    expect(step1Data?.current_step).toBe(1);
    // Status can be "continue" or "review" depending on confidence vs threshold
    expect(["continue", "review"]).toContain(step1Data?.status as string);

    // Step 2: Base case (auto-incremented to step 2)
    // Note: verify=false to avoid false positive from chained equals heuristic
    const step2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Base case: For n=1, sum = 1 and formula gives 1(1+1)/2 = 1. ✓",
        purpose: "validation",
        verify: false, // Chained equals triggers false positive
        domain: "math",
        session_id: sessionId,
        confidence: 0.85,
      },
    });
    expect(step2.error).toBeUndefined();
    const step2Text = (step2.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const step2Data = extractJson(step2Text);
    expect(step2Data?.current_step).toBe(2);
    // Chain confidence should be average of 0.7 and 0.85 = 0.775
    expect(step2Data?.chain_confidence as number).toBeGreaterThan(0.7);

    // Step 3: Inductive step (auto-incremented to step 3)
    // Note: verify=false to avoid false positive from chained equals heuristic
    const step3 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought:
          "Inductive step: Assume true for k. For k+1: sum(1..k+1) = sum(1..k) + (k+1) = k(k+1)/2 + (k+1) = (k+1)(k+2)/2. ✓",
        purpose: "validation",
        verify: false, // Chained equals triggers false positive
        domain: "math",
        session_id: sessionId,
        confidence: 0.9,
      },
    });
    expect(step3.error).toBeUndefined();
    const step3Text = (step3.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const step3Data = extractJson(step3Text);
    expect(step3Data?.current_step).toBe(3);

    // Complete the chain
    const complete = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        summary: "Proof by induction complete",
        final_answer: "The formula n(n+1)/2 is proven correct for all natural numbers.",
      },
    });
    expect(complete.error).toBeUndefined();
    const completeText =
      (complete.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const completeData = extractJson(completeText);
    expect(completeData?.status).toBe("complete");
    expect(completeData?.total_steps).toBe(3);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: navigate operation views history", async () => {
    const sessionId = "navigate-test";

    // Create some steps
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "First analysis step",
        purpose: "analysis",
        session_id: sessionId,
        confidence: 0.6,
      },
    });
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Second exploration step",
        purpose: "exploration",
        session_id: sessionId,
        confidence: 0.75,
      },
    });

    // Navigate: view history
    const historyResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "history",
        session_id: sessionId,
        limit: 10,
      },
    });
    expect(historyResponse.error).toBeUndefined();
    const historyText =
      (historyResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const historyData = extractJson(historyText);
    expect(historyData?.history).toBeDefined();
    expect(Array.isArray(historyData?.history)).toBe(true);
    expect((historyData?.history as unknown[]).length).toBe(2);

    // Navigate: view branches
    const branchesResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "branches",
        session_id: sessionId,
      },
    });
    expect(branchesResponse.error).toBeUndefined();
    const branchesText =
      (branchesResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const branchesData = extractJson(branchesText);
    expect(branchesData?.branches).toBeDefined();
    expect(Array.isArray(branchesData?.branches)).toBe(true);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: branch operation creates alternative path", async () => {
    const sessionId = "branch-test";

    // Create initial step
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Initial approach: Try direct calculation",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    // Branch from step 1
    const branchResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "branch",
        from_step: 1,
        branch_name: "Alternative: Recursive approach",
        thought: "Try recursive definition instead",
        purpose: "exploration",
        session_id: sessionId,
      },
    });
    expect(branchResponse.error).toBeUndefined();
    const branchText =
      (branchResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const branchData = extractJson(branchText);
    expect(branchData?.operation).toBe("branch");
    expect(branchData?.branch).toContain("branch-");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: verification failure halts and provides recovery options", async () => {
    const sessionId = "verify-fail-test";

    // Create a step that will fail verification (unbalanced parentheses)
    const failedStep = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Calculate ((x + 1) * 2", // Missing closing paren - will fail
        purpose: "analysis",
        verify: true,
        domain: "math",
        session_id: sessionId,
      },
    });
    expect(failedStep.error).toBeUndefined();
    const failedText =
      (failedStep.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const failedData = extractJson(failedText);

    // Should have verification_failed status
    expect(failedData?.status).toBe("verification_failed");
    expect(failedData?.verification_failure).toBeDefined();
    const recoveryOptions = (failedData?.verification_failure as Record<string, unknown>)
      ?.recovery_options as Record<string, unknown>;
    expect(recoveryOptions).toBeDefined();
    expect(recoveryOptions?.revise).toBeDefined();
    expect(recoveryOptions?.branch).toBeDefined();
    expect(recoveryOptions?.override).toBeDefined();

    // Step should NOT be stored (current_step should be 0)
    expect(failedData?.current_step).toBe(0);

    // Now use override to force commit the step
    const overrideResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "override",
        acknowledge: true,
        reason: "Testing override functionality - parenthesis is intentional",
        failed_step: 1,
        session_id: sessionId,
      },
    });
    expect(overrideResponse.error).toBeUndefined();
    const overrideText =
      (overrideResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const overrideData = extractJson(overrideText);

    // Should now be stored
    expect(overrideData?.operation).toBe("override");
    expect(overrideData?.current_step).toBe(1);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: verification failure recovery via revise", async () => {
    const sessionId = "verify-revise-test";

    // Create a step that will fail verification
    const failedStep = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Calculate (x + 1] * 2", // Mismatched brackets - will fail
        purpose: "analysis",
        verify: true,
        domain: "math",
        session_id: sessionId,
      },
    });
    const failedData = extractJson(
      (failedStep.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(failedData?.status).toBe("verification_failed");

    // Use revise to fix the failed step
    const reviseResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "revise",
        target_step: 1,
        reason: "Fix bracket mismatch",
        thought: "Calculate (x + 1) * 2", // Fixed version
        session_id: sessionId,
        confidence: 0.9,
      },
    });
    expect(reviseResponse.error).toBeUndefined();
    const reviseData = extractJson(
      (reviseResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should have stored the revision at step 1 (replacing the failed step)
    expect(reviseData?.operation).toBe("revise");
    expect(reviseData?.current_step).toBe(1);
    expect(reviseData?.status).not.toBe("verification_failed");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: auto-verification enables after 3 steps", async () => {
    const sessionId = "auto-verify-test";

    // Steps 1-3: no auto-verification (chain length < 3 before each)
    for (let i = 1; i <= 3; i++) {
      await client.request("tools/call", {
        name: "scratchpad",
        arguments: {
          operation: "step",
          thought: `Step ${i}: Valid reasoning here`,
          purpose: "analysis",
          session_id: sessionId,
          // Don't set verify - should NOT auto-enable for first 3 steps
        },
      });
    }

    // Step 4: should auto-verify (chain now has 3 steps)
    // Use a thought that will PASS verification
    const step4 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Step 4: Therefore the conclusion follows logically from the premises",
        purpose: "decision",
        domain: "logic",
        session_id: sessionId,
        // Don't set verify - should auto-enable
      },
    });
    const step4Text = (step4.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const step4Data = extractJson(step4Text);

    // Should have verification object (proves auto-verify ran)
    expect(step4Data?.verification).toBeDefined();
    expect((step4Data?.verification as Record<string, unknown>)?.passed).toBe(true);

    // Step should succeed
    expect(step4Data?.current_step).toBe(4);
    expect(step4Data?.status).not.toBe("verification_failed");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: verify=false disables auto-verification", async () => {
    const sessionId = "disable-auto-verify-test";

    // Create 3 steps to enable auto-verification threshold
    for (let i = 1; i <= 3; i++) {
      await client.request("tools/call", {
        name: "scratchpad",
        arguments: {
          operation: "step",
          thought: `Step ${i}: Setup`,
          purpose: "analysis",
          session_id: sessionId,
        },
      });
    }

    // Step 4 with verify=false - should NOT auto-verify
    // Use a thought that would fail verification if checked
    const step4 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Calculate ((x + 1) * 2", // Would fail - unbalanced parens
        purpose: "analysis",
        domain: "math",
        verify: false, // Explicitly disable
        session_id: sessionId,
      },
    });
    const step4Text = (step4.result as { content: Array<{ text: string }> }).content[0]?.text || "";

    // Should NOT have auto-verification message
    expect(step4Text).not.toContain("Auto-verification enabled");

    // Step should succeed (verification disabled)
    const step4Data = extractJson(step4Text);
    expect(step4Data?.current_step).toBe(4);
    expect(step4Data?.status).not.toBe("verification_failed");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: revise operation corrects earlier step", async () => {
    const sessionId = "revise-test";

    // Create initial steps
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "2 + 2 = 5 (mistake)",
        purpose: "analysis",
        session_id: sessionId,
      },
    });
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Therefore result is 5",
        purpose: "decision",
        session_id: sessionId,
      },
    });

    // Revise step 1
    const reviseResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "revise",
        target_step: 1,
        reason: "Arithmetic error",
        thought: "2 + 2 = 4 (corrected)",
        confidence: 0.95,
        session_id: sessionId,
      },
    });
    expect(reviseResponse.error).toBeUndefined();
    const reviseText =
      (reviseResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const reviseData = extractJson(reviseText);
    expect(reviseData?.operation).toBe("revise");
    expect(reviseData?.current_step).toBe(3); // Revision creates new step

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: confidence threshold triggers warning", async () => {
    const sessionId = "threshold-test";

    // Add high-confidence steps to reach threshold
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "High confidence step 1",
        purpose: "analysis",
        session_id: sessionId,
        confidence: 0.85,
        confidence_threshold: 0.8,
      },
    });

    const step2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "High confidence step 2",
        purpose: "validation",
        session_id: sessionId,
        confidence: 0.9,
        confidence_threshold: 0.8,
      },
    });
    const step2Text = (step2.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const step2Data = extractJson(step2Text);

    // Chain confidence should be (0.85 + 0.9) / 2 = 0.875, which exceeds 0.8 threshold
    expect(step2Data?.status).toBe("threshold_reached");
    expect(step2Data?.auto_complete_warning).toBeDefined();

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: local_compute with step operation", async () => {
    const sessionId = "local-compute-test";

    // Math problem WITH local_compute flag
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "What is 17 + 28?",
        purpose: "analysis",
        domain: "math",
        session_id: sessionId,
        local_compute: true,
      },
    });

    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);
    expect(data?.local_compute).toBeDefined();
    const localCompute = data?.local_compute as {
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
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: verification with different domains", async () => {
    const sessionId = "domain-verification-test";

    // Math verification
    const mathResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Therefore: 5 + 3 = 8",
        purpose: "validation",
        verify: true,
        domain: "math",
        session_id: sessionId,
      },
    });
    expect(mathResponse.error).toBeUndefined();
    const mathText =
      (mathResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const mathData = extractJson(mathText);
    expect(mathData?.verification).toBeDefined();
    const mathVerification = mathData?.verification as { passed: boolean; domain: string };
    expect(mathVerification.domain).toBe("math");

    // Logic verification (new session)
    const logicResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "If P then Q. P is true. Therefore Q is true.",
        purpose: "validation",
        verify: true,
        domain: "logic",
        session_id: `${sessionId}-logic`,
      },
    });
    expect(logicResponse.error).toBeUndefined();
    const logicText =
      (logicResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const logicData = extractJson(logicText);
    expect(logicData?.verification).toBeDefined();
    const logicVerification = logicData?.verification as { passed: boolean; domain: string };
    expect(logicVerification.domain).toBe("logic");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: `${sessionId}-logic` },
    });
  });

  test("scratchpad: compression on large thoughts", async () => {
    const sessionId = "compression-test";

    // Create a large thought with repetitive content (compressible)
    const largeThought = `
      Let me analyze this step by step. First, we need to understand the problem.
      The problem states that we have a mathematical equation to solve.
      We need to find the value of x in the equation. The equation is a quadratic.
      A quadratic equation has the form ax^2 + bx + c = 0.
      To solve a quadratic equation, we can use the quadratic formula.
      The quadratic formula is x = (-b ± √(b²-4ac)) / 2a.
      Let me apply the quadratic formula to our equation.
      First, I identify the coefficients: a, b, and c.
      Then I substitute these values into the quadratic formula.
      After calculation, I get the two possible values for x.
      Let me verify by substituting back into the original equation.
      The verification confirms our solution is correct.
      Therefore, the final answer for x is determined.
    `.trim();

    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: largeThought,
        purpose: "analysis",
        compress: true,
        compression_query: "quadratic equation solution",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    // Check compression was applied
    expect(data?.compression).toBeDefined();
    const compressionInfo = data?.compression as {
      applied: boolean;
      original_tokens: number;
      compressed_tokens: number;
      ratio: number;
    };
    expect(compressionInfo.applied).toBe(true);
    expect(compressionInfo.compressed_tokens).toBeLessThan(compressionInfo.original_tokens);
    expect(compressionInfo.ratio).toBeLessThan(1);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: navigate step view returns detail", async () => {
    const sessionId = "navigate-step-test";

    // Create a step
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "This is a detailed analysis of the problem at hand.",
        purpose: "analysis",
        session_id: sessionId,
        confidence: 0.8,
      },
    });

    // Navigate to view specific step
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "step",
        step_id: 1,
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);
    expect(data?.step_detail).toBeDefined();
    const stepDetail = data?.step_detail as {
      step: number;
      branch: string;
      thought: string;
      confidence?: number;
    };
    expect(stepDetail.step).toBe(1);
    expect(stepDetail.thought).toContain("detailed analysis");
    expect(stepDetail.confidence).toBe(0.8);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: navigate path view returns lineage", async () => {
    const sessionId = "navigate-path-test";

    // Create chain of steps
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Step 1: Initial problem statement",
        purpose: "analysis",
        session_id: sessionId,
      },
    });
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Step 2: Break down into sub-problems",
        purpose: "planning",
        session_id: sessionId,
      },
    });
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Step 3: Solve first sub-problem",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    // Navigate to view path to step 3
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "path",
        step_id: 3,
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);
    expect(data?.path).toBeDefined();
    const path = data?.path as Array<{ step: number; branch: string; thought_preview: string }>;
    expect(path.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });
});

// ============================================================================
// AGENT MODE INTEGRATION TEST
// ============================================================================

describe("Agent Mode Integration Tests", () => {
  let client: MCPClient;

  beforeAll(async () => {
    client = new MCPClient();
    await Bun.sleep(500);
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-mode-test", version: "1.0.0" },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  test("agent mode: multi-step reasoning with operation routing", async () => {
    const sessionId = "agent-mode-full-test";

    // Simulate agent calling scratchpad with step operation (like runner.ts does)
    // Step 1: Initial analysis
    const step1 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "The problem asks to calculate 15% of 80. I'll convert percentage to decimal.",
        purpose: "analysis",
        domain: "math",
        session_id: sessionId,
        confidence: 0.75,
      },
    });
    expect(step1.error).toBeUndefined();
    const step1Data = extractJson(
      (step1.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(step1Data?.current_step).toBe(1);
    expect(step1Data?.operation).toBe("step");

    // Step 2: Calculation (verify enabled)
    const step2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "15% = 0.15. Therefore 0.15 × 80 = 12",
        purpose: "validation",
        verify: true,
        domain: "math",
        session_id: sessionId,
        confidence: 0.9,
      },
    });
    expect(step2.error).toBeUndefined();
    const step2Data = extractJson(
      (step2.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(step2Data?.current_step).toBe(2);
    expect(step2Data?.verification).toBeDefined();

    // Agent realizes mistake, calls revise operation
    const revise = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "revise",
        target_step: 2,
        reason: "Double-checking arithmetic",
        thought: "Verified: 0.15 × 80 = 12 is correct",
        confidence: 0.95,
        session_id: sessionId,
      },
    });
    expect(revise.error).toBeUndefined();
    const reviseData = extractJson(
      (revise.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(reviseData?.operation).toBe("revise");
    expect(reviseData?.current_step).toBe(3); // New step created

    // Agent explores alternative approach with branch
    const branch = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "branch",
        from_step: 1,
        branch_name: "Alternative: fraction method",
        thought: "15/100 × 80 = 15 × 80/100 = 1200/100 = 12",
        purpose: "exploration",
        session_id: sessionId,
      },
    });
    expect(branch.error).toBeUndefined();
    const branchData = extractJson(
      (branch.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(branchData?.operation).toBe("branch");
    expect(branchData?.branch).toContain("branch-");

    // Agent completes the chain
    const complete = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        summary: "Both methods confirm 15% of 80 = 12",
        final_answer: "12",
      },
    });
    expect(complete.error).toBeUndefined();
    const completeData = extractJson(
      (complete.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(completeData?.status).toBe("complete");
    expect(completeData?.total_steps).toBeGreaterThanOrEqual(3);

    // Verify full history via navigate
    const history = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "history",
        session_id: sessionId,
        limit: 50,
      },
    });
    const historyData = extractJson(
      (history.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(historyData?.history).toBeDefined();
    const historyItems = historyData?.history as unknown[];
    expect(historyItems.length).toBeGreaterThanOrEqual(4); // At least: step1, step2, revise, branch

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("agent mode: local compute integration", async () => {
    const sessionId = "agent-local-compute-test";

    // Agent sends math problem with local_compute flag
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Calculate: 25 * 4 + 10",
        purpose: "analysis",
        domain: "math",
        session_id: sessionId,
        local_compute: true,
      },
    });

    expect(response.error).toBeUndefined();
    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Local compute should solve this
    expect(data?.local_compute).toBeDefined();
    const localCompute = data?.local_compute as {
      solved: boolean;
      result: number;
      method: string;
    };
    expect(localCompute.solved).toBe(true);
    expect(localCompute.result).toBe(110);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("agent mode: confidence threshold triggers warning", async () => {
    const sessionId = "agent-threshold-test";

    // Add steps with high confidence to reach threshold
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "High confidence assertion 1",
        purpose: "analysis",
        session_id: sessionId,
        confidence: 0.85,
        confidence_threshold: 0.8,
      },
    });

    const step2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "High confidence assertion 2",
        purpose: "validation",
        session_id: sessionId,
        confidence: 0.9,
        confidence_threshold: 0.8,
      },
    });

    const step2Data = extractJson(
      (step2.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Average confidence (0.85 + 0.9) / 2 = 0.875 > 0.8 threshold
    expect(step2Data?.status).toBe("threshold_reached");
    expect(step2Data?.auto_complete_warning).toBeDefined();

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("agent mode: navigate operation for self-correction", async () => {
    const sessionId = "agent-navigate-test";

    // Create some steps
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Initial approach to the problem",
        purpose: "analysis",
        session_id: sessionId,
        confidence: 0.7,
      },
    });
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Second step with more detail",
        purpose: "exploration",
        session_id: sessionId,
        confidence: 0.8,
      },
    });

    // Agent uses navigate to review history for self-correction
    const navigateResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "history",
        session_id: sessionId,
        limit: 10,
      },
    });

    expect(navigateResponse.error).toBeUndefined();
    const navData = extractJson(
      (navigateResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(navData?.history).toBeDefined();
    const history = navData?.history as Array<{ step: number; thought_preview: string }>;
    expect(history.length).toBe(2);
    expect(history[0]?.step).toBe(1);
    expect(history[1]?.step).toBe(2);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: augment operation extracts and computes math", async () => {
    const sessionId = "augment-test";

    // Test basic augmentation
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "augment",
        text: "The sqrt(16) is important and 2^8 equals something big",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.operation).toBe("augment");
    expect(data?.augmented_text).toBeDefined();
    expect(data?.augmented_text as string).toContain("[=4]"); // sqrt(16)
    expect(data?.augmented_text as string).toContain("[=256]"); // 2^8
    expect(data?.computations).toBeDefined();
    expect(Array.isArray(data?.computations)).toBe(true);
    expect((data?.computations as unknown[]).length).toBeGreaterThanOrEqual(2);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: augment operation with no math returns unchanged text", async () => {
    const sessionId = "augment-no-math-test";

    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "augment",
        text: "This is just plain text with no mathematical expressions at all.",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.operation).toBe("augment");
    expect(data?.augmented_text).toBe(
      "This is just plain text with no mathematical expressions at all.",
    );
    expect(data?.computations).toBeDefined();
    expect((data?.computations as unknown[]).length).toBe(0);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: augment operation with store_as_step saves to session", async () => {
    const sessionId = "augment-store-test";

    // Augment with store_as_step=true
    const augmentResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "augment",
        text: "Calculate 5! for factorial",
        store_as_step: true,
        session_id: sessionId,
      },
    });

    expect(augmentResponse.error).toBeUndefined();
    const augmentText =
      (augmentResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const augmentData = extractJson(augmentText);
    expect(augmentData?.current_step).toBe(1); // Should have stored as step 1

    // Verify stored via navigate
    const navigateResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "navigate",
        view: "history",
        session_id: sessionId,
      },
    });

    const navText =
      (navigateResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const navData = extractJson(navText);
    expect(navData?.history).toBeDefined();
    expect((navData?.history as unknown[]).length).toBe(1);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: augment operation with domain filtering", async () => {
    const sessionId = "augment-domain-test";

    // Test with a financial context that might filter certain math
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "augment",
        text: "The sqrt(25) and 3^3 are values we need",
        system_context: "You are a math tutor helping with algebra",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.detected_domain).toBeDefined();
    expect(data?.filtered_count).toBeDefined();
    // Should still compute these basic math expressions
    expect(data?.augmented_text as string).toContain("[=5]"); // sqrt(25)
    expect(data?.augmented_text as string).toContain("[=27]"); // 3^3

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: step with augment_compute injects values", async () => {
    const sessionId = "augment-compute-step-test";

    // Step with augment_compute flag should compute and inject values into thought
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "I need to calculate sqrt(49) and 2^10 for this problem",
        purpose: "analysis",
        session_id: sessionId,
        augment_compute: true,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.operation).toBe("step");
    expect(data?.augmentation).toBeDefined();
    const augmentation = data?.augmentation as {
      applied: boolean;
      computations: number;
      filtered: number;
      domain: string;
    };
    expect(augmentation.applied).toBe(true);
    expect(augmentation.computations).toBeGreaterThanOrEqual(2);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: token_usage is returned in step response", async () => {
    const sessionId = "token-usage-test";

    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "This is a test thought to verify token usage tracking",
        purpose: "analysis",
        session_id: sessionId,
        token_budget: 5000,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.token_usage).toBeDefined();
    const tokenUsage = data?.token_usage as {
      total: number;
      budget: number;
      exceeded: boolean;
      auto_compressed: boolean;
    };
    expect(tokenUsage.total).toBeGreaterThan(0);
    expect(tokenUsage.budget).toBe(5000);
    expect(tokenUsage.exceeded).toBe(false);
    expect(tokenUsage.auto_compressed).toBe(false);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: token budget guard auto-compresses when exceeded", async () => {
    const sessionId = "token-budget-guard-test";

    // Use very low budget to trigger auto-compression
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: `This is a longer thought that should trigger auto-compression when the budget is set very low.
          We include multiple sentences to ensure we exceed the minimal token budget.
          The system should detect that we've exceeded the budget and automatically compress.
          This is important for maintaining context window efficiency in long reasoning chains.`,
        purpose: "analysis",
        session_id: sessionId,
        token_budget: 100, // Very low to trigger compression
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    // With token_budget=100, even 0 prior tokens should allow the step to be added
    // But the compression should be triggered for future steps or the current step
    expect(data?.token_usage).toBeDefined();
    const tokenUsage = data?.token_usage as {
      total: number;
      budget: number;
      exceeded: boolean;
      auto_compressed: boolean;
    };
    expect(tokenUsage.budget).toBe(100);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: max_step_tokens rejects oversized steps", async () => {
    const sessionId = "max-step-tokens-test";

    // Create a thought that exceeds the limit (100 tokens ~ 400 chars)
    const largeThought = "x".repeat(500); // ~125 tokens

    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: largeThought,
        purpose: "analysis",
        session_id: sessionId,
        max_step_tokens: 100,
      },
    });

    // Should return an error
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    expect(text).toContain("error");
    expect(text).toContain("max_step_tokens");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: max_step_tokens allows small steps", async () => {
    const sessionId = "max-step-tokens-allow-test";

    // Create a thought under the limit
    const smallThought = "This is a short thought"; // ~6 tokens

    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: smallThought,
        purpose: "analysis",
        session_id: sessionId,
        max_step_tokens: 100,
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);
    expect(data?.current_step).toBe(1);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: force_large bypasses max_step_tokens", async () => {
    const sessionId = "force-large-test";

    // Create a thought that exceeds the limit
    const largeThought = "x".repeat(500); // ~125 tokens

    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: largeThought,
        purpose: "analysis",
        session_id: sessionId,
        max_step_tokens: 100,
        force_large: true, // Override the limit
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);
    expect(data?.current_step).toBe(1); // Should succeed despite size

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("agent mode: compression_stats in complete operation", async () => {
    const sessionId = "agent-compression-stats-test";

    // Create a step with compression
    const largeThought = `
      This is a detailed analysis that requires multiple sentences to express.
      We need to consider various factors in our problem solving approach.
      The first factor is the initial conditions of the problem statement.
      The second factor involves the constraints we must satisfy.
      Additionally, we should consider edge cases and boundary conditions.
      Let us also examine the potential solutions and their tradeoffs.
      Finally, we will synthesize our findings into a coherent answer.
    `.trim();

    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: largeThought,
        purpose: "analysis",
        compress: true,
        compression_query: "problem solving factors",
        session_id: sessionId,
        confidence: 0.85,
      },
    });

    // Complete the chain
    const completeResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        summary: "Analysis complete",
        final_answer: "The solution accounts for all factors.",
      },
    });

    expect(completeResponse.error).toBeUndefined();
    const completeData = extractJson(
      (completeResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(completeData?.status).toBe("complete");
    expect(completeData?.total_steps).toBe(1);

    // Check compression_stats is present
    expect(completeData?.compression_stats).toBeDefined();
    const stats = completeData?.compression_stats as {
      total_bytes_saved: number;
      steps_compressed: number;
    };
    expect(stats.steps_compressed).toBe(1);
    expect(stats.total_bytes_saved).toBeGreaterThan(0);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: next_step_suggestion for math derivations", async () => {
    const sessionId = "next-step-suggestion-test";

    // Step with a math derivation that has an applicable transformation
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Let me simplify this expression: x + 0 = x + 0",
        purpose: "analysis",
        domain: "math",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should have next_step_suggestion for math domain
    expect(data?.next_step_suggestion).toBeDefined();
    const suggestion = data?.next_step_suggestion as {
      hasSuggestion: boolean;
      transformation?: string;
      description?: string;
    };
    expect(suggestion?.hasSuggestion).toBe(true);
    expect(suggestion?.transformation).toBe("add_zero");
    expect(suggestion?.description).toContain("zero");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: no next_step_suggestion for non-math domains", async () => {
    const sessionId = "no-suggestion-test";

    // Step with code domain should not have suggestion
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "The function returns a promise that resolves to the user object.",
        purpose: "analysis",
        domain: "code",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should NOT have next_step_suggestion for code domain
    expect(data?.next_step_suggestion).toBeUndefined();

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: next_step_suggestion with no applicable transformations", async () => {
    const sessionId = "no-transform-test";

    // Step with math domain but already simplified
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "The final result is x = 5",
        purpose: "analysis",
        domain: "math",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should have next_step_suggestion but hasSuggestion may be false (already simplified)
    // OR it might not be defined if no derivation was detected
    if (data?.next_step_suggestion) {
      // If a suggestion is present, check it has the right structure
      const suggestion = data.next_step_suggestion as { hasSuggestion?: boolean };
      expect(typeof suggestion.hasSuggestion).toBe("boolean");
    }

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: branch operation includes next_step_suggestion for math", async () => {
    const sessionId = "branch-suggestion-test";

    // First create a step to branch from
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Initial step",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    // Branch with a math derivation (using numbers to trigger math domain)
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "branch",
        thought: "Alternative approach to calculate: 5 * 1 = 5 * 1",
        purpose: "exploration",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should have next_step_suggestion for math domain
    expect(data?.next_step_suggestion).toBeDefined();
    const suggestion = data?.next_step_suggestion as {
      hasSuggestion: boolean;
      transformation?: string;
      allApplicable?: Array<{ name: string }>;
    };
    expect(suggestion?.hasSuggestion).toBe(true);
    // constant_fold has highest priority for numeric expressions
    expect(suggestion?.transformation).toBe("constant_fold");
    // But multiply_one should also be in the applicable list
    expect(suggestion?.allApplicable?.some((t) => t.name === "multiply_one")).toBe(true);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: revise operation includes next_step_suggestion for math", async () => {
    const sessionId = "revise-suggestion-test";

    // First create a step to revise
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Original step with error",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    // Revise with a math derivation (using numbers to trigger math domain)
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "revise",
        target_step: 1,
        reason: "Fixing calculation",
        thought: "Corrected calculation: 7 + 0 = 7 + 0",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should have next_step_suggestion for math domain
    expect(data?.next_step_suggestion).toBeDefined();
    const suggestion = data?.next_step_suggestion as {
      hasSuggestion: boolean;
      transformation?: string;
      allApplicable?: Array<{ name: string }>;
    };
    expect(suggestion?.hasSuggestion).toBe(true);
    // constant_fold has highest priority for numeric expressions
    expect(suggestion?.transformation).toBe("constant_fold");
    // But add_zero should also be in the applicable list
    expect(suggestion?.allApplicable?.some((t) => t.name === "add_zero")).toBe(true);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: hint operation returns progressive simplification steps", async () => {
    // Test basic hint operation
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "(x + 0) * 1",
        reveal_count: 1,
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeDefined();
    const parsed = extractJson(result.content[0].text);

    expect(parsed).not.toBeNull();
    expect(parsed?.operation).toBe("hint");
    expect(parsed?.hint_result).toBeDefined();
    const hintResult = parsed?.hint_result as Record<string, unknown>;
    expect(hintResult?.success).toBe(true);
    expect(hintResult?.original).toBe("(x + 0) * 1");
    expect(hintResult?.steps_shown).toBe(1);
    expect((hintResult?.total_steps as number) ?? 0).toBeGreaterThanOrEqual(1);
    expect((hintResult?.steps as unknown[])?.length).toBe(1);
    expect(hintResult?.has_more).toBe(true);
  });

  test("scratchpad: hint operation reveals all steps with high reveal_count", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "(x + 0) * 1",
        reveal_count: 10, // More than needed
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = extractJson(result.content[0].text);

    expect(parsed).not.toBeNull();
    const hintResult = parsed?.hint_result as Record<string, unknown>;
    expect(hintResult?.success).toBe(true);
    expect(hintResult?.simplified).toBe("x");
    expect(hintResult?.has_more).toBe(false);
    expect(hintResult?.steps_shown).toBe(hintResult?.total_steps);
  });

  test("scratchpad: hint operation handles invalid expression", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "+++",
        reveal_count: 1,
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = extractJson(result.content[0].text);

    expect(parsed).not.toBeNull();
    const hintResult = parsed?.hint_result as Record<string, unknown>;
    expect(hintResult?.success).toBe(false);
    expect(hintResult?.steps).toEqual([]);
  });

  test("scratchpad: hint operation with already simplified expression", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "x",
        reveal_count: 1,
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = extractJson(result.content[0].text);

    expect(parsed).not.toBeNull();
    const hintResult = parsed?.hint_result as Record<string, unknown>;
    expect(hintResult?.success).toBe(true);
    expect(hintResult?.total_steps).toBe(0);
    expect(hintResult?.simplified).toBe("x");
    expect(hintResult?.has_more).toBe(false);
  });

  test("scratchpad: hint operation with session state auto-increments", async () => {
    const sessionId = `hint-session-${Date.now()}`;

    // First call - reveal 1 step
    const response1 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "(x + 0) * 1",
        session_id: sessionId,
      },
    });

    expect(response1.error).toBeUndefined();
    const result1 = (response1.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed1 = extractJson(result1);
    const hint1 = parsed1?.hint_result as Record<string, unknown>;
    expect(hint1?.steps_shown).toBe(1);
    expect(hint1?.has_more).toBe(true);

    // Second call - omit expression and reveal_count, should auto-increment
    const response2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        session_id: sessionId,
      },
    });

    expect(response2.error).toBeUndefined();
    const result2 = (response2.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed2 = extractJson(result2);
    const hint2 = parsed2?.hint_result as Record<string, unknown>;
    expect(hint2?.steps_shown).toBe(2);
    expect(hint2?.original).toBe("(x + 0) * 1");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: hint operation reset starts fresh", async () => {
    const sessionId = `hint-reset-${Date.now()}`;

    // First call - reveal 2 steps
    const response1 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "(x + 0) * 1",
        reveal_count: 2,
        session_id: sessionId,
      },
    });

    expect(response1.error).toBeUndefined();
    const result1 = (response1.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed1 = extractJson(result1);
    const hint1 = parsed1?.hint_result as Record<string, unknown>;
    expect(hint1?.steps_shown).toBe(2);

    // Second call with reset - should start from 1
    const response2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        expression: "(x + 0) * 1",
        reset: true,
        session_id: sessionId,
      },
    });

    expect(response2.error).toBeUndefined();
    const result2 = (response2.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed2 = extractJson(result2);
    const hint2 = parsed2?.hint_result as Record<string, unknown>;
    expect(hint2?.steps_shown).toBe(1);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: hint operation without expression and no state errors", async () => {
    const sessionId = `hint-no-expr-${Date.now()}`;

    // Call without expression on fresh session
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "hint",
        session_id: sessionId,
      },
    });

    expect(response.error).toBeUndefined();
    const result = (response.result as { content: Array<{ text: string }> }).content[0].text;
    const parsed = extractJson(result);
    const hintResult = parsed?.hint_result as Record<string, unknown>;
    expect(hintResult?.success).toBe(false);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: mistakes operation detects coefficient error", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "mistakes",
        text: "2x + 3x = 6x",
      },
    });
    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.operation).toBe("mistakes");
    expect(data?.mistakes_result).toBeDefined();
    const mistakesResult = data?.mistakes_result as {
      mistakes_found: number;
      mistakes: Array<{ type: string; description: string }>;
    };
    expect(mistakesResult.mistakes_found).toBeGreaterThan(0);
    expect(mistakesResult.mistakes.some((m) => m.type.includes("coefficient"))).toBe(true);
  });

  test("scratchpad: mistakes operation finds no errors in correct derivation", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "mistakes",
        text: "Simplify: 2x + 3x = 5x. Then multiply by 2: 5x * 2 = 10x",
      },
    });
    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.operation).toBe("mistakes");
    expect(data?.mistakes_result).toBeDefined();
    const mistakesResult = data?.mistakes_result as { mistakes_found: number };
    expect(mistakesResult.mistakes_found).toBe(0);
  });

  test("scratchpad: mistakes operation returns structured mistake info", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "mistakes",
        text: "2^3 * 2^4 = 2^12",
      },
    });
    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    const mistakesResult = data?.mistakes_result as {
      text_checked: string;
      mistakes_found: number;
      mistakes: Array<{ type: string; description: string; fix?: string }>;
    };
    expect(mistakesResult.text_checked).toBeDefined();
    // This has an exponent error: 2^3 * 2^4 = 2^7, not 2^12
    expect(mistakesResult.mistakes_found).toBeGreaterThan(0);
  });

  test("scratchpad: hard_limit_tokens blocks operations when budget exhausted", async () => {
    const sessionId = "hard-limit-test";
    const hardLimit = 500; // Set a low limit

    // First step should succeed (no prior tokens)
    const step1 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "First reasoning step with enough content to generate some tokens",
        purpose: "analysis",
        session_id: sessionId,
        hard_limit_tokens: hardLimit,
      },
    });
    expect(step1.error).toBeUndefined();
    const step1Data = extractJson(
      (step1.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );
    expect(step1Data?.status).not.toBe("budget_exhausted");
    expect(step1Data?.current_step).toBe(1);

    // Add more steps to accumulate tokens and exceed the limit
    for (let i = 2; i <= 5; i++) {
      await client.request("tools/call", {
        name: "scratchpad",
        arguments: {
          operation: "step",
          thought:
            `Step ${i}: Additional reasoning with substantial content to accumulate tokens in the session.`.repeat(
              3,
            ),
          purpose: "analysis",
          session_id: sessionId,
          // Don't pass hard_limit yet - let tokens accumulate
        },
      });
    }

    // Now try another operation with hard_limit - should be blocked
    const blockedStep = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "This step should be blocked due to budget exhaustion",
        purpose: "analysis",
        session_id: sessionId,
        hard_limit_tokens: hardLimit,
      },
    });
    expect(blockedStep.error).toBeUndefined();
    const blockedData = extractJson(
      (blockedStep.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should have budget_exhausted status
    expect(blockedData?.status).toBe("budget_exhausted");
    expect(blockedData?.budget_exhausted).toBeDefined();
    const exhaustedInfo = blockedData?.budget_exhausted as {
      limit: number;
      current: number;
      exceeded_by: number;
      message: string;
      recommendation: string;
    };
    expect(exhaustedInfo.limit).toBe(hardLimit);
    expect(exhaustedInfo.current).toBeGreaterThan(hardLimit);
    expect(exhaustedInfo.exceeded_by).toBeGreaterThan(0);
    expect(exhaustedInfo.message).toContain("exceeding hard limit");
    expect(exhaustedInfo.recommendation).toContain("complete");

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });
});

// ============================================================================
// SPOT-CHECK AND RECONSIDERATION LOOP INTEGRATION TESTS
// ============================================================================

describe("Spot-Check and Reconsideration Loop Tests", () => {
  let client: MCPClient;

  beforeAll(async () => {
    client = new MCPClient();
    await Bun.sleep(500);
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "spot-check-test", version: "1.0.0" },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  test("scratchpad: spot_check operation detects bat and ball trap", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "spot_check",
        question:
          "A bat and ball cost $1.10. The bat costs $1 more than the ball. How much does the ball cost in cents?",
        answer: "10",
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.operation).toBe("spot_check");
    expect(data?.spot_check_result).toBeDefined();
    const result = data?.spot_check_result as {
      passed: boolean;
      trap_type: string | null;
      warning: string | null;
      hint: string | null;
      confidence: number;
    };
    expect(result.passed).toBe(false);
    expect(result.trap_type).toBe("additive_system");
    expect(result.warning).toBeTruthy();
    expect(result.hint).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test("scratchpad: spot_check operation passes correct answer", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "spot_check",
        question:
          "A bat and ball cost $1.10. The bat costs $1 more than the ball. How much does the ball cost in cents?",
        answer: "5",
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    const result = data?.spot_check_result as {
      passed: boolean;
      trap_type: string | null;
    };
    expect(result.passed).toBe(true);
    expect(result.trap_type).toBeNull();
  });

  test("scratchpad: complete operation with trap triggers reconsideration", async () => {
    const sessionId = "reconsideration-test";

    // Build a reasoning chain
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "The bat and ball cost $1.10 total. The bat costs $1 more than the ball.",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "If I subtract $1 from $1.10, I get $0.10. So the ball costs 10 cents.",
        purpose: "decision",
        session_id: sessionId,
      },
    });

    // Complete with question + final_answer - should trigger spot-check
    const completeResponse = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        question:
          "A bat and ball cost $1.10. The bat costs $1 more than the ball. How much does the ball cost in cents?",
        final_answer: "10",
        summary: "The ball costs 10 cents",
      },
    });

    expect(completeResponse.error).toBeUndefined();
    const completeText =
      (completeResponse.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const completeData = extractJson(completeText);

    // Should have "review" status, not "complete"
    expect(completeData?.status).toBe("review");

    // Should have spot_check_result
    expect(completeData?.spot_check_result).toBeDefined();
    const spotResult = completeData?.spot_check_result as {
      passed: boolean;
      trap_type: string;
    };
    expect(spotResult.passed).toBe(false);
    expect(spotResult.trap_type).toBe("additive_system");

    // Should have reconsideration prompt
    expect(completeData?.reconsideration).toBeDefined();
    const reconsideration = completeData?.reconsideration as {
      trap_type: string;
      hint: string;
      suggested_revise: { target_step: number; reason: string };
    };
    expect(reconsideration.trap_type).toBe("additive_system");
    expect(reconsideration.hint).toBeTruthy();
    expect(reconsideration.suggested_revise.target_step).toBe(2);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: reconsideration loop - complete → trap → revise → complete", async () => {
    const sessionId = "reconsideration-loop-test";

    // Step 1: Build reasoning chain with WRONG answer (trap)
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "The lily pad doubles every day and takes 48 days to fill the lake.",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "Half the lake means half the time. 48 / 2 = 24 days.",
        purpose: "decision",
        session_id: sessionId,
      },
    });

    // Step 2: Complete with wrong answer - should trigger spot-check
    const complete1 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        question:
          "A lily pad doubles every day. If it takes 48 days to cover the entire lake, how many days to cover half?",
        final_answer: "24",
        summary: "Half the lake takes half the time",
      },
    });

    const complete1Data = extractJson(
      (complete1.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Verify trap was detected
    expect(complete1Data?.status).toBe("review");
    expect(complete1Data?.spot_check_result).toBeDefined();
    expect((complete1Data?.spot_check_result as { trap_type: string }).trap_type).toBe(
      "nonlinear_growth",
    );

    // Get suggested revise info
    const reconsideration = complete1Data?.reconsideration as {
      suggested_revise: { target_step: number; reason: string };
    };
    expect(reconsideration.suggested_revise.target_step).toBe(2);

    // Step 3: Revise based on reconsideration prompt
    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "revise",
        target_step: reconsideration.suggested_revise.target_step,
        reason: reconsideration.suggested_revise.reason,
        thought:
          "Wait - if it doubles each day, then on day 47 it was half the size of day 48. Half the lake is day 47, not 24.",
        session_id: sessionId,
        confidence: 0.9,
      },
    });

    // Step 4: Complete again with CORRECT answer
    const complete2 = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        question:
          "A lily pad doubles every day. If it takes 48 days to cover the entire lake, how many days to cover half?",
        final_answer: "47",
        summary: "Half the lake is the day before full (exponential growth)",
      },
    });

    const complete2Data = extractJson(
      (complete2.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should now be "complete" (not "review")
    expect(complete2Data?.status).toBe("complete");

    // Spot-check should pass
    expect(complete2Data?.spot_check_result).toBeDefined();
    expect((complete2Data?.spot_check_result as { passed: boolean }).passed).toBe(true);

    // No reconsideration needed
    expect(complete2Data?.reconsideration).toBeUndefined();

    // Should have more steps due to revision
    expect((complete2Data?.total_steps as number) ?? 0).toBeGreaterThanOrEqual(3);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: complete without question/answer skips spot-check", async () => {
    const sessionId = "no-spot-check-test";

    await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        thought: "This is just a simple reasoning step",
        purpose: "analysis",
        session_id: sessionId,
      },
    });

    // Complete WITHOUT question - should skip spot-check
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "complete",
        session_id: sessionId,
        summary: "Done",
      },
    });

    const data = extractJson(
      (response.result as { content: Array<{ text: string }> }).content[0]?.text || "",
    );

    // Should be "complete" not "review"
    expect(data?.status).toBe("complete");

    // No spot-check result
    expect(data?.spot_check_result).toBeUndefined();

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });

  test("scratchpad: monty hall trap detection", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "spot_check",
        question:
          "Monty Hall: You pick door 1. Host opens door 3 (goat). Should you switch to door 2 or stay?",
        answer: "stay - it's 50/50 either way",
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    const result = data?.spot_check_result as {
      passed: boolean;
      trap_type: string | null;
    };
    expect(result.passed).toBe(false);
    expect(result.trap_type).toBe("monty_hall");
  });

  test("scratchpad: conjunction fallacy trap detection", async () => {
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "spot_check",
        question:
          "Linda is 31, single, outspoken. She majored in philosophy. Which is more likely: (A) Linda is a bank teller, or (B) Linda is a bank teller and active feminist?",
        answer: "B - bank teller and feminist is more likely given her background",
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    const result = data?.spot_check_result as {
      passed: boolean;
      trap_type: string | null;
    };
    expect(result.passed).toBe(false);
    expect(result.trap_type).toBe("conjunction_fallacy");
  });

  test("scratchpad: step with question returns trap_analysis", async () => {
    const sessionId = `trap-priming-${Date.now()}`;
    const response = await client.request("tools/call", {
      name: "scratchpad",
      arguments: {
        operation: "step",
        session_id: sessionId,
        question:
          "A bat and ball cost $1.10 total. The bat costs $1.00 more than the ball. How much does the ball cost?",
        thought: "Let me set up equations to solve this problem.",
        purpose: "analysis",
      },
    });

    expect(response.error).toBeUndefined();
    const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text || "";
    const data = extractJson(text);

    expect(data?.trap_analysis).toBeDefined();
    const trapAnalysis = data?.trap_analysis as {
      detected: boolean;
      types: string[];
      primed_count: number;
      note: string;
      confidence: number;
    };
    expect(trapAnalysis.detected).toBe(true);
    expect(trapAnalysis.types).toContain("additive_system");
    expect(trapAnalysis.primed_count).toBeGreaterThan(0);
    expect(trapAnalysis.note).toBeTruthy();
    expect(trapAnalysis.confidence).toBeGreaterThan(0);

    // Cleanup
    await client.request("tools/call", {
      name: "clear_session",
      arguments: { session_id: sessionId },
    });
  });
});
