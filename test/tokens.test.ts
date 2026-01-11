import { afterEach, describe, expect, test } from "bun:test";
import {
  calculateTokenUsage,
  clearAllSessionTokens,
  clearSessionTokens,
  estimateObjectTokens,
  estimateTokens,
  getSessionTokens,
  trackSessionTokens,
} from "../src/lib/tokens.ts";

describe("Token estimation", () => {
  test("estimateTokens returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("estimateTokens uses ~4 chars per token heuristic (default)", () => {
    // 100 chars should be ~25 tokens with default ratio
    const text = "a".repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  test("estimateTokens uses model-specific ratios", () => {
    const text = "a".repeat(100);

    // Claude uses 3.5 ratio -> ceil(100/3.5) = 29
    expect(estimateTokens(text, "claude-3-opus")).toBe(29);

    // Llama uses 4.2 ratio -> ceil(100/4.2) = 24
    expect(estimateTokens(text, "llama-3")).toBe(24);

    // GPT uses 4.0 ratio -> 25
    expect(estimateTokens(text, "gpt-4")).toBe(25);
  });

  test("estimateTokens rounds up", () => {
    // 5 chars should be 2 tokens (ceil(5/4))
    expect(estimateTokens("hello")).toBe(2);
  });

  test("estimateObjectTokens handles null/undefined", () => {
    expect(estimateObjectTokens(null)).toBe(0);
    expect(estimateObjectTokens(undefined)).toBe(0);
  });

  test("estimateObjectTokens serializes objects", () => {
    const obj = { foo: "bar", count: 42 };
    const json = JSON.stringify(obj);
    expect(estimateObjectTokens(obj)).toBe(Math.ceil(json.length / 4));
  });

  test("calculateTokenUsage returns input, output, and total", () => {
    const input = { operation: "step", thought: "test" };
    const output = { session_id: "abc", status: "continue" };

    const usage = calculateTokenUsage(input, output);

    expect(usage.input_tokens).toBeGreaterThan(0);
    expect(usage.output_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(usage.input_tokens + usage.output_tokens);
  });

  test("calculateTokenUsage handles string output", () => {
    const input = {};
    const output = "No active sessions.";

    const usage = calculateTokenUsage(input, output);

    expect(usage.input_tokens).toBe(1); // "{}" = 2 chars = 1 token
    expect(usage.output_tokens).toBe(Math.ceil(JSON.stringify(output).length / 4));
  });
});

describe("Session token tracking", () => {
  afterEach(() => {
    clearAllSessionTokens();
  });

  test("trackSessionTokens accumulates usage", () => {
    const sessionId = "test-session-1";

    const first = trackSessionTokens(sessionId, {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    });

    expect(first.total_input).toBe(10);
    expect(first.total_output).toBe(20);
    expect(first.total).toBe(30);
    expect(first.operations).toBe(1);

    const second = trackSessionTokens(sessionId, {
      input_tokens: 15,
      output_tokens: 25,
      total_tokens: 40,
    });

    expect(second.total_input).toBe(25);
    expect(second.total_output).toBe(45);
    expect(second.total).toBe(70);
    expect(second.operations).toBe(2);
  });

  test("getSessionTokens returns null for unknown session", () => {
    expect(getSessionTokens("nonexistent")).toBeNull();
  });

  test("getSessionTokens returns tracked usage", () => {
    const sessionId = "test-session-2";
    trackSessionTokens(sessionId, {
      input_tokens: 5,
      output_tokens: 10,
      total_tokens: 15,
    });

    const usage = getSessionTokens(sessionId);
    expect(usage).not.toBeNull();
    expect(usage?.total).toBe(15);
  });

  test("clearSessionTokens removes session tracking", () => {
    const sessionId = "test-session-3";
    trackSessionTokens(sessionId, {
      input_tokens: 5,
      output_tokens: 10,
      total_tokens: 15,
    });

    expect(clearSessionTokens(sessionId)).toBe(true);
    expect(getSessionTokens(sessionId)).toBeNull();
    expect(clearSessionTokens(sessionId)).toBe(false); // Already cleared
  });

  test("clearAllSessionTokens clears all sessions", () => {
    trackSessionTokens("session-a", { input_tokens: 1, output_tokens: 2, total_tokens: 3 });
    trackSessionTokens("session-b", { input_tokens: 4, output_tokens: 5, total_tokens: 9 });

    const cleared = clearAllSessionTokens();
    expect(cleared).toBe(2);

    expect(getSessionTokens("session-a")).toBeNull();
    expect(getSessionTokens("session-b")).toBeNull();
  });

  test("trackSessionTokens tracks across success and error operations", () => {
    const sessionId = "error-test-session";

    // First operation succeeds
    trackSessionTokens(sessionId, {
      input_tokens: 50,
      output_tokens: 100,
      total_tokens: 150,
    });

    // Second operation errors (should still track)
    trackSessionTokens(sessionId, {
      input_tokens: 30,
      output_tokens: 20, // Error responses are smaller
      total_tokens: 50,
    });

    const usage = getSessionTokens(sessionId);
    expect(usage).not.toBeNull();
    expect(usage?.total_input).toBe(80);
    expect(usage?.total_output).toBe(120);
    expect(usage?.total).toBe(200);
    expect(usage?.operations).toBe(2);
  });
});
